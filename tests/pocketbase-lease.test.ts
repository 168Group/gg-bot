import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PocketBaseAdapter, pocketBaseLeaseTiming, type StorageLog } from '../packages/db/src/pocketbase.js';
import type { LeaseLoss, LeaseStatus } from '../packages/db/src/contracts.js';

// Isolated fixture: an in-memory model of the omo_lease hook semantics. No real PocketBase or production lease is used.
type Reply = 'ok' | 'network' | 'hang' | 'applyThenDrop' | { status: number; body?: unknown; text?: string; headers?: Record<string, string> } | { lateMs: number } | { stallMs: number };
const key = 'a'.repeat(64), guild = '100000000000000001';
let server: ReturnType<typeof fakePocketBase>;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function fakePocketBase() {
  const state = { lease: null as null | { owner: string; expiresAt: number }, inFlight: 0, maxInFlight: 0, calls: [] as string[], replies: [] as Reply[] };
  // Same statements as infra/pocketbase/pb_hooks/operations.js, evaluated at server processing time.
  const apply = (operation: string, owner: string) => {
    const now = Date.now(), lease = state.lease;
    if (operation === 'leaseAcquire') { if (lease && lease.expiresAt > now) return false; state.lease = { owner, expiresAt: now + 60000 }; return true; }
    if (operation === 'leaseRenew') { if (!lease || lease.owner !== owner || lease.expiresAt <= now) return false; lease.expiresAt = now + 60000; return true; }
    if (operation === 'leaseRelease') { if (lease?.owner === owner) state.lease = null; return null; }
    return null;
  };
  const aborted = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const operation = url.split('/').pop()!, { input } = JSON.parse(init.body as string) as { input: { owner: string } };
    state.calls.push(operation);
    const reply = operation === 'leaseRenew' || operation === 'leaseAcquire' ? state.replies.shift() ?? 'ok' : 'ok';
    const json = (data: unknown) => new Response(JSON.stringify({ data }));
    state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      if (reply === 'ok') return json(apply(operation, input.owner));
      if (reply === 'network') throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
      if (reply === 'hang') return await aborted(init.signal!);
      if (reply === 'applyThenDrop') { apply(operation, input.owner); throw new TypeError('fetch failed'); }
      if ('stallMs' in reply) {
        // Models a blocked event loop: wall time passes while no timers run, then the success is processed.
        const data = apply(operation, input.owner), now = performance.now.bind(performance);
        vi.spyOn(performance, 'now').mockImplementation(() => now() + reply.stallMs);
        return json(data);
      }
      if ('lateMs' in reply) {
        // The server commits immediately, but the response arrives late and ignores cancellation.
        const data = apply(operation, input.owner);
        await new Promise(resolve => setTimeout(resolve, reply.lateMs));
        return json(data);
      }
      return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), { status: reply.status, headers: reply.headers });
    } finally { state.inFlight--; }
  });
  vi.stubGlobal('fetch', fetch);
  return Object.assign(state, { fetch, renewals: () => state.calls.filter(call => call === 'leaseRenew').length });
}

async function worker(lease = {}) {
  server ??= fakePocketBase();
  const logs: { level: string; event: string; fields: Record<string, unknown> }[] = [];
  const log: StorageLog = (level, event, fields) => { logs.push({ level, event, fields }); };
  const db = new PocketBaseAdapter('https://example.pockethost.io', key, 10000, { lease, log });
  const lost = vi.fn<(loss?: LeaseLoss) => void>(), statuses: LeaseStatus[] = [];
  const release = await db.singleton(guild, lost, status => statuses.push(status));
  const owner = server.lease!.owner;
  const states = () => statuses.map(status => status.state);
  return { db, lost, release, statuses, states, logs, owner };
}
const at = (ms: number) => vi.advanceTimersByTimeAsync(ms - Date.now());

beforeEach(() => { vi.setSystemTime(0); server = fakePocketBase(); });

it('keeps the client lease timing aligned with the hook TTL', () => {
  const hooks = readFileSync(new URL('../infra/pocketbase/pb_hooks/operations.js', import.meta.url), 'utf8');
  for (const operation of ['leaseAcquire', 'leaseRenew']) expect(hooks.match(new RegExp(`${operation}\\(\\).*expiry: now \\+ (\\d+)`))?.[1]).toBe(String(pocketBaseLeaseTiming.ttlMs));
  expect(() => new PocketBaseAdapter('https://example.pockethost.io', key, 10000, { lease: { marginMs: 30000, renewEveryMs: 30000 } })).toThrow('no safe renewal window');
});

