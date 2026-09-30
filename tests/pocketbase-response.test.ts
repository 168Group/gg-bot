import { afterEach, expect, it, vi } from 'vitest';
import { PocketBaseAdapter } from '../packages/db/src/pocketbase.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const adapter = () => new PocketBaseAdapter('https://example.pockethost.io', 'a'.repeat(64));

it('recognizes a plain-text host rate limit and honors its retry window without sending more requests', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response('private upstream text', { status: 429, headers: { 'Retry-After': '60' } }))
    .mockResolvedValue(new Response(JSON.stringify({ data: { protocol: 1 } })));
  vi.stubGlobal('fetch', fetch);
  const db = adapter();
  await expect(db.call('guild', 'ready', {})).rejects.toMatchObject({ statusCode: 503, code: 'STORAGE_RATE_LIMIT', message: expect.stringContaining('HTTP 429') });
  await expect(db.call('guild', 'ready', {})).rejects.toMatchObject({ code: 'STORAGE_RATE_LIMIT' });
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  await expect(db.call('guild', 'ready', {})).resolves.toEqual({ protocol: 1 });
});

it('includes the HTTP status for non-JSON failures without exposing upstream text', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>private proxy diagnostics</html>', { status: 502 })));
  await expect(adapter().call('guild', 'ready', {})).rejects.toMatchObject({ code: 'STORAGE_PROTOCOL', message: 'PocketBase returned a non-JSON storage response (HTTP 502). Check the storage host and proxy.' });
});

it.each([null, [], 123, 'private text', {}])('rejects malformed JSON envelopes safely: %j', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  await expect(adapter().call('guild', 'ready', {})).rejects.toMatchObject({ code: 'STORAGE_PROTOCOL' });
});

it('still relinquishes worker ownership immediately when a renewal is rate limited', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: true })))
    .mockResolvedValue(new Response('Too many requests', { status: 429, headers: { 'Retry-After': '3600' } }));
  vi.stubGlobal('fetch', fetch);
  const lost = vi.fn();
  const db = adapter();
  const release = await db.singleton('guild', lost);
  await vi.advanceTimersByTimeAsync(10000);
  expect(lost).toHaveBeenCalledTimes(1);
  await expect(release()).rejects.toMatchObject({ code: 'STORAGE_RATE_LIMIT' });
  expect(fetch).toHaveBeenCalledTimes(2);
});
