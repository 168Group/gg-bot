import { randomUUID } from 'node:crypto';
import { GuildStore } from './index.js';
import type { StorageDriver, Operations, LeaseFailureKind, LeaseLoss, LeaseStatus } from './contracts.js';
import { HttpError } from '../../core/src/access.js';

/** Request diagnostics safe to log: no URLs, bodies, keys or owner IDs. */
export interface StorageFailure { kind: LeaseFailureKind; operation: string; elapsedMs: number; httpStatus?: number; causeCode?: string }
export class StorageRequestError extends HttpError {
  constructor(statusCode: number, code: string, message: string, readonly failure: StorageFailure) { super(statusCode, code, message); }
}
export interface LeaseTiming {
  /** Expiry written by pb_hooks/operations.js leaseAcquire/leaseRenew, measured from server processing time. */
  ttlMs: number;
  /** Subtracted from every confirmed window: clock rate drift, timer lateness and time to stop protected work. */
  marginMs: number;
  renewEveryMs: number;
  requestTimeoutMs: number;
  /** An attempt with less confirmed time left than this is not started. */
  minAttemptMs: number;
  backoffMs: readonly number[];
}
export const pocketBaseLeaseTiming: LeaseTiming = { ttlMs: 60000, marginMs: 10000, renewEveryMs: 20000, requestTimeoutMs: 10000, minAttemptMs: 1000, backoffMs: [1000, 2000, 4000, 8000] };
export type StorageLog = (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>) => void;
const defaultLog: StorageLog = (level, event, fields) => { console[level](JSON.stringify({ event, ...fields })); };
// Only short uppercase system codes (ECONNRESET, UND_ERR_CONNECT_TIMEOUT, CERT_HAS_EXPIRED) are reported.
const causeCode = (error: unknown) => {
  for (let current = error, depth = 0; current && typeof current === 'object' && depth < 4; current = (current as { cause?: unknown }).cause, depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) return code;
  }
  return undefined;
};
const leaseFailure = (error: unknown): LeaseFailureKind => {
  if (error instanceof StorageRequestError) return error.failure.kind;
  if (error instanceof HttpError) return error.statusCode === 409 ? 'not_owner' : [400, 403, 404].includes(error.statusCode) ? 'rejected' : error.statusCode === 503 ? 'server' : 'rejected';
  return 'rejected';
};
// Renewal can only be retried while the outcome may still be a success. Rejections and explicit ownership loss are final.
const transientFailures = new Set<LeaseFailureKind>(['timeout', 'network', 'rate_limited', 'server', 'protocol']);
export const transientStorageFailure = (error: unknown) => error instanceof StorageRequestError && transientFailures.has(error.failure.kind);

