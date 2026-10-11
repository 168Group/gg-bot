import { describe, expect, it, vi } from 'vitest';
import { fetchEvents, projectResponse, EventReadError } from '../client.js';
import { eventWindow, FRESHNESS_MS, liveView, type LiveSnapshot } from '../live-model.js';
import { refreshLive } from '../live-service.js';
import type { ModuleData, ModuleRecord } from '../../../packages/module-sdk/src/services.js';
import { HttpError } from '../../../packages/core/src/access.js';
const key = `gg_test_${'a'.repeat(64)}`;
const window = { startDate: '2030-05-10', endDate: '2030-05-16' };
const now = Date.parse('2030-05-10T16:00:00Z');
const source = {
  id: '1f9b6c0e-3a7b-4f2d-8e5e-2a1c3d4e5f60', title: 'TCG night', description: 'Not retained',
  eventDate: window.startDate, startTime: '19:00:00', endTime: null, recurrenceType: 'weekly', recurrenceEndDate: null,
  icon: 'cards', color: '#00f0ff', location: 'Main floor', maxParticipants: null, zones: ['main-floor'],
  isPrivate: false, isActive: true, createdBy: null, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-05-01T00:00:00Z'
};
const body = () => ({ data: [source], meta: { total: 1 } });
function memory() {
  const records = new Map<string, ModuleRecord>();
  const data: ModuleData = {
    async get<T>(name: string) { return structuredClone(records.get(name) ?? null) as ModuleRecord<T> | null; },
    async put<T>(name: string, value: T, revision: number) {
      if ((records.get(name)?.revision ?? 0) !== revision) throw new HttpError(409, 'REVISION_CONFLICT', 'Conflict');
      const record = { key: name, value: structuredClone(value), revision: revision + 1, updatedAt: new Date(now).toISOString() }; records.set(name, record); return record;
    },
    async list() { return { records: [...records.values()], nextCursor: null }; }, async delete(name) { return records.delete(name); }
  };
  return { data, records };
}
describe('documented v1 event reads', () => {
  it('uses only the documented GET with both date bounds, fixed origin, bearer key and no DB-row limit', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body())));
    const result = await fetchEvents(key, window, { fetcher });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://gottagacha.com/api/v1/events?startDate=2030-05-10&endDate=2030-05-16');
    expect(options).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${key}` } });
    expect(options!.signal).toBeInstanceOf(AbortSignal);
    expect(result.events[0]).toMatchObject({ key: `${source.id}:2030-05-10`, startTime: '19:00:00' });
    expect(JSON.stringify(result)).not.toContain('Not retained');
  });
  it('filters private/inactive records before projection and separates occurrences sharing a series id', () => {
    const result = projectResponse({ data: [source, { ...source, eventDate: '2030-05-11' }, { ...source, eventDate: '2030-05-12', isPrivate: true, title: 'PRIVATE BOOKING' }, { ...source, eventDate: '2030-05-13', isActive: false }], meta: { total: 1 } }, window);
    expect(result.events).toHaveLength(2); expect(result.publicOccurrenceCount).toBe(2);
    expect(new Set(result.events.map(e => e.key)).size).toBe(2);
    expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(JSON.stringify(result)).not.toContain('createdBy');
  });
  it('fails closed on missing privacy, bad dates, duplicate keys, out-of-window data and oversized input', async () => {
    for (const data of [[{ ...source, isPrivate: undefined }], [{ ...source, eventDate: '2030-02-30' }], [source, source], [{ ...source, eventDate: '2030-05-09' }], Array(1001).fill(source)]) {
      expect(() => projectResponse({ data, meta: { total: 1 } }, window)).toThrow(EventReadError);
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)));
    await expect(fetchEvents(key, window, { fetcher })).rejects.toMatchObject({ code: 'response' }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('retries only bounded GET network/5xx failures and never reveals upstream error contents', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('PRIVATE TOKEN'))
      .mockResolvedValueOnce(new Response('PRIVATE BODY', { status: 500 })).mockResolvedValueOnce(new Response(JSON.stringify(body())));
    const wait = vi.fn(async () => {});
    await fetchEvents(key, window, { fetcher, wait }); expect(fetcher).toHaveBeenCalledTimes(3); expect(wait.mock.calls).toEqual([[500], [1000]]);
    const broken = vi.fn<typeof fetch>().mockRejectedValue(new Error(key));
    await expect(fetchEvents(key, window, { fetcher: broken, wait })).rejects.toThrow('deadline'); expect(broken).toHaveBeenCalledTimes(3);
    const invalid = vi.fn<typeof fetch>(); await expect(fetchEvents('bad', window, { fetcher: invalid })).rejects.toMatchObject({ code: 'auth' }); expect(invalid).not.toHaveBeenCalled();
  });
  it.each([[401, 'auth'], [403, 'scope'], [400, 'request'], [429, 'rate-limit']] as const)('does not immediately retry HTTP %s', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(status === 429 ? '{"error":"rate_limited"}' : '{"error":{"message":"PRIVATE"}}', { status, headers: { 'retry-after': '120' } }));
    const error = await fetchEvents(key, window, { fetcher, now: () => now }).catch(error => error as EventReadError);
    expect(error).toMatchObject({ code }); expect(String(error)).not.toContain('PRIVATE'); expect(fetcher).toHaveBeenCalledOnce();
    if (status === 429) expect(error).toMatchObject({ retryAt: now + 120_000 });
  });
  it('bounds the public snapshot and makes truncation explicit independently of meta.total', () => {
    const data = Array.from({ length: 60 }, (_, i) => ({ ...source, id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: '🌟'.repeat(100), location: '🌟'.repeat(80) }));
    const result = projectResponse({ data, meta: { total: 1 } }, window);
    expect(result.truncated).toBe(true); expect(result.publicOccurrenceCount).toBe(60);
    expect(Buffer.byteLength(JSON.stringify(result.events))).toBeLessThanOrEqual(24000);
  });
  it('uses Detroit calendar dates at midnight and DST boundaries without inventing UTC occurrence times', () => {
    expect(eventWindow(Date.parse('2030-05-11T02:00:00Z'))).toEqual(window);
    expect(eventWindow(Date.parse('2030-03-10T07:30:00Z'))).toEqual({ startDate: '2030-03-10', endDate: '2030-03-16' });
  });
});
describe('live cache boundary', () => {
  it('keeps an hourly snapshot usable across venue midnight, filters yesterday and expires with bounded grace', async () => {
    const midnight = Date.parse('2030-05-11T04:00:00Z'), fetched = midnight - 30 * 60_000;
    const { data, records } = memory();
    await refreshLive(data, 2, 'hourly', async () => projectResponse({ data: [source, { ...source, eventDate: '2030-05-11' }], meta: { total: 1 } }, window), () => fetched);
    const saved = records.get('api-snapshot')!.value as LiveSnapshot;
    const visible = liveView(saved, 2, fetched + 60 * 60_000);
    expect(visible.state).toBe('ready');
    expect(visible.events.map(event => event.eventDate)).toEqual(['2030-05-11']);
    expect(visible.window).toEqual({ startDate: '2030-05-11', endDate: '2030-05-16' });
    expect(liveView(saved, 2, fetched + 75 * 60_000).events).toEqual([]);
  });
  it('fences concurrent refreshes, persists cooldown/replay, and hides stale or wrong-revision snapshots', async () => {
    const { data, records } = memory(); const reader = vi.fn(async () => projectResponse(body(), window));
    await refreshLive(data, 2, 'job-1', reader, () => now);
    await refreshLive(data, 2, 'job-1', reader, () => now);
    await expect(refreshLive(data, 2, 'job-2', reader, () => now)).rejects.toThrow('cooling down');
    expect(reader).toHaveBeenCalledOnce();
    const saved = records.get('api-snapshot')!.value as LiveSnapshot;
    expect(liveView(saved, 2, now + FRESHNESS_MS).events).toEqual([]); expect(liveView(saved, 3, now).events).toEqual([]);
    expect(JSON.stringify(saved)).not.toContain(key); expect(JSON.stringify(saved)).not.toContain('description');
    const other = memory();
    const results = await Promise.allSettled([refreshLive(other.data, 2, 'a', reader, () => now), refreshLive(other.data, 2, 'b', reader, () => now)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });
  it('invalidates old public events before fetching and persists sanitized failure/cooldown', async () => {
    const { data, records } = memory();
    await refreshLive(data, 2, 'first', async () => projectResponse(body(), window), () => now);
    const reader = async () => {
      expect((records.get('api-snapshot')!.value as LiveSnapshot).events).toEqual([]);
      throw new EventReadError('rate-limit', 'Rate limited.', now + 500_000);
    };
    const failed = await refreshLive(data, 2, 'next', reader, () => now + 60_001);
    expect(failed.state).toBe('unavailable'); expect(failed.events).toEqual([]); expect(failed.nextRefreshAt).toBe(now + 500_000);
    await expect(refreshLive(data, 3, 'new-settings', reader, () => now + 80_000)).rejects.toThrow('cooling down');
  });
});
