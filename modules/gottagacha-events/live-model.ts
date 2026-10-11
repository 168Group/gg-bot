// Browser-safe presentation model. API records and credentials never reach the browser.
export const VENUE_TIMEZONE = 'America/Detroit';
export const FRESHNESS_MS = 5 * 60_000;
export type EventWindow = { startDate: string; endDate: string };
export type PublicOccurrence = {
  key: string; id: string; title: string; eventDate: string; startTime: string;
  endTime: string | null; location: string | null; updatedAt: string;
};
export type LiveSnapshot = {
  source: 'api'; state: 'ready' | 'refreshing' | 'unavailable'; settingsRevision: number;
  jobId: string; refreshedAt: string | null; freshUntil: number; nextRefreshAt: number;
  window: EventWindow; events: PublicOccurrence[]; publicOccurrenceCount: number;
  truncated: boolean; message: string;
};
export type LiveView = Omit<LiveSnapshot, 'jobId'>;
export function venueDate(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: VENUE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function eventWindow(now = Date.now()): EventWindow {
  const startDate = venueDate(now);
  const end = new Date(`${startDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
  return { startDate, endDate: end.toISOString().slice(0, 10) };
}
export function venueTime(event: PublicOccurrence) {
  // Date/time values are venue wall time, not UTC. Do not infer an offset at DST transitions.
  return `${event.eventDate} at ${event.startTime}${event.endTime ? ` to ${event.endTime}` : ''} (${VENUE_TIMEZONE})`;
}
export function liveView(snapshot: LiveSnapshot, revision: number, now = Date.now()): LiveView {
  const { jobId: _jobId, ...view } = snapshot; void _jobId;
  if (snapshot.state === 'ready' && (snapshot.settingsRevision !== revision || snapshot.freshUntil <= now || snapshot.window.startDate !== venueDate(now))) {
    return { ...view, state: 'unavailable', events: [], publicOccurrenceCount: 0, truncated: false, message: 'Event information needs a refresh. Ask staff to refresh the upcoming week.' };
  }
  return snapshot.state === 'ready' ? view : { ...view, events: [], publicOccurrenceCount: 0, truncated: false };
}