export class PocketBaseAdapter implements StorageDriver {
  readonly kind = 'pocketbase' as const;
  private owners = new Map<string, string>();
  private releases = new Set<() => Promise<void>>();
  private retryAt = 0;
  private lease: LeaseTiming;
  private log: StorageLog;
  private rateLimitError(operation: string, started: number) {
    const seconds = Math.max(1, Math.ceil((this.retryAt - Date.now()) / 1000));
    return new StorageRequestError(503, 'STORAGE_RATE_LIMIT', `PocketBase host rate limit reached (HTTP 429). Retry in ${seconds} seconds. Reduce polling or review the host request limits.`,
      { kind: 'rate_limited', operation, elapsedMs: Math.round(performance.now() - started), httpStatus: 429 });
  }
  constructor(private url: string, private key: string, private timeoutMs = 10000, options: { lease?: Partial<LeaseTiming>; log?: StorageLog } = {}) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('POCKETBASE_URL must be an origin without credentials or a path.');
    if (parsed.protocol !== 'https:' && !(['localhost', '127.0.0.1', '[::1]', 'pocketbase'].includes(parsed.hostname) && parsed.protocol === 'http:')) throw new Error('Use HTTPS for remote PocketBase storage.');
    if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('POCKETBASE_SERVICE_KEY must contain 64 hexadecimal characters.');
    this.url = parsed.origin;
    this.lease = { ...pocketBaseLeaseTiming, ...options.lease };
    this.log = options.log ?? defaultLog;
    const { ttlMs, marginMs, renewEveryMs, minAttemptMs } = this.lease;
    // A renewal must start well inside the confirmed window, or one slow response would always expire the lease.
    if (marginMs <= 0 || ttlMs - marginMs <= renewEveryMs + minAttemptMs) throw new Error('PocketBase lease timing leaves no safe renewal window.');
  }
  scope(guildId: string) { return new GuildStore(this, guildId); }
  call<K extends keyof Operations>(guildId: string, operation: K, input: Operations[K]['input']): Promise<Operations[K]['output']> {
    return this.request(guildId, operation, input, this.timeoutMs);
  }
  private async request<K extends keyof Operations>(guildId: string, operation: K, input: Operations[K]['input'], timeoutMs: number, signal?: AbortSignal): Promise<Operations[K]['output']> {
    const started = performance.now();
    const failure = (kind: LeaseFailureKind, extra: Partial<StorageFailure> = {}): StorageFailure => ({ kind, operation, elapsedMs: Math.round(performance.now() - started), ...extra });
    if (Date.now() < this.retryAt) throw this.rateLimitError(operation, started);
    // A local timer (not AbortSignal.timeout) bounds headers and body together and follows test clocks.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    // Settle on abort even if the transport ignores the signal.
    const abandoned = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    abandoned.catch(() => {});
    const bounded = <T>(work: Promise<T>) => Promise.race([work, abandoned]);
    try {
      let response: Response;
      try {
        response = await bounded(fetch(`${this.url}/api/omo/v1/${operation}`, { method: 'POST', redirect: 'error',
          signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-OMO-Storage-Key': this.key },
          body: JSON.stringify({ guildId, input, owner: this.owners.get(guildId) }) }));
      } catch (error) {
        if (timedOut) throw new StorageRequestError(503, 'STORAGE_UNAVAILABLE', `PocketBase did not respond within ${timeoutMs} ms. No storage fallback was performed.`, failure('timeout'));
        const code = causeCode(error);
        throw new StorageRequestError(503, 'STORAGE_UNAVAILABLE', `PocketBase is unreachable${code ? ` (${code})` : ''}. No storage fallback was performed.`, failure('network', code ? { causeCode: code } : {}));
      }
      const late = () => new StorageRequestError(503, 'STORAGE_UNAVAILABLE', `PocketBase did not finish responding within ${timeoutMs} ms. No storage fallback was performed.`, failure('timeout', { httpStatus: response.status }));
      // A response that outlives its deadline or cancellation is never used.
      if (controller.signal.aborted) { await response.body?.cancel().catch(() => {}); throw timedOut ? late() : new StorageRequestError(503, 'STORAGE_UNAVAILABLE', 'PocketBase request was cancelled.', failure('network')); }
      // Host firewalls can return plain text or HTML before the PocketBase hooks run.
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 60000;
        this.retryAt = Date.now() + (Number.isFinite(delay) ? Math.min(3600000, Math.max(1000, delay)) : 60000);
        await response.body?.cancel();
        throw this.rateLimitError(operation, started);
      }
      let value: unknown;
      try { value = await bounded(response.json()); } catch {
        if (timedOut) throw late();
        throw new StorageRequestError(503, 'STORAGE_PROTOCOL', `PocketBase returned a non-JSON storage response (HTTP ${response.status}). Check the storage host and proxy.`, failure('protocol', { httpStatus: response.status }));
      }
      if (timedOut) throw late();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StorageRequestError(503, 'STORAGE_PROTOCOL', 'PocketBase storage hooks returned an invalid response.', failure('protocol', { httpStatus: response.status }));
      const body = value as { data?: Operations[K]['output']; error?: { code?: unknown } };
      if (!response.ok) {
        const codes: Record<string, string> = { REVISION_CONFLICT: 'Settings changed in another session. Reload before saving.', NOT_FOUND: 'Record not found or expired.', INVALID_INPUT: 'Invalid storage input.', LEASE_LOST: 'Worker ownership was lost.' };
        const suppliedCode = body.error?.code;
        const code = typeof suppliedCode === 'string' && Object.hasOwn(codes, suppliedCode) ? suppliedCode : 'STORAGE_ACCESS';
        const status = [400, 403, 404, 409].includes(response.status) ? response.status : 503;
        throw new StorageRequestError(status, code, codes[code] ?? 'PocketBase storage access failed. Check the instance, hooks, and service key.',
          failure(status === 409 ? 'not_owner' : response.status >= 500 ? 'server' : 'rejected', { httpStatus: response.status }));
      }
      if (!('data' in body)) throw new StorageRequestError(503, 'STORAGE_PROTOCOL', 'PocketBase storage hooks returned an invalid response.', failure('protocol', { httpStatus: response.status }));
      return body.data as Operations[K]['output'];
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  /**
   * Ownership is only ever derived from a confirmed server write. The server stores expiry = its processing time + ttlMs,
   * and processing happens after the request was sent, so `sentAt + ttlMs - marginMs` (local monotonic clock) is a lower
   * bound on the server expiry. Unconfirmed attempts never extend it, and nothing after expiry can restore it.
   */
  async singleton(guildId: string, lost: (loss?: LeaseLoss) => void, onStatus?: (status: LeaseStatus) => void): Promise<() => Promise<void>> {
    const { ttlMs, marginMs, renewEveryMs, requestTimeoutMs, minAttemptMs, backoffMs } = this.lease;
    const owner = randomUUID();
    if (this.owners.has(guildId)) throw new Error('Another bot worker already holds this guild lock.');
    const acquiredFrom = performance.now();
    if (!await this.request(guildId, 'leaseAcquire', { owner }, requestTimeoutMs)) throw new Error('Another bot worker already holds this guild lock.');
    let validUntil = acquiredFrom + ttlMs - marginMs;
    if (performance.now() >= validUntil) {
      // The confirmation arrived too late to rely on. Give it back rather than start protected work.
      await this.request(guildId, 'leaseRelease', { owner }, requestTimeoutMs).catch(() => {});
      throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'PocketBase confirmed worker ownership too late to use it safely.');
    }
    this.owners.set(guildId, owner);
    let stopped = false, attempts = 0, failures = 0, lastFailure: LeaseFailureKind | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined, expiry: ReturnType<typeof setTimeout> | undefined;
    let inFlight: AbortController | undefined;
    const validForMs = () => Math.max(0, Math.round(validUntil - performance.now()));
    const status = (state: LeaseStatus['state'], failure?: LeaseFailureKind) => {
      try { onStatus?.({ state, validForMs: validForMs(), ...(failure ? { failure } : {}) }); } catch { /* observers cannot affect ownership */ }
    };
    const halt = () => { stopped = true; clearTimeout(timer); clearTimeout(expiry); inFlight?.abort(); inFlight = undefined; this.owners.delete(guildId); };
    const fail = (reason: LeaseFailureKind) => {
      if (stopped) return;
      halt(); this.releases.delete(release);
      this.log('error', 'storage.lease.lost', { reason, lastFailure, attempts, consecutiveFailures: failures, validForMs: validForMs() });
      status('lost', reason);
      lost({ reason, ...(lastFailure ? { lastFailure } : {}), attempts });
    };
    const armExpiry = () => { clearTimeout(expiry); expiry = setTimeout(() => fail('expired'), Math.max(0, validUntil - performance.now())); };
    const schedule = (delayMs: number) => { timer = setTimeout(() => { void renew(); }, delayMs); };
    const renew = async () => {
      // One renewal at a time: the next one is only scheduled after this one settles.
      if (stopped || inFlight) return;
      const sentAt = performance.now(), remaining = validUntil - sentAt;
      if (remaining < minAttemptMs) { fail('expired'); return; }
      const controller = inFlight = new AbortController();
      attempts++;
      let outcome: true | LeaseFailureKind, detail: StorageFailure | undefined;
      try {
        outcome = await this.request(guildId, 'leaseRenew', { owner }, Math.min(requestTimeoutMs, remaining), controller.signal) === true ? true : 'not_owner';
      } catch (error) {
        outcome = leaseFailure(error);
        if (error instanceof StorageRequestError) detail = error.failure;
      }
      if (inFlight === controller) inFlight = undefined;
      // A late answer after release, loss or expiry is ignored. It cannot restore ownership.
      if (stopped) return;
      if (performance.now() >= validUntil) { lastFailure = outcome === true ? lastFailure : outcome; fail('expired'); return; }
      if (outcome === true) {
        validUntil = Math.max(validUntil, sentAt + ttlMs - marginMs); armExpiry();
        if (failures) this.log('info', 'storage.lease.recovered', { attempts, consecutiveFailures: failures, lastFailure, validForMs: validForMs() });
        failures = 0; lastFailure = undefined; status('held'); schedule(renewEveryMs);
        return;
      }
      lastFailure = outcome;
      if (!transientFailures.has(outcome)) { fail(outcome); return; }
      failures++;
      const backoff = backoffMs[Math.min(failures - 1, backoffMs.length - 1)] ?? 1000;
      const delay = Math.max(backoff, this.retryAt - Date.now());
      const retrying = delay + minAttemptMs <= validUntil - performance.now();
      this.log('warn', 'storage.lease.renewal_failed', { failure: outcome, httpStatus: detail?.httpStatus, causeCode: detail?.causeCode, elapsedMs: detail?.elapsedMs,
        attempt: attempts, consecutiveFailures: failures, validForMs: validForMs(), nextRetryMs: retrying ? delay : null });
      status('retrying', outcome);
      // Without time for another attempt, the expiry timer ends ownership at the confirmed deadline.
      if (retrying) schedule(delay);
    };
    armExpiry();
    schedule(renewEveryMs);
    const release = async () => {
      const wasActive = !stopped;
      halt(); this.releases.delete(release);
      if (wasActive) status('lost');
      await this.request(guildId, 'leaseRelease', { owner }, requestTimeoutMs);
    };
    this.releases.add(release);
    status('held');
    return release;
  }
  async close() { for (const release of [...this.releases]) await release(); }
}
