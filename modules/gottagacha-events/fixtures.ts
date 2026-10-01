import { z } from 'zod';

// This is our sample projection, NOT an assertion about the GottaGacha API schema.
export const fixtureEventSchema = z.object({
  source: z.literal('fixture'), id: z.string().min(1).max(80), revision: z.number().int().positive(),
  title: z.string().min(1).max(120), startsAt: z.iso.datetime({ offset: true }),
  timezone: z.literal('America/Detroit'), location: z.string().min(1).max(160),
  status: z.enum(['scheduled', 'cancelled'])
}).strict();
export type FixtureEvent = z.infer<typeof fixtureEventSchema>;
export type FixtureSnapshot = { source: 'fixture'; refreshedAt: string; events: FixtureEvent[] };
export type AnnouncementPreview = { source: 'fixture'; event: FixtureEvent; text: string; createdAt: string };
export const fixtureEvents: FixtureEvent[] = [
  { source: 'fixture', id: 'sample-game-night', revision: 1, title: 'Sample community game night', startsAt: '2030-05-10T18:00:00-04:00', timezone: 'America/Detroit', location: 'Sample gathering space', status: 'scheduled' },
  { source: 'fixture', id: 'sample-trading', revision: 2, title: 'Sample collectors meetup', startsAt: '2030-05-11T14:00:00-04:00', timezone: 'America/Detroit', location: 'Sample trading tables', status: 'scheduled' },
  { source: 'fixture', id: 'sample-cancelled', revision: 2, title: 'Sample cancelled tournament', startsAt: '2030-05-12T16:00:00-04:00', timezone: 'America/Detroit', location: 'Sample play area', status: 'cancelled' }
];
export function upcoming(events: FixtureEvent[], now = Date.now()) {
  return events.filter(event => event.status === 'scheduled' && Date.parse(event.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
export function eventTime(event: Pick<FixtureEvent, 'startsAt' | 'timezone'>) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone }).format(new Date(event.startsAt)) + ` (${event.timezone})`;
}
export function previewText(event: FixtureEvent) {
  return `FIXTURE PREVIEW ONLY • ${event.status === 'cancelled' ? 'Cancelled' : 'Upcoming'}\n${event.title}\n${eventTime(event)}\n${event.location}\nSample data. Nothing has been announced.`;
}
