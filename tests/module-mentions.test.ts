import { describe, expect, it, vi } from 'vitest';
import { Client, Events, type Message, type ClientEvents } from 'discord.js';
import { ModuleHost } from '../packages/core/src/host.js';
import { readConfig } from '../packages/core/src/config.js';
import { dispatchModuleMessage } from '../apps/bot/src/module-messages.js';
import { exampleModule } from '../modules/example/bot.js';
import type { BotModule, ModuleMessage } from '../packages/module-sdk/src/server.js';
import type { ModuleState } from '../packages/module-sdk/src/browser.js';

const guildId = '100000000000000001', botId = '100000000000000002', userId = '100000000000000003';
const ownerId = '100000000000000004', adminRole = '100000000000000005', viewerRole = '100000000000000006';
const config = readConfig({ NODE_ENV: 'test', STORAGE_PROVIDER: 'postgres', DATABASE_URL: 'postgres://localhost/fixture',
  DISCORD_GUILD_ID: guildId, DASHBOARD_ORIGIN: 'http://localhost:3000', OWNER_USER_IDS: ownerId,
  DASHBOARD_ADMIN_ROLE_IDS: adminRole, DASHBOARD_VIEWER_ROLE_IDS: viewerRole });

async function fixture(start: BotModule['start'], intents = ['GuildMessages', 'MessageContent']) {
  let state: ModuleState = { moduleId: 'example', enabled: true, appliedEnabled: false, settings: { greeting: 'Hello' },
    appliedSettings: {}, desiredRevision: 1, appliedRevision: 0, applyError: null };
  const store = { getModule: vi.fn(async () => state), acknowledge: vi.fn(async () => {}), reject: vi.fn(async () => {}) };
  const logger = { info: vi.fn(), error: vi.fn() };
  const base = exampleModule();
  const host = new ModuleHost(guildId, [{ ...base, manifest: { ...base.manifest, requiredIntents: intents }, start }], store, logger);
  await host.sync();
  return { host, store, logger, async enabled(enabled: boolean) { state = { ...state, enabled, desiredRevision: state.desiredRevision + 1 }; await host.sync(); } };
}
function input(overrides: Partial<ModuleMessage> = {}): ModuleMessage {
  return { guildId, userId, channelId: 'general', access: null, options: {}, id: 'message', content: `<@${botId}> events`,
    mentionsBot: true, reply: async () => {}, ...overrides };
}
function gateway(host: ModuleHost) {
  let available = true;
  const member = { id: userId, guild: { id: guildId }, roles: { cache: new Map<string, unknown>() } };
  const fetch = vi.fn(async () => member), reply = vi.fn(async () => {});
  const message = { id: 'message', guildId, guild: { id: guildId, members: { fetch } }, author: { id: userId, bot: false },
    channelId: 'general', content: `<@${botId}> events`, webhookId: null, reply,
    mentions: { users: new Map([[botId, { id: botId }]]) } };
  const client = new Client({ intents: [] });
  let dispatch = Promise.resolve();
  client.on(Events.MessageCreate, value => { dispatch = dispatchModuleMessage(value, { config, host, botId, available: () => available }); });
  return { message, member, fetch, reply, setAvailable(value: boolean) { available = value; },
    async emit(overrides: Record<string, unknown> = {}) { client.emit(Events.MessageCreate, { ...message, ...overrides } as unknown as ClientEvents[Events.MessageCreate][0]); await dispatch; } };
}

