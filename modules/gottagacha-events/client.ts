import { z } from 'zod';
import type { EventWindow, PublicOccurrence } from './live-model.js';
// The documented apex domain redirects here. Address the verified canonical host directly
// so credentials never need to follow a redirect to another origin.
const ENDPOINT = 'https://www.gottagacha.com/api/v1/events';
export const API_KEY_PATTERN = /^gg_(?:live|test)_[a-f0-9]{64}$/;
const MAX_BYTES = 1024 * 1024;
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
const eventSchema = z.object({
  id: z.uuid(), title: z.string().min(1).max(200), description: z.string().nullable(),
  eventDate: z.iso.date(), startTime: time, endTime: time.nullable(),
  recurrenceType: z.enum(['weekly', 'biweekly', 'monthly']).nullable(), recurrenceEndDate: z.iso.date().nullable(),
  icon: z.string(), color: z.string(), location: z.string().nullable(), maxParticipants: z.number().nullable(),
  zones: z.array(z.string()), isPrivate: z.boolean(), isActive: z.boolean(), createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true })
});
const responseSchema = z.object({ data: z.array(eventSchema).max(1000), meta: z.object({ total: z.number().int().nonnegative() }) });
export class EventReadError extends Error {
  constructor(readonly code: 'auth' | 'scope' | 'rate-limit' | 'network' | 'response' | 'request', message: string, readonly retryAt = 0) { super(message); }
}
const invalidResponse = () => new EventReadError('response', 'The event service returned unsupported or oversized data. No events were published to the cache.');
export type EventReadResult = { events: PublicOccurrence[]; publicOccurrenceCount: number; truncated: boolean };
export function projectResponse(input: unknown, window: EventWindow): EventReadResult {
  const parsed = responseSchema.safeParse(input);
  if (!parsed.success) throw invalidResponse();
  const seen = new Set<string>();
  const publicEvents: PublicOccurrence[] = [];
  for (const event of parsed.data.data) {
    if (event.eventDate < window.startDate || event.eventDate > window.endDate) throw invalidResponse();
    const key = `${event.id}:${event.eventDate}`;
    if (seen.has(key)) throw invalidResponse();
    seen.add(key);
    if (event.isPrivate || !event.isActive) continue;
    // Allowlisted display fields only. In particular, no private booking, creator or description is stored.
    publicEvents.push({ key, id: event.id, title: event.title, eventDate: event.eventDate, startTime: event.startTime,
      endTime: event.endTime, location: event.location?.slice(0, 160) ?? null, updatedAt: event.updatedAt });
  }
  publicEvents.sort((a, b) => `${a.eventDate}T${a.startTime}:${a.id}`.localeCompare(`${b.eventDate}T${b.startTime}:${b.id}`));
  const events: PublicOccurrence[] = [];
  for (const event of publicEvents) {
    if (events.length >= 40 || Buffer.byteLength(JSON.stringify([...events, event])) > 24_000) break;
    events.push(event);
  }
  return { events, publicOccurrenceCount: publicEvents.length, truncated: events.length < publicEvents.length };
}
async function readJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > MAX_BYTES) { await response.body?.cancel(); throw invalidResponse(); }
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw invalidResponse(); }
      chunks.push(chunk.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalidResponse(); }
  } finally { reader.releaseLock(); }
}
export type ReadOptions = { fetcher?: typeof fetch; wait?: (ms: number) => Promise<void>; timeoutMs?: number; now?: () => number };
export async function fetchEvents(key: string, window: EventWindow, options: ReadOptions = {}): Promise<EventReadResult> {
  if (!API_KEY_PATTERN.test(key)) throw new EventReadError('auth', 'Configure a valid GottaGacha API key on the bot service.');
  z.object({ startDate: z.iso.date(), endDate: z.iso.date() }).parse(window);
  const url = new URL(ENDPOINT); url.search = new URLSearchParams(window).toString();
  const fetcher = options.fetcher ?? fetch, wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), now = options.now ?? Date.now;
  const totalSignal = AbortSignal.timeout(35_000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const signal = AbortSignal.any([totalSignal, AbortSignal.timeout(options.timeoutMs ?? 10_000)]);
    try {
      const response = await fetcher(url, { method: 'GET', redirect: 'manual', signal,
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status >= 300 && response.status < 400) throw new EventReadError('request', 'The event API endpoint redirected. The integration endpoint needs an update.');
        if (response.status === 401) throw new EventReadError('auth', 'The API key was rejected. Check expiry or revocation on the bot service.');
        if (response.status === 403) throw new EventReadError('scope', 'The API key needs the events:read scope.');
        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const seconds = retry && /^\d+$/.test(retry) ? Math.max(60, Number(retry)) : 60;
          throw new EventReadError('rate-limit', 'The event service is rate limited. Wait for the cooldown before refreshing.', Math.min(8_640_000_000_000_000, now() + seconds * 1000));
        }
        if (response.status >= 500) throw new EventReadError('network', 'The event service is temporarily unavailable. Try a refresh later.');
        throw new EventReadError('request', 'The event service rejected this read request. Check the integration contract.');
      }
      return projectResponse(await readJson(response), window);
    } catch (error) {
      const safe = error instanceof EventReadError ? error : new EventReadError('network', signal.aborted
        ? 'The event service could not be reached within its deadline. Try a refresh later.'
        : 'Unable to connect to the event service. Try a refresh later.');
      if (safe.code !== 'network' || attempt === 2 || totalSignal.aborted) throw safe;
      await wait(500 * 2 ** attempt);
    }
  }
  throw new EventReadError('network', 'The event service is unavailable.');
}
