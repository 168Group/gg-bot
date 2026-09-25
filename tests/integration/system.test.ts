import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { localPostgres } from '../../scripts/local-postgres.js';
import { Database } from '../../packages/db/src/index.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { loggingDefinition } from '../../modules/logging/manifest.js';
import { LoggingRepository } from '../../modules/logging/bot/repository.js';
import { defaultLoggingSettings } from '../../modules/logging/shared/settings.js';
import { DeliveryWorker, DestinationError, type DeliveryTransport } from '../../modules/logging/bot/delivery.js';
import { ModuleHost } from '../../packages/core/src/host.js';
import { botRegistry } from '../../registry/bot.js';
import { readConfig } from '../../packages/core/src/config.js';
import { createServer } from '../../apps/web/src/server.js';
import type { Observation } from '../../packages/module-sdk/src/server.js';
import { runModuleJobs } from '../../packages/core/src/jobs.js';

let postgres: Awaited<ReturnType<typeof localPostgres>>, db: Database;
const guild = '100000000000000001', owner = '100000000000000002', destination = '100000000000000010';
const settings = { ...defaultLoggingSettings, destinationId: destination };
const observation = (key: string = crypto.randomUUID()): Observation => ({ guildId: guild, sourceKey: key, type: 'channel.created', subjectId: '100000000000000030', channelId: '100000000000000030', parentId: null, label: 'test-channel', observedAt: new Date().toISOString(), before: null, after: { name: 'test-channel' } });
beforeAll(async () => { postgres = await localPostgres(); db = new Database(postgres.url); await migrate(db); });
afterAll(async () => { await db?.close(); await postgres?.stop(); });
beforeEach(async () => { await db.query('TRUNCATE guild_config,dashboard_session,oauth_state CASCADE'); await db.scope(guild).initialize('Test server', [loggingDefinition]); });
async function active() {
  const store = db.scope(guild), repository = new LoggingRepository(store);
  const state = await store.updateModule('logging', 1, owner, { enabled: true, settings });
  await store.acknowledge('logging', state);
  return repository;
}
describe('storage and delivery', () => {
  it('runs migrations twice and excludes competing bot workers', async () => {
    await migrate(db);
    const release = await db.singleton(guild, () => {});
    await expect(db.singleton(guild, () => {})).rejects.toThrow('Another bot');
    await release(); const releaseAgain = await db.singleton(guild, () => {}); await releaseAgain();
  });
  it('persists desired/applied revisions across connections, rejects stale writes, isolates guilds', async () => {
    const store = db.scope(guild);
    await store.updateModule('logging', 1, owner, { settings });
    await expect(store.updateModule('logging', 1, owner, { enabled: true })).rejects.toMatchObject({ statusCode: 409 });
    const reopened = new Database(postgres.url);
    try { const state = await reopened.scope(guild).getModule('logging'); expect(state.desiredRevision).toBe(2); expect(state.appliedRevision).toBe(0); } finally { await reopened.close(); }
    await expect(db.scope('200000000000000001').getModule('logging')).rejects.toMatchObject({ statusCode: 404 });
    expect((await db.query('SELECT * FROM settings_audit WHERE guild_id=$1', [guild])).length).toBe(1);
  });
  it('commits the event and queue atomically, deduplicates source IDs, preserves distinct repeats and restart delivery', async () => {
    const repository = await active(); const event = observation('stable-key');
    await repository.capture(event, settings, 2); await repository.capture(event, settings, 2);
    await repository.capture({ ...event, sourceKey: 'another-occurrence' }, settings, 2);
    await repository.capture({ ...event, guildId: 'wrong' }, settings, 2);
    expect((await repository.list({ limit: 50 })).events).toHaveLength(2);
    let sends = 0;
    const transport: DeliveryTransport = { async validate() {}, async find() { return null; }, async send() { sends++; return destination; } };
    await new DeliveryWorker(new LoggingRepository(db.scope(guild)), transport).tick();
    expect(sends).toBe(1); expect((await db.query(`SELECT id FROM logging_delivery WHERE state='sent'`)).length).toBe(1);
  });
  it('reconciles crash-after-send, blocks 403s without hammering, and cancels disabled deliveries', async () => {
    const repository = await active(); await repository.capture(observation(), settings, 2);
    await db.query(`UPDATE logging_delivery SET state='sending',lease_until=now()-interval '1 second',attempts=1`);
    let sends = 0;
    await new DeliveryWorker(repository, { async validate() {}, async find() { return destination; }, async send() { sends++; return destination; } }).tick();
    expect(sends).toBe(0); expect((await db.query('SELECT state FROM logging_delivery'))[0]?.state).toBe('sent');
    await repository.capture(observation(), settings, 2);
    let validations = 0;
    const blocked = new DeliveryWorker(repository, { async validate() { validations++; throw new DestinationError(true); }, async find() { return null; }, async send() { throw new Error('must not send'); } });
    await blocked.tick(); await blocked.tick(); expect(validations).toBe(1);
    expect((await db.query(`SELECT state FROM logging_delivery WHERE state='blocked'`))).toHaveLength(1);
    await repository.cancelPending(); expect((await db.query(`SELECT state FROM logging_delivery WHERE state='cancelled'`))).toHaveLength(1);
  });
  it('retries transient failures without leaking error content', async () => {
    const repository = await active(); await repository.capture(observation(), settings, 2);
    await new DeliveryWorker(repository, { async validate() {}, async find() { return null; }, async send() { throw new Error('SECRET fake upstream response'); } }).tick();
    const [row] = await db.query('SELECT * FROM logging_delivery');
    expect(row?.state).toBe('pending'); expect(row?.last_error).not.toContain('SECRET'); expect(new Date(row?.next_attempt).getTime()).toBeGreaterThan(Date.now());
  });
  it('applies exclusions before storage, cancels queued excluded events and cleans disabled modules', async () => {
    const repository = await active(), event = observation();
    await repository.capture(event, { ...settings, excludedChannelIds: [event.subjectId] }, 2);
    expect((await repository.list({ limit: 50 })).events).toHaveLength(0);
    await repository.capture(event, settings, 2);
    await repository.apply({ ...settings, excludedChannelIds: [event.subjectId] });
    expect((await db.query('SELECT state FROM logging_delivery'))[0]?.state).toBe('cancelled');
    await db.query(`UPDATE logging_event SET expires_at=now()-interval '1 second'`);
    await repository.cleanup(); expect(await db.query('SELECT * FROM logging_delivery')).toHaveLength(0);
  });
  it('does not apply invalid destinations and cancels pending work before disable is acknowledged', async () => {
    const store = db.scope(guild), repository = new LoggingRepository(store);
    await store.updateModule('logging', 1, owner, { enabled: true, settings });
    const host = new ModuleHost(guild, botRegistry(repository, async id => { if (id !== destination) throw new Error('missing'); }, true), store, { info() {}, error() {} });
    await host.sync(); await host.dispatch(observation());
    await store.updateModule('logging', 2, owner, { settings: { ...settings, destinationId: '100000000000000099' } });
    await host.sync(); expect((await store.getModule('logging')).appliedRevision).toBe(2);
    expect((await store.getModule('logging')).applyError).not.toBeNull();
    await store.updateModule('logging', 3, owner, { enabled: false }); await host.sync();
    expect((await store.getModule('logging')).appliedEnabled).toBe(false); expect((await db.query('SELECT state FROM logging_delivery'))[0]?.state).toBe('cancelled');
    await host.stop();
  });
  it('deduplicates test jobs and expires offline requests without producing events', async () => {
    const repository = await active(), key = crypto.randomUUID();
    const id = await repository.store.enqueueJob('logging', 'test', {}, key);
    expect(await repository.store.enqueueJob('logging', 'test', {}, key)).toBe(id);
    await db.query(`UPDATE core_job SET expires_at=now()-interval '1 second'`);
    const jobsHost = new ModuleHost(guild, botRegistry(repository, async () => {}, true), repository.store, {info(){},error(){}}); await jobsHost.sync(); await runModuleJobs(repository.store, jobsHost); await jobsHost.stop(); await repository.store.cleanup();
    expect((await db.query('SELECT state FROM core_job'))[0]?.state).toBe('expired');
    expect((await repository.list({ limit: 50 })).events).toHaveLength(0);
  });
});
describe('protected dashboard', () => {
  async function server() {
    let roles: string[] = [], member = true;
    const config = readConfig({ NODE_ENV: 'test', STORAGE_PROVIDER: 'postgres', DATABASE_URL: postgres.url, DISCORD_GUILD_ID: guild, OWNER_USER_IDS: owner, DASHBOARD_VIEWER_ROLE_IDS: '100000000000000004', DASHBOARD_ORIGIN: 'http://localhost:3000' });
    const created = await createServer({ config, db, clientId: 'test', encryptionKey: 'a'.repeat(64), identity: {
      async exchange() { return { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_at: Date.now() + 3600000 }; },
      async identity() { return { id: roles.length ? '100000000000000005' : owner, username: 'Staff' }; },
      async membership(tokens) { if (!member) throw new Error('no member'); return { roles, tokens }; }
    } });
    const login = async () => {
      const redirect = await created.app.inject('/auth/discord');
      const state = new URL(redirect.headers.location!).searchParams.get('state')!;
      const callback = await created.app.inject({ url: `/auth/discord/callback?code=fixture&state=${state}`, cookies: { omo_oauth: state } });
      expect(callback.statusCode).toBe(302);
      const id = callback.cookies.find(cookie => cookie.name === 'omo_session')!.value;
      const me = await created.app.inject({ url: '/api/me', cookies: { omo_session: id } });
      return { id, csrf: me.json().data.csrf as string };
    };
    return { ...created, login, setRoles: (value: string[]) => { roles = value; }, revoke: () => { member = false; } };
  }
  it('denies anonymous direct APIs, forged CSRF, unknown guild inputs, role revocation and reused OAuth states', async () => {
    const { app, login, revoke } = await server();
    try {
      expect((await app.inject('/api/modules/logging/events')).statusCode).toBe(401);
      const session = await login();
      const cookies = { omo_session: session.id };
      expect((await app.inject({ url: '/api/modules/logging/events?guildId=other', cookies })).statusCode).toBe(400);
      expect((await app.inject({ method: 'PATCH', url: '/api/modules/logging/state', cookies, headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'forged' }, payload: { revision: 1, enabled: true } })).statusCode).toBe(403);
      const headers = { origin: 'http://localhost:3000', 'x-csrf-token': session.csrf };
      expect((await app.inject({ method: 'PATCH', url: '/api/modules/logging/state', cookies, headers, payload: { revision: 1, enabled: true } })).statusCode).toBe(200);
      revoke(); expect((await app.inject({ method: 'POST', url: '/api/modules/logging/test', cookies, headers, payload: { key: crypto.randomUUID() } })).statusCode).toBe(403);
      expect((await app.inject({ url: '/api/me', cookies })).statusCode).toBe(401);
      const stateResponse = await app.inject('/auth/discord'); const state = new URL(stateResponse.headers.location!).searchParams.get('state')!;
      await app.inject({ url: `/auth/discord/callback?code=test&state=${state}`, cookies: { omo_oauth: state } });
      expect((await app.inject({ url: `/auth/discord/callback?code=test&state=${state}`, cookies: { omo_oauth: state } })).statusCode).toBe(403);
      expect((await app.inject('/health/live')).json()).toEqual({ ok: true });
    } finally { await app.close(); }
  });
  it('allows viewer reads, denies mutations, permits CSRF-protected logout, and reports offline bot honestly', async () => {
    const { app, login, setRoles } = await server(); setRoles(['100000000000000004']);
    try {
      const session = await login(), cookies = { omo_session: session.id }, headers = { origin: 'http://localhost:3000', 'x-csrf-token': session.csrf };
      const status = await app.inject({ url: '/api/status', cookies }); expect(status.json().data.online).toBe(false);
      expect((await app.inject({ url: '/api/modules/logging/settings', cookies })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/modules/logging/test', method: 'POST', cookies, headers, payload: { key: crypto.randomUUID() } })).statusCode).toBe(403);
      expect((await app.inject({ url: '/auth/logout', method: 'POST', cookies, headers, payload: {} })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/me', cookies })).statusCode).toBe(401);
    } finally { await app.close(); }
  });
});
