import { it, expect } from 'vitest';
import { renderEvent } from '../bot/render.js';
import type { LogEvent } from '../shared/settings.js';
it('bounds Discord payloads and suppresses all mentions without inventing an actor', () => {
  const event: LogEvent = { id: crypto.randomUUID(), type: 'channel.updated', subjectId: '100000000000000001', subjectLabel: '@everyone **name**', channelId: null, parentId: null, before: { topic: 'x'.repeat(6000) }, after: { topic: '@here '.repeat(6000) }, observedAt: new Date().toISOString(), expiresAt: new Date().toISOString(), actorId: null, reason: null, attribution: 'unavailable', configRevision: 1, deliveryState: null, messageId: null, destinationId: null };
  const payload = renderEvent(event, 'marker', '#d7f47b'), embed = payload.embeds[0]!;
  expect(payload.allowedMentions.parse).toEqual([]); expect(embed.description).not.toContain('@everyone');
  expect(embed.fields.every(field => field.value.length <= 1024)).toBe(true);
  expect(JSON.stringify(embed).length).toBeLessThan(6000);
  expect(embed.fields[0]?.value).toContain('[truncated]');
  expect(embed.fields[2]?.value).toContain('unknown');
});
