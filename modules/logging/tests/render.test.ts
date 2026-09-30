import { it, expect } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { renderEvent } from '../bot/render.js';
import type { LogEvent } from '../shared/settings.js';
const role = '100000000000000004', member = '100000000000000005';
const snapshot = {
  name: 'test-channel-log', type: 'GuildText', parentId: '100000000000000020', position: 103,
  topic: null, nsfw: false, slowmode: 0,
  overwrites: [{ id: role, type: 0, allow: ['ViewChannel'], deny: Object.keys(PermissionFlagsBits).filter(p => p !== 'ViewChannel') },
    { id: member, type: 1, allow: [], deny: ['ViewChannel'] }]
};
function event(patch: Partial<LogEvent> = {}): LogEvent {
  return { id: crypto.randomUUID(), type: 'channel.created', subjectId: '100000000000000030', subjectLabel: 'test-channel-log',
    channelId: '100000000000000030', parentId: snapshot.parentId, before: null, after: snapshot,
    observedAt: '2026-09-29T12:00:00.000Z', expiresAt: '2026-10-29T12:00:00.000Z', actorId: null, reason: null,
    attribution: 'unavailable', configRevision: 1, deliveryState: null, messageId: null, destinationId: null, ...patch };
}
const render = (patch: Partial<LogEvent> = {}) => renderEvent(event(patch), 'delivery-marker', '#bc9cff').embeds[0]!;
const field = (embed: ReturnType<typeof render>, name: string) => embed.fields.find(f => f.name === name)?.value;

it.each(['channel.created', 'channel.deleted'])('summarizes %s without the raw snapshot dump shown in production', type => {
  const embed = render({ type, before: type === 'channel.deleted' ? snapshot : null, after: type === 'channel.created' ? snapshot : null });
  expect(field(embed, 'Type')).toBe('Text channel');
  expect(field(embed, 'Category')).toBe(`<#${snapshot.parentId}>`);
  expect(field(embed, 'Permissions')).toBe('2 custom overwrites · 1 role, 1 member');
  expect(embed.fields.map(f => f.name)).not.toEqual(expect.arrayContaining(['Before', 'After']));
  for (const name of ['Topic', 'Slowmode', 'Age restricted', 'Reason', 'Position']) expect(field(embed, name)).toBeUndefined();
  const text = JSON.stringify(embed);
  expect(text).not.toContain('AttachFiles');
  expect(text).not.toContain('[truncated]');
  expect(text.length).toBeLessThan(1200);
  expect(embed.description).toContain('test-channel-log');
  if (type === 'channel.deleted') expect(embed.description).not.toContain('<#100000000000000030>');
  expect(embed.color).toBe(0xbc9cff);
  expect(embed.footer.text.endsWith('delivery-marker')).toBe(true);
});

it('shows only changed settings and makes cleared defaults explicit', () => {
  const before = { ...snapshot, name: 'old-name', topic: 'Trade here', slowmode: 90, nsfw: true };
  const embed = render({ type: 'channel.updated', before, after: snapshot });
  expect(field(embed, 'Name')).toContain('old-name → test-channel-log');
  expect(field(embed, 'Topic')).toContain('Trade here');
  expect(field(embed, 'Topic')).toContain('None');
  expect(field(embed, 'Slowmode')).toBe('1m 30s → Off');
  expect(field(embed, 'Age restricted')).toBe('Yes → No');
  for (const name of ['Type', 'Category', 'Permissions', 'Position']) expect(field(embed, name)).toBeUndefined();
});

it('summarizes permission transitions, additions and removals by role/member', () => {
  const before = { overwrites: [{ id: role, type: 0, allow: ['ViewChannel', 'SendMessages'], deny: [] }, { id: member, type: 1, allow: [], deny: ['ViewChannel'] }] };
  const after = { overwrites: [{ id: role, type: 0, allow: ['ViewChannel'], deny: ['SendMessages'] }, { id: '100000000000000006', type: 0, allow: ['AttachFiles'], deny: [] }] };
  const value = field(render({ type: 'channel.updated', before, after }), 'Permissions')!;
  expect(value).toContain(`<@&${role}>`);
  expect(value).toContain('Send messages: Allowed → Denied');
  expect(value).toContain(`<@${member}>`);
  expect(value).toContain('View channel: Denied → Inherited');
  expect(value).toContain('Attach files: Inherited → Allowed');
  expect(value).not.toContain('View channel: Allowed');
});

it('ignores permission order and JSON object key order when computing changes', () => {
  const before = { overwrites: [{ id: role, type: 0, allow: ['ViewChannel', 'SendMessages'], deny: [] }, { id: member, type: 1, allow: [], deny: ['ViewChannel'] }] };
  const after = { overwrites: [{ deny: ['ViewChannel'], allow: [], type: 1, id: member }, { deny: [], allow: ['SendMessages', 'ViewChannel'], type: 0, id: role }] };
  expect(field(render({ type: 'channel.updated', before, after }), 'Permissions')).toBeUndefined();
});

