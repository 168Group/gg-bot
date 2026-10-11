import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { localPocketBase } from '../../scripts/local-pocketbase.js';
import { localPostgres } from '../../scripts/local-postgres.js';
import { Database, type StorageDriver } from '../../packages/db/src/index.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { ModuleHost } from '../../packages/core/src/host.js';
import { createServer } from '../../apps/web/src/server.js';
import { readConfig } from '../../packages/core/src/config.js';
import { installedDefinitions } from '../../registry/definitions.js';
import { definition } from '../../modules/gottagacha-events/definition.js';
import { createBot } from '../../modules/gottagacha-events/bot.js';
import { refreshFixtures } from '../../modules/gottagacha-events/service.js';
import { saveDraft } from '../../modules/gottagacha-events/drafts.js';
import { runModuleJobs } from '../../packages/core/src/jobs.js';
import { eventWindow, type LiveSnapshot } from '../../modules/gottagacha-events/live-model.js';
import type { EventReader } from '../../modules/gottagacha-events/live-service.js';
const guild = '100000000000000001', owner = '100000000000000002', channel = '100000000000000010', viewerRole = '100000000000000004';
const moduleId = definition.manifest.id;
describe.each(['postgres', 'pocketbase'] as const)('GottaGacha events with %s', provider => {
  let driver: StorageDriver, pg: Awaited<ReturnType<typeof localPostgres>> | undefined, pb: Awaited<ReturnType<typeof localPocketBase>> | undefined, release: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    if (provider === 'postgres') { pg = await localPostgres(); const db = new Database(pg.url); await migrate(db); driver = db; }
    else { pb = await localPocketBase(); driver = pb.driver; }
    await driver.scope(guild).initialize('Fixture community', installedDefinitions(false));
    release = await driver.singleton(guild, () => {});
  });
  afterAll(async () => { await release?.(); await driver?.close(); await pg?.stop(); await pb?.stop(); });
  it('reads a fresh stored secret for each refresh and honors disablement over the environment', async () => {
    const store = driver.scope(guild), data = store.resources(moduleId).data;
    const environment = `gg_test_${'a'.repeat(64)}`, first = `gg_test_${'b'.repeat(64)}`, second = `gg_test_${'c'.repeat(64)}`;
    vi.stubEnv('MODULE_SECRET_ENCRYPTION_KEY', 'd'.repeat(64));
    vi.stubEnv('OMO_MODULE_GOTTAGACHA_EVENTS_GG_API_KEY', environment);
    const read = vi.fn<EventReader>().mockResolvedValue({ events: [], publicOccurrenceCount: 0, truncated: false });
    const newHost = () => new ModuleHost(guild, [createBot({ store, validateDestination: async () => {} }, read)], store, { info() {}, error() {} });
    let host = newHost();
    const secrets = store.secrets(definition);
    const refresh = async () => {
      // Open the persisted cooldown between independent test jobs; cooldown semantics have separate coverage.
      const cached = await data.get<LiveSnapshot>('api-snapshot');
      if (cached) await data.put('api-snapshot', { ...cached.value, nextRefreshAt: 0 }, cached.revision);
      const state = await store.getModule(moduleId);
      const id = await store.resources(moduleId).jobs.enqueue('refresh-api', { revision: state.appliedRevision }, crypto.randomUUID());
      await runModuleJobs(store, host);
      return store.call('jobGet', { id });
    };
    try {
      const initial = await store.getModule(moduleId);
      await store.updateModule(moduleId, initial.desiredRevision, owner, { enabled: true, settings: { mode: 'api-readonly', staffChannelIds: [] } });
      let metadata = await secrets.replace('GG_API_KEY', 0, first);
      await host.sync(); expect(read).not.toHaveBeenCalled();
      await runModuleJobs(store, host); // Initial automatic refresh, without a dashboard request.
      expect((await data.get<LiveSnapshot>('api-snapshot'))?.value.state).toBe('ready');
      expect(read.mock.calls[0]?.[0]).toBe(first);
      await host.stop(); host = newHost(); await host.sync(); await runModuleJobs(store, host);
      expect(read).toHaveBeenCalledOnce(); // Restart reuses the completed hourly key.
      metadata = await secrets.replace('GG_API_KEY', metadata.revision, second);
      expect((await refresh())?.state).toBe('completed'); expect(read.mock.calls[1]?.[0]).toBe(second);
      metadata = await secrets.disable('GG_API_KEY', metadata.revision);
      expect((await refresh())?.state).toBe('failed'); expect(read).toHaveBeenCalledTimes(2);
      expect((await data.get<LiveSnapshot>('api-snapshot'))!.value).toMatchObject({ state: 'unavailable', events: [] });
      metadata = await secrets.replace('GG_API_KEY', metadata.revision, 'invalid-format');
      expect((await refresh())?.state).toBe('failed'); expect(read).toHaveBeenCalledTimes(2);
      await secrets.environment('GG_API_KEY', metadata.revision);
      expect((await refresh())?.state).toBe('completed'); expect(read.mock.calls[2]?.[0]).toBe(environment);
      const stored = JSON.stringify({ state: await store.getModule(moduleId), records: await data.list({ limit: 100 }) });
      for (const value of [environment, first, second, 'invalid-format']) expect(stored).not.toContain(value);
    } finally {
      await host.stop(); vi.unstubAllEnvs();
      const cached = await data.get('api-snapshot'); if (cached) await data.delete('api-snapshot', cached.revision);
    }
  });
  it('persists dedupe through a new module instance, scopes records and expires drafts', async () => {
    const store = driver.scope(guild), data = store.resources(moduleId).data;
    expect(await refreshFixtures(data)).toBe(3);
    expect(await refreshFixtures(driver.scope(guild).resources(moduleId).data)).toBe(0);
    expect((await data.list({ prefix: 'preview:' })).records).toHaveLength(3);
    expect(await store.resources('logging').data.get('fixture-snapshot')).toBeNull();
    const draft = await saveDraft(data, { id: 'fixture-message', userId: owner, channelId: channel, content: 'event:\nTitle: Preview only' });
    const record = await data.get(`draft:${draft.id}`);
    expect(record).not.toBeNull();
    await data.put(`draft:${draft.id}`, record!.value, record!.revision, 1000);
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(await data.get(`draft:${draft.id}`)).toBeNull();
  });
  it('protects routes, rejects stale work and executes a fixture job through the real host', async () => {
    const store = driver.scope(guild);
    await store.replaceCatalog([{ id: channel, name: 'staff-events', type: 0, parentId: null, canSend: true }]);
    let viewer = false;
    const config = readConfig({ NODE_ENV: 'test', STORAGE_PROVIDER: provider, ...(pg ? { DATABASE_URL: pg.url } : { POCKETBASE_URL: pb!.url, POCKETBASE_SERVICE_KEY: pb!.key }), DISCORD_GUILD_ID: guild, OWNER_USER_IDS: owner, DASHBOARD_VIEWER_ROLE_IDS: viewerRole, DASHBOARD_ORIGIN: 'http://localhost:3000' });
    const { app } = await createServer({ config, db: driver, clientId: 'fixture', encryptionKey: 'c'.repeat(64), identity: {
      async exchange() { return { access_token: 'fixture', refresh_token: 'fixture', expires_at: Date.now() + 3600000 }; },
      async identity() { return { id: viewer ? '100000000000000005' : owner, username: 'Fixture staff' }; },
      async membership(tokens) { return { roles: viewer ? [viewerRole] : [], tokens }; }
    } });
    const apiKey = `gg_test_${'b'.repeat(64)}`, date = eventWindow().startDate;
    const apiReader = vi.fn(async () => ({ events: [{ key: `public:${date}`, id: 'public', title: 'Synthetic public gathering', eventDate: date, startTime: '18:00:00', endTime: null, location: 'Warren', updatedAt: new Date().toISOString() }], publicOccurrenceCount: 1, truncated: false }));
    vi.stubEnv('OMO_MODULE_GOTTAGACHA_EVENTS_GG_API_KEY', '');
    const host = new ModuleHost(guild, [createBot({ store, validateDestination: async () => {} }, apiReader)], store, { info() {}, error() {} });
    const login = async () => {
      const redirect = await app.inject('/auth/discord'), state = new URL(redirect.headers.location!).searchParams.get('state')!;
      const callback = await app.inject({ url: `/auth/discord/callback?code=fixture&state=${state}`, cookies: { omo_oauth: state } });
      const cookies = { omo_session: callback.cookies.find(cookie => cookie.name === 'omo_session')!.value };
      const me = await app.inject({ url: '/api/me', cookies });
      return { cookies, headers: { origin: 'http://localhost:3000', 'x-csrf-token': me.json().data.csrf as string } };
    };
    const root = `/api/modules/${moduleId}`;
    try {
      expect((await app.inject(`${root}/snapshot`)).statusCode).toBe(401);
      const session = await login();
      expect((await app.inject({ url: `${root}/snapshot?guildId=other`, ...session })).statusCode).toBe(400);
      expect((await app.inject({ url: `${root}/refresh-fixtures`, method: 'POST', ...session, payload: { key: crypto.randomUUID() } })).statusCode).toBe(409);
      expect((await app.inject({ url: `${root}/settings`, method: 'PUT', ...session, headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'forged' }, payload: { revision: 1, settings: { mode: 'fixtures', staffChannelIds: [] } } })).statusCode).toBe(403);
      expect((await app.inject({ url: `${root}/settings`, method: 'PUT', ...session, payload: { revision: 1, settings: { mode: 'fixtures', staffChannelIds: ['100000000000000099'] } } })).statusCode).toBe(400);
      const initial = await store.getModule(moduleId);
      await store.updateModule(moduleId, initial.desiredRevision, owner, { enabled: true, settings: { mode: 'fixtures', staffChannelIds: [channel] } });
      await host.sync();
      const key = crypto.randomUUID();
      const run = () => app.inject({ url: `${root}/refresh-fixtures`, method: 'POST', ...session, payload: { key } });
      const response = await run(); expect(response.statusCode).toBe(202);
      expect((await run()).json().data.id).toBe(response.json().data.id);
      await runModuleJobs(store, host);
      const job = await app.inject({ url: `/api/jobs/${response.json().data.id}`, ...session });
      expect(job.json().data.state).toBe('completed');
      expect((await app.inject({ url: `${root}/snapshot`, ...session })).json().data.value.source).toBe('fixture');
      expect((await app.inject({ url: `${root}/previews`, ...session })).json().data.records).toHaveLength(3);
      viewer = true; const reader = await login();
      expect((await app.inject({ url: `${root}/snapshot`, ...reader })).statusCode).toBe(200);
      expect((await app.inject({ url: `${root}/drafts`, ...reader })).statusCode).toBe(403);
      expect((await app.inject({ url: `${root}/refresh-fixtures`, method: 'POST', ...reader, payload: { key: crypto.randomUUID() } })).statusCode).toBe(403);
      expect(apiReader).not.toHaveBeenCalled();
      const fixtures = await store.getModule(moduleId);
      await store.updateModule(moduleId, fixtures.desiredRevision, owner, { settings: { mode: 'api-readonly', staffChannelIds: [] } });
      await host.sync();
      expect((await store.getModule(moduleId)).applyError).toBeNull();
      expect((await app.inject({ url: `${root}/api-snapshot`, ...session })).json().data).toBeNull();
      await runModuleJobs(store, host); // Drain the automatic attempt with the missing key.
      const missing = await app.inject({ url: `${root}/refresh-api`, method: 'POST', ...session, payload: { key: crypto.randomUUID() } });
      expect(missing.statusCode).toBe(202); await runModuleJobs(store, host);
      expect((await store.call('jobGet', { id: missing.json().data.id }))?.state).toBe('failed');
      const unavailable = (await store.resources(moduleId).data.get<LiveSnapshot>('api-snapshot'))!;
      expect(unavailable.value).toMatchObject({ state: 'unavailable', events: [] });
      await store.resources(moduleId).data.put('api-snapshot', { ...unavailable.value, nextRefreshAt: 0 }, unavailable.revision);
      vi.stubEnv('OMO_MODULE_GOTTAGACHA_EVENTS_GG_API_KEY', apiKey);
      await host.sync();
      expect((await store.getModule(moduleId)).applyError).toBeNull();
      expect(apiReader).not.toHaveBeenCalled(); // No reads on enable or settings application.
      expect((await app.inject({ url: `${root}/api-snapshot`, ...reader })).statusCode).toBe(200);
      expect((await app.inject({ url: `${root}/refresh-api`, method: 'POST', ...reader, payload: { key: crypto.randomUUID() } })).statusCode).toBe(403);
      expect((await app.inject({ url: `${root}/refresh-api`, method: 'POST', ...session, headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'forged' }, payload: { key: crypto.randomUUID() } })).statusCode).toBe(403);
      const liveKey = crypto.randomUUID();
      const liveRun = () => app.inject({ url: `${root}/refresh-api`, method: 'POST', ...session, payload: { key: liveKey } });
      const liveJob = await liveRun(); expect(liveJob.statusCode).toBe(202);
      expect((await liveRun()).json().data.id).toBe(liveJob.json().data.id);
      await runModuleJobs(store, host);
      expect((await app.inject({ url: `/api/jobs/${liveJob.json().data.id}`, ...session })).json().data.state).toBe('completed');
      expect(apiReader).toHaveBeenCalledOnce(); expect(apiReader.mock.calls[0]).toEqual([apiKey, eventWindow()]);
      const live = await app.inject({ url: `${root}/api-snapshot`, ...reader });
      expect(live.json().data.events[0].title).toBe('Synthetic public gathering');
      expect(live.body).not.toContain('jobId'); expect(live.body).not.toContain(apiKey);
      const command = { guildId: guild, userId: owner, channelId: channel, access: null, options: {} };
      expect(await host.command('events upcoming', command)).toContain('Synthetic public gathering');
      expect(await host.command('events upcoming', { ...command, guildId: 'other' })).toContain('does not have access');
      const mentionReply = vi.fn<(content: string) => Promise<void>>(async () => {});
      await host.message({ ...command, id: 'public-events-mention', content: '<@100000000000000002> events', mentionsBot: true, reply: mentionReply });
      expect(mentionReply).toHaveBeenCalledOnce();
      expect(mentionReply).toHaveBeenCalledWith(await host.command('events upcoming', command));
      expect(apiReader).toHaveBeenCalledOnce(); // Browsing never calls the API.
      const data = store.resources(moduleId).data, cached = (await data.get<LiveSnapshot>('api-snapshot'))!;
      await data.put('api-snapshot', { ...cached.value, freshUntil: Date.now() - 1 }, cached.revision);
      expect((await app.inject({ url: `${root}/api-snapshot`, ...reader })).json().data.events).toEqual([]);
      expect(await host.command('events upcoming', command)).not.toContain('Synthetic public gathering');
      const current = await store.getModule(moduleId);
      await store.updateModule(moduleId, current.desiredRevision, owner, { enabled: false }); await host.sync();
      expect((await app.inject({ url: `${root}/api-snapshot`, ...session })).json().data).toBeNull();
      expect((await app.inject({ url: `${root}/refresh-api`, method: 'POST', ...session, payload: { key: crypto.randomUUID() } })).statusCode).toBe(409);
    } finally { await host.stop(); await app.close(); vi.unstubAllEnvs(); }
  });
});