it('recovers from a transient renewal failure without losing ownership', async () => {
  const w = await worker();
  server.replies.push('network');
  await at(20000);
  expect(w.states()).toEqual(['held', 'retrying']);
  expect(w.logs[0]).toMatchObject({ level: 'warn', event: 'storage.lease.renewal_failed', fields: { failure: 'network', causeCode: 'ECONNRESET', attempt: 1, consecutiveFailures: 1, validForMs: 30000, nextRetryMs: 1000 } });
  await at(21000);
  expect(w.states()).toEqual(['held', 'retrying', 'held']);
  expect(w.logs[1]).toMatchObject({ level: 'info', event: 'storage.lease.recovered', fields: { consecutiveFailures: 1, lastFailure: 'network' } });
  // The confirmed window now starts from the successful attempt: 21s + 60s - 10s.
  expect(w.statuses.at(-1)!.validForMs).toBe(50000);
  await at(41000);
  expect(server.renewals()).toBe(3);
  expect(w.lost).not.toHaveBeenCalled();
  await w.release();
});

it('stops at the last confirmed deadline during a sustained outage, before the server lease ends', async () => {
  const w = await worker();
  server.replies.push(...Array<Reply>(20).fill('network'));
  for (let t = 1000; t < 50000; t += 1000) {
    await at(t);
    expect(w.lost).not.toHaveBeenCalled();
    expect(server.lease!.expiresAt).toBeGreaterThan(Date.now() + pocketBaseLeaseTiming.marginMs - 1);
  }
  await at(50000);
  expect(w.lost).toHaveBeenCalledExactlyOnceWith({ reason: 'expired', lastFailure: 'network', attempts: server.renewals() });
  expect(server.renewals()).toBe(6); // 20s, then retries at 21, 23, 27, 35 and 43s; 51s would start past the deadline
  expect(w.logs.at(-1)).toMatchObject({ level: 'error', event: 'storage.lease.lost', fields: { reason: 'expired', lastFailure: 'network' } });
  // A competitor still cannot acquire until the server lease itself expires.
  server.replies.length = 0;
  const rival = new PocketBaseAdapter('https://example.pockethost.io', key, 10000, { log: () => {} });
  await expect(rival.singleton(guild, () => {})).rejects.toThrow('already holds');
  await at(60000);
  const rivalRelease = await rival.singleton(guild, () => {});
  const calls = server.calls.length;
  await at(120000);
  expect(server.calls.slice(calls).every(call => call === 'leaseRenew')).toBe(true); // only the rival renews
  expect(w.lost).toHaveBeenCalledOnce();
  await rivalRelease();
});

it('treats an ambiguous renewal as unconfirmed and retries against the server state', async () => {
  const w = await worker();
  server.replies.push('applyThenDrop');
  await at(20000);
  expect(server.lease!.expiresAt).toBe(80000); // committed on the server
  expect(w.statuses.at(-1)).toMatchObject({ state: 'retrying', failure: 'network', validForMs: 30000 }); // not trusted locally
  await at(21000);
  expect(w.statuses.at(-1)).toMatchObject({ state: 'held', validForMs: 50000 });
  expect(w.lost).not.toHaveBeenCalled();
  await w.release();
});

it('gives up immediately when another worker owns the lease', async () => {
  const w = await worker();
  server.lease = { owner: 'other-worker', expiresAt: 999999 };
  await at(20000);
  expect(w.lost).toHaveBeenCalledExactlyOnceWith({ reason: 'not_owner', lastFailure: 'not_owner', attempts: 1 });
  await at(120000);
  expect(server.renewals()).toBe(1);
  expect(server.lease.owner).toBe('other-worker');
});

it('does not retry a conflict, rejection or credential failure', async () => {
  for (const [reply, reason] of [[{ status: 409, body: { error: { code: 'LEASE_LOST' } } }, 'not_owner'], [{ status: 401, body: { message: 'denied' } }, 'rejected'], [{ status: 400, body: { error: { code: 'INVALID_INPUT' } } }, 'rejected']] as const) {
    vi.setSystemTime(0); server = fakePocketBase();
    const w = await worker();
    server.replies.push(reply);
    await at(20000);
    expect(w.lost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason }));
    await at(60000);
    expect(server.renewals()).toBe(1);
  }
});

it.each([
  [{ status: 503, body: { error: { code: 'STORAGE_UNAVAILABLE' } } }, 'server', 503],
  [{ status: 502, text: '<html>proxy</html>' }, 'protocol', 502],
] as const)('retries a %j response as a transient %s failure', async (reply, failure, httpStatus) => {
  const w = await worker();
  server.replies.push(reply);
  await at(21000);
  expect(w.logs[0]?.fields).toMatchObject({ failure, httpStatus });
  expect(w.states()).toEqual(['held', 'retrying', 'held']);
  await w.release();
});

it('bounds hanging renewals by the remaining lease and never overlaps them', async () => {
  const w = await worker();
  server.replies.push(...Array<Reply>(10).fill('hang'));
  await at(30000);
  expect(w.logs[0]?.fields).toMatchObject({ failure: 'timeout', elapsedMs: 10000 });
  await at(50000);
  expect(w.lost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: 'expired', lastFailure: 'timeout' }));
  expect(server.maxInFlight).toBe(1);
  expect(server.inFlight).toBe(0); // the final attempt was cancelled at the deadline
});

