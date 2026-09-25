import { randomUUID } from 'node:crypto';
import { GuildStore } from './index.js';
import type { StorageDriver, Operations } from './contracts.js';
import { HttpError } from '../../core/src/access.js';
export class PocketBaseAdapter implements StorageDriver {
  readonly kind = 'pocketbase' as const;
  private owners = new Map<string, string>();
  private releases = new Set<() => Promise<void>>();
  constructor(private url: string, private key: string, private timeoutMs = 10000) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('POCKETBASE_URL must be an origin without credentials or a path.');
    if (parsed.protocol !== 'https:' && !(['localhost', '127.0.0.1', '[::1]', 'pocketbase'].includes(parsed.hostname) && parsed.protocol === 'http:')) throw new Error('Use HTTPS for remote PocketBase storage.');
    if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('POCKETBASE_SERVICE_KEY must contain 64 hexadecimal characters.');
    this.url = parsed.origin;
  }
  scope(guildId: string) { return new GuildStore(this, guildId); }
  async call<K extends keyof Operations>(guildId: string, operation: K, input: Operations[K]['input']): Promise<Operations[K]['output']> {
    let response: Response;
    try {
      response = await fetch(`${this.url}/api/omo/v1/${operation}`, { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs), headers: { 'Content-Type': 'application/json', 'X-OMO-Storage-Key': this.key },
        body: JSON.stringify({ guildId, input, owner: this.owners.get(guildId) }) });
    } catch { throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'PocketBase is unreachable. No storage fallback was performed.'); }
    let body: { data?: Operations[K]['output']; error?: { code: string; message: string } };
    try { body = await response.json(); } catch { throw new HttpError(503, 'STORAGE_PROTOCOL', 'PocketBase returned an invalid storage response.'); }
    if (!response.ok) {
      const codes: Record<string, string> = { REVISION_CONFLICT: 'Settings changed in another session. Reload before saving.', NOT_FOUND: 'Record not found or expired.', INVALID_INPUT: 'Invalid storage input.', LEASE_LOST: 'Worker ownership was lost.' };
      const code = body.error?.code ?? 'STORAGE_ACCESS';
      throw new HttpError([400, 403, 404, 409].includes(response.status) ? response.status : 503, code, codes[code] ?? 'PocketBase storage access failed. Check the instance, hooks, and service key.');
    }
    if (!('data' in body)) throw new HttpError(503, 'STORAGE_PROTOCOL', 'PocketBase storage hooks returned an invalid response.');
    return body.data as Operations[K]['output'];
  }
  async singleton(guildId: string, lost: () => void): Promise<() => Promise<void>> {
    const owner = randomUUID();
    if (this.owners.has(guildId) || !await this.call(guildId, 'leaseAcquire', { owner })) throw new Error('Another bot worker already holds this guild lock.');
    this.owners.set(guildId, owner);
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    // A local monotonic deadline fails closed if the event loop stalls past renewal.
    let validUntil = performance.now() + 45000;
    const fail = () => { if (stopped) return; stopped = true; this.owners.delete(guildId); lost(); };
    const renew = async () => {
      if (stopped) return;
      try {
        if (performance.now() >= validUntil || !await this.call(guildId, 'leaseRenew', { owner })) { fail(); return; }
        validUntil = performance.now() + 45000;
      } catch { fail(); return; }
      if (!stopped) timer = setTimeout(() => { void renew(); }, 10000);
    };
    timer = setTimeout(() => { void renew(); }, 10000);
    const release = async () => {
      stopped = true; if (timer) clearTimeout(timer); this.owners.delete(guildId); this.releases.delete(release);
      await this.call(guildId, 'leaseRelease', { owner });
    };
    this.releases.add(release);
    return release;
  }
  async close() { for (const release of [...this.releases]) await release(); }
}
