import { expect, it, vi } from 'vitest';
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type GuildChannel } from 'discord.js';
import { channelData } from '../apps/bot/src/discord.js';
import { LoggingRepository } from '../modules/logging/bot/repository.js';
import { defaultLoggingSettings } from '../modules/logging/shared/settings.js';
import type { GuildStore } from '../packages/db/src/index.js';

const guildId = '100000000000000001', channelId = '100000000000000002';
const channel = (patch: Record<string, unknown> = {}) => ({
  name: 'ticket', type: ChannelType.GuildText, parentId: null, rawPosition: 10,
  topic: null, nsfw: false, rateLimitPerUser: 0,
  permissionOverwrites: { cache: new Collection() }, ...patch
}) as unknown as GuildChannel;

function capture() {
  const call = vi.fn().mockResolvedValue(undefined);
  const repository = new LoggingRepository({ guildId, call } as unknown as GuildStore);
  return { call, update: (before: GuildChannel, after: GuildChannel) => repository.capture({
    guildId, sourceKey: crypto.randomUUID(), type: 'channel.updated', subjectId: channelId,
    channelId, parentId: after.parentId, label: after.name, observedAt: new Date().toISOString(),
    before: channelData(before), after: channelData(after)
  }, defaultLoggingSettings, 1) };
}

it('does not persist or queue the position cascade from ticket activity', async () => {
  const { call, update } = capture();
  for (let position = 0; position < 100; position++) {
    await update(channel({ rawPosition: position }), channel({ rawPosition: position + 1 }));
  }
  expect(call).not.toHaveBeenCalled();
});

it.each([
  ['rename', { name: 'ticket-closed' }],
  ['category move', { parentId: '100000000000000003' }],
  ['category removal', { parentId: null }],
  ['topic', { topic: 'Resolved' }],
  ['age restriction', { nsfw: true }],
  ['slowmode', { rateLimitPerUser: 30 }],
  ['channel type', { type: ChannelType.GuildAnnouncement }],
  ['permissions', { permissionOverwrites: { cache: new Collection([['100000000000000004', {
    id: '100000000000000004', type: 0, allow: new PermissionsBitField(), deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel)
  }]]) } }]
])('still queues a %s when positions also change', async (_, patch) => {
  const { call, update } = capture();
  const before = channel({ parentId: '100000000000000005' });
  const after = channel({ parentId: before.parentId, ...patch, rawPosition: 11 });
  await update(before, after);
  expect(call).toHaveBeenCalledExactlyOnceWith('eventCapture', expect.objectContaining({
    event: expect.objectContaining({ type: 'channel.updated', before: channelData(before), after: channelData(after) })
  }));
});