it('ignores a successful response that arrives after the confirmed deadline', async () => {
  const w = await worker();
  server.replies.push({ lateMs: 35000 }, ...Array<Reply>(10).fill('hang'));
  await at(50000);
  expect(w.lost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: 'expired' }));
  const renewals = server.renewals();
  await at(56000); // the first attempt's delayed success lands here
  expect(w.lost).toHaveBeenCalledOnce();
  expect(w.states().at(-1)).toBe('lost');
  expect(w.states().filter(state => state === 'held')).toHaveLength(1);
  await at(120000);
  expect(server.renewals()).toBe(renewals);
});

it('ignores a successful response that outlives its own attempt timeout', async () => {
  const w = await worker();
  server.replies.push({ lateMs: 12000 });
  await at(30000);
  expect(w.statuses.at(-1)).toMatchObject({ state: 'retrying', failure: 'timeout' });
  expect(w.logs[0]?.fields).toMatchObject({ failure: 'timeout', elapsedMs: 10000 });
  await at(31000);
  expect(w.statuses.at(-1)).toMatchObject({ state: 'held', validForMs: 50000 });
  await w.release();
});

it('fails closed when a stalled event loop processes a renewal after the deadline', async () => {
  const w = await worker();
  server.replies.push({ stallMs: 31000 });
  await at(20000);
  // The server lease is valid until 80s, but the local deadline (50s) already passed before the answer was handled.
  expect(w.lost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: 'expired' }));
  expect(vi.getTimerCount()).toBe(0);
});

it('honours a host rate limit without extra requests and stops at the confirmed deadline', async () => {
  const w = await worker();
  server.replies.push({ status: 429, text: 'Too many requests', headers: { 'Retry-After': '3600' } });
  await at(20000);
  expect(w.logs[0]?.fields).toMatchObject({ failure: 'rate_limited', httpStatus: 429, nextRetryMs: null });
  expect(w.lost).not.toHaveBeenCalled();
  await at(50000);
  expect(w.lost).toHaveBeenCalledExactlyOnceWith({ reason: 'expired', lastFailure: 'rate_limited', attempts: 1 });
  expect(server.renewals()).toBe(1);
});

it('cleans up on release during an in-flight renewal and cannot be revived', async () => {
  const w = await worker();
  server.replies.push('hang');
  await at(25000);
  expect(server.inFlight).toBe(1);
  await w.release();
  expect(server.inFlight).toBe(0);
  expect(server.lease).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  await at(120000);
  expect(w.lost).not.toHaveBeenCalled();
  expect(w.states()).toEqual(['held', 'lost']);
  expect(server.calls.at(-1)).toBe('leaseRelease');
});

it('cleans up timers after loss and still lets the owner release its row', async () => {
  const w = await worker();
  server.replies.push(...Array<Reply>(10).fill('network'));
  await at(50000);
  expect(w.lost).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  await w.release();
  expect(server.lease).toBeNull();
  await w.db.close(); // a lost lease is not released twice
  expect(server.calls.filter(call => call === 'leaseRelease')).toHaveLength(1);
});

it('does not use an acquisition confirmed too late to be safe', async () => {
  server.replies.push({ stallMs: 51000 });
  const db = new PocketBaseAdapter('https://example.pockethost.io', key, 10000, { log: () => {} });
  await expect(db.singleton(guild, () => {})).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('too late') });
  expect(server.lease).toBeNull();
});

it('times out an acquisition that never answers so startup can retry', async () => {
  server.replies.push('hang');
  const db = new PocketBaseAdapter('https://example.pockethost.io', key, 10000, { log: () => {} });
  const result = expect(db.singleton(guild, () => {})).rejects.toMatchObject({ statusCode: 503, failure: { kind: 'timeout', operation: 'leaseAcquire' } });
  await at(10000);
  await result;
});

it('reports readiness transitions and keeps diagnostics free of credentials and owner IDs', async () => {
  const w = await worker();
  // 20s fails, 21s hangs until 31s, 33s succeeds (deadline 83s), then 53-76s fail and ownership ends at 83s.
  server.replies.push('network', 'hang', 'ok', ...Array<Reply>(10).fill('network'));
  await at(33000);
  expect(w.states()).toEqual(['held', 'retrying', 'retrying', 'held']);
  await at(82999);
  expect(w.lost).not.toHaveBeenCalled();
  await at(83000);
  expect(w.states()).toEqual(['held', 'retrying', 'retrying', 'held', ...Array(6).fill('retrying'), 'lost']);
  const text = JSON.stringify(w.logs);
  for (const secret of [key, w.owner, 'example.pockethost.io', guild]) expect(text).not.toContain(secret);
});
