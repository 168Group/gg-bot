import { describe, expect, it } from 'vitest';
import { asksForEvents, clockTime, EventReplyGate, formatFixtureEvents, formatLiveEvents, REPLY_LIMIT } from '../replies.js';
import type { LiveView, PublicOccurrence } from '../live-model.js';
import { fixtureEvents } from '../fixtures.js';

const event: PublicOccurrence = { key: 'sample:2030-05-10', id: 'sample', title: 'Sample game night', eventDate: '2030-05-10', startTime: '18:30:00', endTime: '21:00:00', location: 'Main floor', updatedAt: '2030-05-10T12:00:00Z' };
function view(events = [event]): LiveView {
  return { source: 'api', state: 'ready', settingsRevision: 1, refreshedAt: '2030-05-10T12:00:00Z', freshUntil: 9999999999999, nextRefreshAt: 0,
    window: { startDate: '2030-05-10', endDate: '2030-05-16' }, events, publicOccurrenceCount: events.length, truncated: false, message: '' };
}
describe('friendly event replies', () => {
  it('groups a day once, uses local friendly times and keeps the freshness footer', () => {
    const response = formatLiveEvents(view([event, { ...event, title: 'Sample trading', startTime: '22:00:00', endTime: null, location: null }, { ...event, eventDate: '2030-05-11' }]));
    expect(response).toContain('**Coming up at GottaGacha**');
    expect(response.match(/Friday, May 10/g)).toHaveLength(1);
    expect(response).toContain('**Saturday, May 11**');
    expect(response).toContain('• **Sample game night**\n  6:30 PM to 9 PM · Main floor');
    expect(response).toContain('• **Sample trading**\n  10 PM');
    expect(response).toContain('Times are Eastern (Warren, MI).');
    expect(response).toContain('<t:1904644800:R>');
    expect(response).not.toContain('18:30:00');
    expect(response).not.toContain('America/Detroit');
    expect(response).not.toContain('undefined');
  });
  it('formats midnight, noon and minute precision without assigning UTC offsets', () => {
    expect(['00:00:00', '12:00:00', '13:05:00', '23:59:00'].map(clockTime)).toEqual(['12 AM', '12 PM', '1:05 PM', '11:59 PM']);
  });
  it('distinguishes missing or failed data from a successful empty date range', () => {
    for (const snapshot of [null, { ...view(), state: 'unavailable' as const }, { ...view(), state: 'refreshing' as const }]) {
      expect(formatLiveEvents(snapshot)).toContain('can’t get a current event list');
      expect(formatLiveEvents(snapshot)).not.toContain(event.title);
    }
    const response = formatLiveEvents(view([]));
    expect(response).toContain('No public events were returned for Friday, May 10 to Thursday, May 16.');
    expect(response).toContain('Last checked');
  });
  it('escapes untrusted text and bounds complete replies, even with Unicode or many events', () => {
    const events = Array.from({ length: 40 }, (_, index) => ({ ...event, eventDate: `2030-05-${10 + index % 7}`, title: '@everyone **[free](evil)** <@123>\n' + '🧸'.repeat(100), location: '`|@here\u202e' + 'x'.repeat(160) }));
    const response = formatLiveEvents(view(events));
    expect(response.length).toBeLessThanOrEqual(REPLY_LIMIT);
    expect(response.match(/• \*\*/g)!.length).toBeLessThanOrEqual(5);
    expect(response).toContain('Showing a selection');
    expect(response).toContain('Refreshes hourly.');
    expect(response).not.toContain('@everyone'); expect(response).not.toContain('@here'); expect(response).not.toContain('<@123>');
    expect(response).not.toContain('\u202e'); expect(response).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(formatLiveEvents({ ...view([event]), truncated: true })).toContain('Showing a selection');
  });
  it('keeps fixture mode unmistakable and shares the same readable layout', () => {
    const response = formatFixtureEvents({ source: 'fixture', events: fixtureEvents, refreshedAt: '2030-05-01T00:00:00Z' }, Date.parse('2030-05-01'));
    expect(response).toContain('FIXTURE MODE'); expect(response).toContain('Sample data, not real GottaGacha events');
    expect(response).toContain('6 PM · Sample gathering space'); expect(response).not.toContain('cancelled tournament');
    expect(formatFixtureEvents(null)).toContain('load the sample events');
  });
});
describe('event mention matching and reply limits', () => {
  it('matches whole event/events words only and leaves staff draft prefixes alone', () => {
    for (const content of ['<@123> events', '<@!123> any EVENT this week?', 'Are there events, <@123>?', '<@123> event!']) expect(asksForEvents(content)).toBe(true);
    for (const content of ['<@123> hi', '<@123> eventually', '<@123> eventful', '<@123> prevents', 'event:\nTitle: Sample events <@123>']) expect(asksForEvents(content)).toBe(false);
  });
  it('deduplicates replies and throttles users/channels before cache reads, then recovers', () => {
    const gate = new EventReplyGate(), base = { id: '1', userId: 'a', channelId: 'one' };
    expect(gate.allow(base, 1000)).toBe(true);
    expect(gate.allow({ id: '2', userId: 'b', channelId: 'two' }, 2000)).toBe(false);
    expect(gate.allow({ ...base, id: '2', channelId: 'two' }, 4000)).toBe(false);
    expect(gate.allow({ ...base, id: '2', userId: 'b' }, 4000)).toBe(false);
    expect(gate.allow({ ...base, id: '2', userId: 'b' }, 11000)).toBe(true);
    expect(gate.allow({ ...base, id: '3' }, 31000)).toBe(true);
    expect(gate.allow(base, 100000)).toBe(false);
    expect(gate.allow(base, 601000)).toBe(true);
    gate.clear(); expect(gate.allow(base, 602000)).toBe(true);
    expect(gate.allow({ ...base, channelId: null }, 900000)).toBe(false);
  });
});
