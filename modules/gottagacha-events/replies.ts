import { upcoming, type FixtureSnapshot } from './fixtures.js';
import { venueDate, VENUE_TIMEZONE, type LiveView, type PublicOccurrence } from './live-model.js';

export const REPLY_LIMIT = 1900;
type DisplayEvent = Pick<PublicOccurrence, 'title' | 'eventDate' | 'startTime' | 'endTime' | 'location'>;

/** API text is data, never Discord formatting, mentions or control characters. */
function text(value: string, limit: number) {
  const clean = value.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/g, ' ').trim();
  let result = '';
  for (const character of clean) {
    const escaped = character === '@' ? '@\u200b' : /[\\*_~`|[\]<>]/.test(character) ? `\\${character}` : character;
    if (result.length + escaped.length > limit - 1) return `${result}…`;
    result += escaped;
  }
  return result;
}
function day(date: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
export function clockTime(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return `${hour! % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour! >= 12 ? 'PM' : 'AM'}`;
}
function list(events: DisplayEvent[], heading: string, footer: string, truncated: boolean) {
  const selected = events.slice(0, 5), blocks: string[] = [];
  let previousDate = '';
  const selection = '\n\nShowing a selection of upcoming events.';
  for (const event of selected) {
    const location = event.location ? text(event.location, 90) : '';
    const block = `${event.eventDate !== previousDate ? `\n\n**${day(event.eventDate)}**` : ''}\n• **${text(event.title, 130) || 'Untitled event'}**\n  ${clockTime(event.startTime)}${event.endTime ? ` to ${clockTime(event.endTime)}` : ''}${location ? ` · ${location}` : ''}`;
    // Reserve the selection note and footer before appending a complete event block.
    if ((heading + blocks.join('') + block + selection + footer).length > REPLY_LIMIT) break;
    blocks.push(block); previousDate = event.eventDate;
  }
  const more = truncated || blocks.length < events.length;
  return `${heading}${blocks.join('')}${more ? selection : ''}${footer}`;
}
export function formatLiveEvents(view: LiveView | null) {
  const heading = '**Coming up at GottaGacha**';
  if (!view || view.state !== 'ready') return `${heading}\nI can’t get a current event list right now. Please try again shortly, or ask staff to check Events in the dashboard.`;
  const timestamp = view.refreshedAt ? Date.parse(view.refreshedAt) : NaN;
  const footer = `\n\nTimes are Eastern (Warren, MI).${Number.isFinite(timestamp) ? `\nLast checked <t:${Math.floor(timestamp / 1000)}:R> · Refreshes hourly.` : ''}`;
  if (!view.events.length) return `${heading}\nNo public events were returned for ${day(view.window.startDate)} to ${day(view.window.endDate)}.${footer}`;
  return list(view.events, heading, footer, view.truncated);
}
export function formatFixtureEvents(snapshot: FixtureSnapshot | null, now = Date.now()) {
  const heading = '**FIXTURE MODE · Sample events only**';
  if (!snapshot) return `${heading}\nAsk staff to load the sample events in the dashboard.`;
  const events = upcoming(snapshot.events, now).map(event => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: VENUE_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(event.startsAt)).map(part => [part.type, part.value]));
    return { title: event.title, eventDate: venueDate(Date.parse(event.startsAt)), startTime: `${parts.hour}:${parts.minute}:00`, endTime: null, location: event.location };
  });
  return events.length ? list(events, heading, '\n\nSample data, not real GottaGacha events. Times are Eastern.', false) : `${heading}\nNo upcoming sample events. These are not real GottaGacha events.`;
}

/** Called only after the framework verifies an explicit mention of this bot. */
export function asksForEvents(content: string) {
  return !/^event:\s*/i.test(content) && /\bevents?\b/i.test(content);
}

/** Process-local reply limits only. No conversation content or history is retained. */
export class EventReplyGate {
  private seen = new Map<string, number>();
  private users = new Map<string, number>();
  private channels = new Map<string, number>();
  private nextReply = 0;
  allow(message: { id: string; userId: string; channelId: string | null }, now = Date.now()) {
    if (!message.channelId) return false;
    for (const map of [this.seen, this.users, this.channels]) for (const [key, until] of map) if (until <= now) map.delete(key);
    if (this.seen.has(message.id) || this.nextReply > now || (this.users.get(message.userId) ?? 0) > now || (this.channels.get(message.channelId) ?? 0) > now) return false;
    const remember = (map: Map<string, number>, key: string, until: number) => {
      if (map.size >= 500) map.delete(map.keys().next().value!);
      map.set(key, until);
    };
    remember(this.seen, message.id, now + 10 * 60_000);
    remember(this.users, message.userId, now + 30_000);
    remember(this.channels, message.channelId, now + 10_000);
    this.nextReply = now + 2000;
    return true;
  }
  clear() { this.seen.clear(); this.users.clear(); this.channels.clear(); this.nextReply = 0; }
}
