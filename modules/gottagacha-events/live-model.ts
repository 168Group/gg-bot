// Browser-safe presentation model. API records and credentials never reach the browser.
export const VENUE_TIMEZONE = 'America/Detroit';
export const REFRESH_INTERVAL_MS = 60 * 60_000;
// One hourly cycle plus a bounded allowance for worker delays. Failures hide data sooner.
export const FRESHNESS_MS = REFRESH_INTERVAL_MS + 15 * 60_000;
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
export function liveView(snapshot: LiveView & { jobId?: string }, revision: number, now = Date.now()): LiveView {
  const { jobId: _jobId, ...view } = snapshot; void _jobId;
  const today = venueDate(now);
  if (snapshot.state === 'ready' && (snapshot.settingsRevision !== revision || snapshot.freshUntil <= now || snapshot.window.startDate > today || snapshot.window.endDate < today)) {
    return { ...view, state: 'unavailable', events: [], publicOccurrenceCount: 0, truncated: false, message: 'Event information needs a refresh. Ask staff to refresh the upcoming week.' };
  }
  return snapshot.state === 'ready' ? { ...view, window: { ...view.window, startDate: today }, events: view.events.filter(event => event.eventDate >= today) } : { ...view, events: [], publicOccurrenceCount: 0, truncated: false };
}
