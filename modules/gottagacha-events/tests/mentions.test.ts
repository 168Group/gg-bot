import { afterEach, expect, it, vi } from 'vitest';
import type { Message } from 'discord.js';
import { ModuleHost } from '../../../packages/core/src/host.js';
import { readConfig } from '../../../packages/core/src/config.js';
import { dispatchModuleMessage } from '../../../apps/bot/src/module-messages.js';
import type { ModuleData, ModuleRecord } from '../../../packages/module-sdk/src/services.js';
import type { ModuleState } from '../../../packages/module-sdk/src/browser.js';
import type { ModulePackageServices } from '../../../packages/core/src/module-package.js';
import { createBot } from '../bot.js';
import { definition } from '../definition.js';
import { eventWindow, type LiveSnapshot } from '../live-model.js';
import { fixtureEvents } from '../fixtures.js';

const now = Date.parse('2030-05-10T16:00:00Z');
const guildId = '100000000000000001', botId = '100000000000000002', userId = '100000000000000003', staff = '100000000000000010';
const config = readConfig({ NODE_ENV: 'test', STORAGE_PROVIDER: 'postgres', DATABASE_URL: 'postgres://localhost/fixture',
  DISCORD_GUILD_ID: guildId, DASHBOARD_ORIGIN: 'http://localhost:3000', OWNER_USER_IDS: userId });