describe('independent module mention subscriptions', () => {
  it('coexists with staff channels and authorizes each handler independently', async () => {
    const staff = vi.fn(async () => {}), mention = vi.fn(async () => {});
    const { host } = await fixture(async c => {
      c.onMessage({ channelIds: () => ['staff'], access: 'admin' }, staff);
      c.onBotMention({ access: 'member' }, mention);
    });
    expect(host.hasMessageInterest('general')).toBe(false);
    expect(host.hasMessageInterest('general', true)).toBe(true);
    expect(host.hasMessageInterest('staff')).toBe(true);
    await host.message(input({ channelId: 'staff' }));
    expect(staff).not.toHaveBeenCalled(); expect(mention).toHaveBeenCalledTimes(1);
    await host.message(input({ channelId: 'staff', access: 'admin' }));
    expect(staff).toHaveBeenCalledTimes(1); expect(mention).toHaveBeenCalledTimes(2);
    await host.message(input({ channelId: 'staff', access: 'owner', mentionsBot: undefined }));
    expect(staff).toHaveBeenCalledTimes(2); expect(mention).toHaveBeenCalledTimes(2);
    await host.message(input({ mentionsBot: false }));
    await host.message(input({ guildId: 'other' }));
    await host.message(input({ channelId: null }));
    await host.message(input({ content: 'x'.repeat(4001) }));
    expect(mention).toHaveBeenCalledTimes(2);
    await host.stop();
  });
  it('gates admin mentions and unregisters on disable, restart and shutdown', async () => {
    const mention = vi.fn(async () => {});
    const f = await fixture(async c => { c.onBotMention({ access: 'admin' }, mention); });
    for (const access of [null, 'viewer', 'admin', 'owner'] as const) await f.host.message(input({ access }));
    expect(mention).toHaveBeenCalledTimes(2);
    await f.enabled(false);
    expect(f.host.hasMessageInterest('general', true)).toBe(false);
    await f.host.message(input({ access: 'owner' })); expect(mention).toHaveBeenCalledTimes(2);
    await f.enabled(true);
    await f.host.message(input({ access: 'owner' })); expect(mention).toHaveBeenCalledTimes(3);
    await f.host.stop();
    expect(f.host.hasMessageInterest('general', true)).toBe(false);
    await f.host.message(input({ access: 'owner' })); expect(mention).toHaveBeenCalledTimes(3);
  });
  it.each([{ intents: ['GuildMessages'] }, { intents: ['MessageContent'] }, { intents: [] }])('requires both message intents ($intents)', async ({ intents }) => {
    const f = await fixture(async c => { c.onBotMention({ access: 'member' }, async () => {}); }, intents);
    expect(f.store.reject).toHaveBeenCalledOnce(); expect(f.host.hasMessageInterest('general', true)).toBe(false);
  });
  it('cleans up both registrations after duplicate registration or startup failure', async () => {
    for (const duplicate of [true, false]) {
      const f = await fixture(async c => {
        c.onMessage({ channelIds: () => ['staff'], access: 'admin' }, async () => {});
        c.onBotMention({ access: 'member' }, async () => {});
        if (duplicate) c.onBotMention({ access: 'member' }, async () => {});
        else throw new Error('fixture start failure');
      });
      expect(f.store.reject).toHaveBeenCalledOnce(); expect(f.host.hasMessageInterest('staff', true)).toBe(false);
    }
  });
  it('isolates a failed staff handler and drains a mention before shutting down', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const mention = vi.fn(async () => { await waiting; });
    const f = await fixture(async c => {
      c.onMessage({ channelIds: () => ['staff'], access: 'admin' }, async () => { throw new Error('private content'); });
      c.onBotMention({ access: 'member' }, mention);
    });
    const dispatch = f.host.message(input({ channelId: 'staff', access: 'admin' }));
    await vi.waitFor(() => expect(mention).toHaveBeenCalledOnce());
    const stopped = f.host.stop();
    expect(f.host.hasMessageInterest('general', true)).toBe(true);
    finish(); await dispatch; await stopped;
    expect(f.host.failures).toBe(1); expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain('private content');
    expect(f.host.hasMessageInterest('general', true)).toBe(false);
  });
});

