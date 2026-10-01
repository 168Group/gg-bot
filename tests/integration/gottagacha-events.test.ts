import { beforeAll, afterAll, describe, it, expect } from 'vitest';
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
    const host = new ModuleHost(guild, [createBot({ store, validateDestination: async () => {} })], store, { info() {}, error() {} });
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
    } finally { await host.stop(); await app.close(); }
  });
});
