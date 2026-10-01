import type { ModuleData } from '../../packages/module-sdk/src/services.js';
import { EventReadError, type EventReadResult } from './client.js';
import { eventWindow, FRESHNESS_MS, liveView, type EventWindow, type LiveSnapshot } from './live-model.js';
export type EventReader = (key: string, window: EventWindow) => Promise<EventReadResult>;
export async function refreshLive(data: ModuleData, revision: number, jobId: string, reader: (window: EventWindow) => Promise<EventReadResult>, now = Date.now) {
  const previous = await data.get<LiveSnapshot>('api-snapshot'), started = now();
  if (previous?.value.jobId === jobId && previous.value.state !== 'refreshing') return liveView(previous.value, revision, started);
  if (previous && previous.value.nextRefreshAt > started) throw new Error('An API refresh is cooling down. Wait before requesting another.');
  const initial: LiveSnapshot = { source: 'api', state: 'refreshing', settingsRevision: revision, jobId, refreshedAt: null, freshUntil: 0,
    nextRefreshAt: started + 60_000, window: eventWindow(started), events: [], publicOccurrenceCount: 0, truncated: false, message: 'Refreshing the upcoming week.' };
  // Optimistic create/update fences concurrent requests before any external work. A crash leaves an unavailable cache.
  const claimed = await data.put('api-snapshot', initial, previous?.revision ?? 0);
  let final: LiveSnapshot;
  try {
    const result = await reader(initial.window), finished = now();
    final = { ...initial, ...result, state: 'ready', refreshedAt: new Date(finished).toISOString(), freshUntil: finished + FRESHNESS_MS, nextRefreshAt: finished + 60_000,
      message: result.truncated ? 'Showing a bounded selection of public occurrences returned by the API.' : 'Public events returned for the upcoming week. Times are local to Warren.' };
  } catch (error) {
    const safe = error instanceof EventReadError ? error : new EventReadError('network', 'Unable to refresh events. Try again later.');
    final = { ...initial, state: 'unavailable', message: safe.message, nextRefreshAt: Math.max(now() + 60_000, safe.retryAt) };
  }
  await data.put('api-snapshot', final, claimed.revision);
  return liveView(final, revision, now());
}