describe('synthetic Gateway mention routing', () => {
  it.each([`<@${botId}>`, `<@!${botId}>`])('routes explicit %s with trusted metadata and bounded no-ping replies', async mention => {
    const handler = vi.fn(async (message: ModuleMessage) => { await message.reply('@everyone ' + 'x'.repeat(2500)); });
    const f = await fixture(async c => { c.onBotMention({ access: 'member' }, handler); });
    const g = gateway(f.host);
    await g.emit({ content: `${mention} events` });
    expect(g.fetch).toHaveBeenCalledExactlyOnceWith({ user: userId, force: true });
    expect(handler).toHaveBeenCalledOnce(); expect(handler.mock.calls[0]![0]).toMatchObject({ mentionsBot: true, access: null });
    expect(g.reply).toHaveBeenCalledExactlyOnceWith({ content: ('@everyone ' + 'x'.repeat(2500)).slice(0, 2000), allowedMentions: { parse: [], repliedUser: false } });
    await f.host.stop();
  });
  it('rejects nonmentions, wrong identity, inferred replies and excluded traffic without membership or storage work', async () => {
    const handler = vi.fn(async () => {});
    const f = await fixture(async c => { c.onBotMention({ access: 'member' }, handler); });
    f.store.getModule.mockClear(); f.store.acknowledge.mockClear();
    const g = gateway(f.host);
    for (const content of ['', 'events', `<@${userId}> events`, `<@!${userId}> events`, `<@&${botId}> events`, '@everyone events', `<@${botId}0> events`, `<@${botId}>` + 'x'.repeat(4000)]) await g.emit({ content });
    for (const overrides of [{ guildId: null, guild: null }, { guildId: 'other' }, { guild: { id: 'other' } }, { author: { id: userId, bot: true } }, { webhookId: 'webhook' }]) await g.emit(overrides);
    g.setAvailable(false); await g.emit(); g.setAvailable(true);
    await dispatchModuleMessage(g.message as unknown as Message, { config, host: f.host, botId: undefined, available: () => true });
    expect(g.fetch).not.toHaveBeenCalled(); expect(handler).not.toHaveBeenCalled();
    expect(f.store.getModule).not.toHaveBeenCalled(); expect(f.store.acknowledge).not.toHaveBeenCalled(); expect(f.store.reject).not.toHaveBeenCalled();
    await f.host.stop(); await g.emit(); expect(g.fetch).not.toHaveBeenCalled();
  });
  it('uses fresh roles for admin access and preserves independent staff dispatch', async () => {
    const mention = vi.fn(async () => {}), staff = vi.fn(async () => {});
    const f = await fixture(async c => {
      c.onMessage({ channelIds: () => ['staff'], access: 'member' }, staff);
      c.onBotMention({ access: 'admin' }, mention);
    });
    const g = gateway(f.host);
    await g.emit({ channelId: 'staff', content: 'ordinary staff message' });
    expect(staff).toHaveBeenCalledOnce(); expect(mention).not.toHaveBeenCalled();
    g.member.roles.cache.set(viewerRole, {}); await g.emit(); expect(mention).not.toHaveBeenCalled();
    g.member.roles.cache.set(adminRole, {}); await g.emit({ channelId: 'staff' });
    expect(staff).toHaveBeenCalledTimes(2); expect(mention).toHaveBeenCalledOnce();
    g.member.roles.cache.clear(); await g.emit(); expect(mention).toHaveBeenCalledOnce();
    g.member.id = ownerId; await g.emit({ author: { id: ownerId, bot: false } }); expect(mention).toHaveBeenCalledTimes(2);
    expect(g.fetch).toHaveBeenCalledTimes(5); await f.host.stop();
  });
  it('fails closed on failed membership, disabled modules and shutdown during membership or replies', async () => {
    let saved: ModuleMessage | undefined;
    const handler = vi.fn(async (message: ModuleMessage) => { saved = message; });
    const f = await fixture(async c => { c.onBotMention({ access: 'member' }, handler); });
    const g = gateway(f.host);
    g.fetch.mockRejectedValueOnce(new Error('membership unavailable'));
    await expect(g.emit()).rejects.toThrow('membership unavailable'); expect(handler).not.toHaveBeenCalled();
    g.fetch.mockImplementationOnce(async () => { g.setAvailable(false); return g.member; });
    await g.emit(); expect(handler).not.toHaveBeenCalled();
    g.setAvailable(true);
    g.fetch.mockImplementationOnce(async () => { await f.enabled(false); return g.member; });
    await g.emit(); expect(handler).not.toHaveBeenCalled();
    await f.enabled(true); await g.emit(); expect(handler).toHaveBeenCalledOnce();
    g.setAvailable(false); await saved!.reply('late reply'); expect(g.reply).not.toHaveBeenCalled();
    await f.host.stop();
  });
  it('does not dispatch a mismatched fetched identity or guild', async () => {
    const handler = vi.fn(async () => {});
    const f = await fixture(async c => { c.onBotMention({ access: 'member' }, handler); });
    const g = gateway(f.host);
    g.member.id = 'other'; await g.emit(); g.member.id = userId;
    g.member.guild.id = 'other'; await g.emit(); expect(handler).not.toHaveBeenCalled();
    await f.host.stop();
  });
  it('accepts the 4000-character boundary without truncating module input', async () => {
    const handler = vi.fn(async () => {});
    const f = await fixture(async c => { c.onBotMention({ access: 'member' }, handler); });
    const g = gateway(f.host), content = `<@${botId}>`.padEnd(4000, 'x');
    await g.emit({ content }); expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ content }));
    await g.emit({ content: content + 'x' }); expect(handler).toHaveBeenCalledOnce();
    expect(g.fetch).toHaveBeenCalledOnce(); await f.host.stop();
  });
});