afterEach(() => { vi.useRealTimers(); });
async function setup(mode: 'api-readonly' | 'fixtures' = 'api-readonly') {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const records = new Map<string, ModuleRecord>(), reads: string[] = [];
  const data: ModuleData = {
    async get<T>(key: string) { reads.push(key); return structuredClone(records.get(key) ?? null) as ModuleRecord<T> | null; },
    async put<T>(key: string, value: T, expected: number) {
      expect(records.get(key)?.revision ?? 0).toBe(expected);
      const record = { key, value, revision: expected + 1, updatedAt: new Date().toISOString() }; records.set(key, record); return record;
    },
    async list() { return { records: [...records.values()], nextCursor: null }; }, async delete(key) { return records.delete(key); }
  };
  await data.put('api-snapshot', { source: 'api', state: 'ready', settingsRevision: 1, jobId: 'synthetic', refreshedAt: new Date(now).toISOString(), freshUntil: now + 4500000,
    nextRefreshAt: 0, window: eventWindow(now), events: [{ key: 'sample', id: 'sample', title: 'Synthetic game night', eventDate: '2030-05-10', startTime: '18:30:00', endTime: null, location: 'Sample venue', updatedAt: new Date(now).toISOString() }],
    publicOccurrenceCount: 1, truncated: false, message: '' } satisfies LiveSnapshot, 0);
  await data.put('fixture-snapshot', { source: 'fixture', refreshedAt: new Date().toISOString(), events: fixtureEvents }, 0);
  let state: ModuleState = { moduleId: definition.manifest.id, settingsVersion: 2, enabled: true, appliedEnabled: false, settings: { mode, staffChannelIds: [staff] }, appliedSettings: {}, desiredRevision: 1, appliedRevision: 0, applyError: null };
  const reader = vi.fn(), logger = { info: vi.fn(), error: vi.fn() };
  const host = new ModuleHost(guildId, [createBot({ validateDestination: vi.fn() } as unknown as ModulePackageServices, reader)], {
    async getModule() { return state; }, resources: () => ({ data, jobs: { enqueue: vi.fn(async () => 'queued') } }),
    async acknowledge(_id, next) { state = { ...next, appliedEnabled: next.enabled, appliedRevision: next.desiredRevision }; },
    async reject(_id, _revision, message) { throw new Error(message); }
  }, logger);
  await host.sync();
  const member = { id: userId, guild: { id: guildId }, roles: { cache: new Map() } };
  const membership = vi.fn(async () => member), reply = vi.fn<(message: { content: string }) => Promise<void>>(async () => {});
  const base = { id: 'one', guildId, guild: { id: guildId, members: { fetch: membership } }, author: { id: userId, bot: false }, channelId: 'public', webhookId: null, content: `<@${botId}> events`, reply };
  return { host, data, records, reads, reader, reply, membership, logger,
    async send(overrides: Record<string, unknown> = {}) { await dispatchModuleMessage({ ...base, ...overrides } as unknown as Message, { config, host, botId, available: () => true }); },
    async change(change: Partial<ModuleState>) { state = { ...state, ...change, desiredRevision: state.desiredRevision + 1 }; await host.sync(); }
  };
}
it('routes real mention metadata through the Events module and shares the formatted slash reply without an API read', async () => {
  const f = await setup();
  try {
    for (const content of ['events', '<@100000000000000099> events', `<@&${botId}> event`, `<@${botId}> eventually`, `<@${botId}> hello`]) await f.send({ content });
    expect(f.reply).not.toHaveBeenCalled(); expect(f.reads).toEqual([]);
    await f.send({ content: `<@!${botId}> any EVENTS coming up?` });
    expect(f.reply).toHaveBeenCalledOnce(); expect(f.reads).toEqual(['api-snapshot']);
    const response = f.reply.mock.calls[0]![0];
    expect(response).toMatchObject({ content: expect.stringContaining('6:30 PM · Sample venue'), allowedMentions: { parse: [], repliedUser: false } });
    expect(response.content).toBe(await f.host.command('events upcoming', { guildId, userId, channelId: 'public', access: null, options: {} }));
    expect(f.reader).not.toHaveBeenCalled();
  } finally { await f.host.stop(); }
});
it('suppresses repeated replies before storage and stops after disconnect or disable', async () => {
  const f = await setup();
  try {
    await f.send(); await f.send(); await f.send({ id: 'two' });
    expect(f.reply).toHaveBeenCalledOnce(); expect(f.reads).toHaveLength(1);
    vi.setSystemTime(now + 31000); await f.send(); expect(f.reply).toHaveBeenCalledOnce();
    await f.send({ id: 'two' }); expect(f.reply).toHaveBeenCalledTimes(2);
    await f.change({ settings: { mode: 'disconnected', staffChannelIds: [] } }); await f.send({ id: 'three' });
    expect(f.reads).toHaveLength(2);
    await f.change({ enabled: false }); f.membership.mockClear(); await f.send({ id: 'four' });
    expect(f.membership).not.toHaveBeenCalled(); expect(f.reply).toHaveBeenCalledTimes(2);
  } finally { await f.host.stop(); }
});
it('does not expose expired data and reports cache failures without upstream details', async () => {
  const f = await setup();
  try {
    vi.setSystemTime(now + 4500001); await f.send();
    expect(f.reply.mock.calls[0]![0].content).toContain('can’t get a current event list');
    expect(f.reply.mock.calls[0]![0].content).not.toContain('Synthetic game night');
    f.data.get = async () => { throw new Error('PRIVATE STORAGE DETAILS'); };
    vi.setSystemTime(now + 4600000); await f.send({ id: 'two' });
    expect(f.reply).toHaveBeenCalledTimes(2); expect(JSON.stringify(f.reply.mock.calls)).not.toContain('PRIVATE');
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain('PRIVATE'); expect(f.reader).not.toHaveBeenCalled();
  } finally { await f.host.stop(); }
});
it('keeps fixture drafts admin-only and sends exactly one draft reply when staff also mention the bot', async () => {
  const f = await setup('fixtures');
  try {
    await f.host.message({ guildId, userId, channelId: staff, access: 'viewer', options: {}, id: 'denied', mentionsBot: true, content: `event:\nTitle: Sample <@${botId}>`, reply: async () => { throw new Error('Must not reply'); } });
    expect(f.records.size).toBe(2);
    await f.send({ channelId: staff, content: `event:\nTitle: Sample <@${botId}>` });
    expect(f.reply).toHaveBeenCalledOnce(); expect(f.reply.mock.calls[0]![0].content).toContain('FIXTURE DRAFT');
    expect(f.records.size).toBe(3);
    await f.send({ id: 'two', content: `<@${botId}> events` });
    expect(f.reply).toHaveBeenCalledTimes(2); expect(f.reply.mock.calls[1]![0].content).toContain('FIXTURE MODE');
    expect(f.reply.mock.calls[1]![0].content).toContain('6 PM'); expect(f.reader).not.toHaveBeenCalled();
  } finally { await f.host.stop(); }
});