it('distinguishes missing data from no permissions and never invents transitions', () => {
  const embed = render({ type: 'channel.updated', before: null, after: snapshot });
  expect(field(embed, 'Name')).toContain('Not recorded');
  expect(field(embed, 'Permissions')).toContain('Before: Not recorded');
  expect(field(embed, 'Permissions')).not.toContain('Inherited →');
  expect(field(render({ after: { overwrites: [] } }), 'Permissions')).toBe('No custom overwrites');
  expect(field(render({ after: { overwrites: [null, { id: role }] } }), 'Permissions')).toBe('Not recorded');
  expect(field(render({ after: { type: '' } }), 'Type')).toBe('Not recorded');
  expect(field(render({ after: { type: 'constructor' } }), 'Type')).toBe('constructor');
  expect(field(render({ after: null }), 'Details')).toContain('not recorded');
});

it('renders a short delivery test without channel or attribution placeholders', () => {
  const embed = render({ type: 'logging.test', before: null, after: { result: 'Test requested by an authorized administrator.' } });
  expect(embed.title).toBe('Delivery test');
  expect(embed.description).toContain('working');
  expect(embed.fields).toEqual([]);
});

it('keeps meaningful channel settings and recorded attribution while escaping supplied text', () => {
  const embed = render({ after: { ...snapshot, type: 'GuildVoice', topic: 'Hello **world** @everyone', nsfw: true, slowmode: 3665 },
    actorId: member, attribution: 'confirmed', reason: 'Approved by @here' });
  expect(field(embed, 'Type')).toBe('Voice channel');
  expect(field(embed, 'Topic')).toBe('Hello \\*\\*world\\*\\* @\u200beveryone');
  expect(field(embed, 'Slowmode')).toBe('1h 1m 5s');
  expect(field(embed, 'Age restricted')).toBe('Yes');
  expect(field(embed, 'Created by')).toBe(`<@${member}>`);
  expect(field(embed, 'Reason')).toBe('Approved by @\u200bhere');
});

it('explains overflow without listing every permission or every overwrite', () => {
  const after = { overwrites: Array.from({ length: 10 }, (_, i) => ({ id: String(100000000000000000n + BigInt(i)), type: 0, allow: Object.keys(PermissionFlagsBits), deny: [] })) };
  const text = field(render({ type: 'channel.updated', before: { overwrites: [] }, after }), 'Permissions')!;
  expect(text).toContain('more permission changes');
  expect(text).toContain('+7 more overwrites changed');
  expect(text).toContain('Full details in dashboard');
});

it('bounds Discord payloads and suppresses all mentions without inventing an actor', () => {
  const event: LogEvent = { id: crypto.randomUUID(), type: 'channel.updated', subjectId: '100000000000000001', subjectLabel: '@everyone **name**', channelId: null, parentId: null, before: { topic: 'x'.repeat(6000) }, after: { topic: '@here '.repeat(6000) }, observedAt: new Date().toISOString(), expiresAt: new Date().toISOString(), actorId: null, reason: null, attribution: 'unavailable', configRevision: 1, deliveryState: null, messageId: null, destinationId: null };
  const payload = renderEvent(event, 'marker', '#d7f47b'), embed = payload.embeds[0]!;
  expect(payload.allowedMentions.parse).toEqual([]); expect(embed.description).not.toContain('@everyone');
  expect(embed.fields.every(field => field.value.length <= 1024)).toBe(true);
  expect(JSON.stringify(embed).length).toBeLessThan(6000);
  expect(embed.fields[0]?.value).toContain('[truncated]');
  expect(embed.fields.some(f => f.value.toLowerCase().includes('unknown'))).toBe(true);
});

it('bounds the complete embed even when every field and permission change is oversized', () => {
  const huge = '@everyone **[]<>`\\'.repeat(1000);
  const make = (suffix: string) => ({ name: huge + suffix, type: huge + suffix, parentId: huge + suffix, topic: huge + suffix,
    position: huge + suffix, slowmode: huge + suffix, nsfw: huge + suffix, overwrites: Array.from({ length: 100 }, (_, i) => ({
      id: String(100000000000000000n + BigInt(i)), type: 0, allow: suffix === 'a' ? [] : Object.keys(PermissionFlagsBits), deny: [] })) });
  const original = event({ type: 'channel.updated', subjectLabel: huge, before: make('a'), after: make('b'), reason: huge });
  const unchanged = structuredClone(original);
  const payload = renderEvent(original, 'marker', '#bc9cff'), embed = payload.embeds[0]!;
  expect(original).toEqual(unchanged);
  expect(embed.fields.length).toBeLessThanOrEqual(25);
  expect(embed.fields.every(f => f.name.length <= 256 && f.value.length <= 1024 && f.value.length > 0)).toBe(true);
  const size = embed.title.length + embed.description.length + embed.footer.text.length + embed.fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
  expect(size).toBeLessThanOrEqual(6000);
  expect(JSON.stringify(embed)).not.toContain('@everyone');
  expect(payload.allowedMentions).toEqual({ parse: [], repliedUser: false });
  expect(embed.footer.text.endsWith('marker')).toBe(true);
});
