import { z } from 'zod';
import { exampleDefinition } from '../../modules/example/definition.js';
import { exampleModule } from '../../modules/example/bot.js';
import { ModuleHost } from '../../packages/core/src/host.js';
import { runModuleJobs } from '../../packages/core/src/jobs.js';
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { localPocketBase } from '../../scripts/local-pocketbase.js';
import { localPostgres } from '../../scripts/local-postgres.js';
import { Database } from '../../packages/db/src/index.js';
import { PocketBaseAdapter } from '../../packages/db/src/pocketbase.js';
import { migrate } from '../../packages/db/src/migrate.js';
import type { StorageDriver } from '../../packages/db/src/contracts.js';
import { loggingDefinition } from '../../modules/logging/manifest.js';
import { LoggingRepository } from '../../modules/logging/bot/repository.js';
import { defaultLoggingSettings } from '../../modules/logging/shared/settings.js';
import { DeliveryWorker } from '../../modules/logging/bot/delivery.js';
import { createServer } from '../../apps/web/src/server.js';
import { readConfig } from '../../packages/core/src/config.js';
import type { Observation } from '../../packages/module-sdk/src/server.js';
const guild = '100000000000000001', owner = '100000000000000002', destination = '100000000000000010';
const settings = { ...defaultLoggingSettings, destinationId: destination };
const event = (sourceKey: string = randomUUID()): Observation => ({ guildId: guild, sourceKey, type: 'channel.created', subjectId: '100000000000000030', channelId: '100000000000000030', parentId: null, label: 'test-channel', observedAt: new Date().toISOString(), before: null, after: { name: 'test-channel' } });

describe.each(['postgres', 'pocketbase'] as const)('%s storage contract', provider => {
  let pg: Awaited<ReturnType<typeof localPostgres>> | undefined, pb: Awaited<ReturnType<typeof localPocketBase>> | undefined;
  let driver: StorageDriver, release: (() => Promise<void>) | undefined;
  beforeAll(async () => { if (provider === 'postgres') pg = await localPostgres(); });
  afterAll(async () => { await pg?.stop(); });
  beforeEach(async () => {
    if (provider === 'postgres') { const db = new Database(pg!.url); await migrate(db); await db.query('TRUNCATE guild_config,dashboard_session,oauth_state,worker_lease CASCADE'); driver = db; }
    else { pb = await localPocketBase(); driver = pb.driver; }
    await driver.scope(guild).initialize('Test community', [loggingDefinition]);
    release = await driver.singleton(guild, () => {});
  });
  afterEach(async () => { await release?.(); release = undefined; await driver?.close(); await pb?.stop(); pb = undefined; });
  const store = () => driver.scope(guild);
  const repository = () => new LoggingRepository(store());
  async function activate() { const state = await store().updateModule('logging', 1, owner, { enabled: true, settings }); await store().acknowledge('logging', state); }
  async function mutateForTest(pgSql: string, sqliteSql: string) {
    if (provider === 'postgres') await (driver as Database).query(pgSql);
    else { const sqlite = new DatabaseSync(`${pb!.directory}/pb_data/data.db`); try { sqlite.exec(sqliteSql); } finally { sqlite.close(); } }
  }
  it('handles health, catalog and saved/applied revisions identically', async () => {
    await store().ready(); await store().replaceCatalog([{ id: destination, name: 'staff-logs', type: 0, parentId: null, canSend: true }]);
    expect((await store().catalog())[0]?.canSend).toBe(true);
    await activate(); expect((await store().getModule('logging')).appliedEnabled).toBe(true);
    expect((await store().getModule('logging')).appliedSettings).toEqual(settings);
    await store().heartbeat('online', { gateway: true }); await store().incident('A known gap.', null);
    const status = await store().call('status', {}); expect(status.health?.status).toBe('online'); expect(status.incidents[0]?.dropped_count).toBeNull();
  });
  it('serializes concurrent settings edits and rejects the stale writer', async () => {
    const outcomes = await Promise.allSettled([store().updateModule('logging', 1, owner, { settings }), store().updateModule('logging', 1, owner, { enabled: true })]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(o => o.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    expect((await store().getModule('logging')).desiredRevision).toBe(2);
  });
  it('deduplicates events and paginates stable IDs without losing repeated actions', async () => {
    await activate(); const observation = event('same-source');
    await Promise.all([repository().capture(observation, settings, 2), repository().capture(observation, settings, 2)]);
    await repository().capture({ ...observation, sourceKey: 'new-action' }, settings, 2);
    const first = await repository().list({ limit: 1 }); expect(first.events).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    const next = await repository().list({ limit: 1, cursor: first.nextCursor! }); expect(next.events).toHaveLength(1); expect(next.events[0]?.id).not.toBe(first.events[0]?.id); expect(next.nextCursor).toBeNull();
    expect((await store().call('status', {})).queue[0]?.count).toBe(2);
    await expect(repository().list({ limit: 1, cursor: 'not-json' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('claims one delivery at a time and ignores stale finalization tokens', async () => {
    await activate(); await repository().capture(event(), settings, 2);
    const claims = await Promise.all([store().call('deliveryClaim', {}), store().call('deliveryClaim', {})]);
    expect(claims.filter(Boolean)).toHaveLength(1); const claimed = claims.find(Boolean)!;
    await store().call('deliveryFinish', { id: claimed.id, claimToken: randomUUID(), state: 'sent', messageId: destination });
    expect((await repository().detail(claimed.event_id)).deliveryState).toBe('sending');
    await store().call('deliveryFinish', { id: claimed.id, claimToken: claimed.claim_token, state: 'sent', messageId: destination });
    expect((await repository().detail(claimed.event_id)).deliveryState).toBe('sent');
  });
  it('recovers an expired lease and never accepts the old claim after reclaim', async () => {
    await activate(); await repository().capture(event(), settings, 2);
    const original = (await store().call('deliveryClaim', {}))!;
    await mutateForTest(`UPDATE logging_delivery SET lease_until=now()-interval '1 second'`, `UPDATE omo_delivery SET lease_until=0`);
    const reclaimed = (await store().call('deliveryClaim', {}))!;
    expect(reclaimed.claim_token).not.toBe(original.claim_token); expect(reclaimed.attempts).toBe(2);
    await store().call('deliveryFinish', { id: original.id, claimToken: original.claim_token, state: 'failed' });
    expect((await repository().detail(original.event_id)).deliveryState).toBe('sending');
    await store().call('deliveryFinish', { id: reclaimed.id, claimToken: reclaimed.claim_token, state: 'sent', messageId: destination });
    expect((await repository().detail(original.event_id)).deliveryState).toBe('sent');
  });
  it('preserves queued work through a storage reconnect or PocketBase restart', async () => {
    await activate(); await repository().capture(event(), settings, 2);
    await release!(); release = undefined;
    if (provider === 'pocketbase') await pb!.restart();
    else { await driver.close(); driver = new Database(pg!.url); }
    release = await driver.singleton(guild, () => {});
    expect((await store().getModule('logging')).desiredRevision).toBe(2);
    let sends = 0;
    await new DeliveryWorker(repository(), { async validate() {}, async find() { return null; }, async send() { sends++; return destination; } }).tick();
    expect(sends).toBe(1); expect((await repository().list({ limit: 50 })).events[0]?.deliveryState).toBe('sent');
  });
  it('enforces exclusions and event expiry before queue claims and retries', async () => {
    await activate(); const observation = event();
    await repository().capture(observation, { ...settings, excludedChannelIds: [observation.subjectId] }, 2);
    expect((await repository().list({ limit: 50 })).events).toHaveLength(0);
    await repository().capture(observation, settings, 2); const claim = (await store().call('deliveryClaim', {}))!;
    await store().call('deliveryFinish', { id: claim.id, claimToken: claim.claim_token, state: 'blocked' });
    await mutateForTest(`UPDATE logging_event SET expires_at=now()-interval '1 second'`, `UPDATE omo_event SET expires_at=0`);
    expect(await store().call('deliveryRetry', { id: claim.id })).toBe(false);
    expect(await store().call('deliveryClaim', {})).toBeNull();
    await repository().cleanup(); expect((await store().call('status', {})).queue).toHaveLength(0);
  });
  it('persists idempotent jobs, expires stale requests and fences job completion', async () => {
    const key = randomUUID(), id = await store().enqueueJob('logging', 'test', {}, key);
    expect(await store().enqueueJob('logging', 'test', {}, key)).toBe(id);
    const job = (await store().call('jobClaim', {}))!;
    await store().call('jobFinish', { id, claimToken: randomUUID(), error: null, message: 'wrong' });
    expect((await store().call('jobGet', { id })).state).toBe('sending');
    await store().call('jobFinish', { id, claimToken: job.claim_token!, error: null, message: 'right' });
    expect((await store().call('jobGet', { id })).result?.message).toBe('right');
    const stale = await store().enqueueJob('logging', 'test', {}, randomUUID());
    await mutateForTest(`UPDATE core_job SET expires_at=now()-interval '1 second' WHERE id='${stale}'`, `UPDATE omo_job SET expires_at=0 WHERE id='${stale}'`);
    await store().cleanup(); expect((await store().call('jobGet', { id: stale })).state).toBe('expired');
  });
  it('consumes OAuth state once and isolates/invalidates encrypted sessions', async () => {
    const hash = randomUUID(); await store().call('oauthCreate', { hash });
    expect(await store().call('oauthConsume', { hash })).toBe(true); expect(await store().call('oauthConsume', { hash })).toBe(false);
    await store().call('sessionCreate', { id_hash: hash, user_id: owner, label: 'Owner', tokens: 'encrypted', csrf_hash: 'hashed-csrf', access: 'owner' });
    expect((await store().call('sessionGet', { hash }))?.tokens).toBe('encrypted');
    await store().call('sessionRefresh', { hash, tokens: 'new-encrypted', access: 'viewer' }); await store().call('sessionTouch', { hash });
    expect((await store().call('sessionGet', { hash }))?.access).toBe('viewer');
    await store().call('sessionDelete', { hash }); expect(await store().call('sessionGet', { hash })).toBeNull();
  });
  it('rejects a competing worker and allows clean takeover', async () => {
    const second = provider === 'postgres' ? new Database(pg!.url) : new PocketBaseAdapter(pb!.url, pb!.key);
    try {
      await expect(second.singleton(guild, () => {})).rejects.toThrow('Another bot');
      await release!(); release = undefined;
      const cleanup = await second.singleton(guild, () => {}); await cleanup();
    } finally { await second.close(); }
  });
  it('runs the protected API and rejects CSRF, viewers and revoked membership', async () => {
    let member = true;
    const config = readConfig({ NODE_ENV: 'test', STORAGE_PROVIDER: provider, ...(provider === 'postgres' ? { DATABASE_URL: pg!.url } : { POCKETBASE_URL: pb!.url, POCKETBASE_SERVICE_KEY: pb!.key }), DISCORD_GUILD_ID: guild, OWNER_USER_IDS: owner, DASHBOARD_ORIGIN: 'http://localhost:3000' });
    const { app } = await createServer({ config, db: driver, demo: true, clientId: 'fixture', encryptionKey: 'a'.repeat(64), identity: { async exchange() { throw new Error('unused'); }, async identity() { throw new Error('unused'); }, async membership(tokens) { if (!member) throw new Error('revoked'); return { tokens, roles: [] }; } } });
    try {
      expect((await app.inject('/api/modules/logging/events')).statusCode).toBe(401);
      const login = await app.inject('/auth/demo'), cookies = { omo_session: login.cookies.find(c => c.name === 'omo_session')!.value };
      const me = (await app.inject({ url: '/api/me', cookies })).json().data;
      expect(me.access).toBe('owner');
      for(let i=0;i<121;i++) await app.inject('/health/live');
      expect((await app.inject('/auth/demo')).statusCode).toBe(302);
      const inactive = await app.inject({url:'/api/modules/example/tasks',method:'POST',cookies,headers:{origin:'http://localhost:3000','x-csrf-token':me.csrf},payload:{key:randomUUID()}});
      expect(inactive.statusCode).toBe(409);
      const privateJob=await store().enqueueJob('example','remember',{privateInput:'fixture-only'},randomUUID());
      const publicJob=(await app.inject({url:`/api/jobs/${privateJob}`,cookies})).json().data;
      expect(publicJob).not.toHaveProperty('payload');expect(publicJob).not.toHaveProperty('claim_token');

      let limited=0;for(let i=0;i<21;i++) limited=(await app.inject('/auth/discord')).statusCode;
      expect(limited).toBe(429);

      expect((await app.inject({ url: '/api/status', cookies })).json().data.storageProvider).toBe(provider);
      expect((await app.inject({ url: '/api/modules/logging/test', method: 'POST', cookies, headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'forged' }, payload: { key: randomUUID() } })).statusCode).toBe(403);
      member = false;
      expect((await app.inject({ url: '/api/modules/logging/test', method: 'POST', cookies, headers: { origin: 'http://localhost:3000', 'x-csrf-token': me.csrf }, payload: { key: randomUUID() } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
  it('isolates module records and fences concurrent edits with bounded pagination', async () => {
    await store().initialize('Test community', [exampleDefinition]);
    const first = store().resources('logging').data, second = store().resources('example').data;
    await first.put('same', { private: 'logging' }, 0);
    expect(await second.get('same')).toBeNull();
    await second.put('same', { private: 'example' }, 0);
    const writes = await Promise.allSettled([second.put('same', { n: 1 }, 1), second.put('same', { n: 2 }, 1)]);
    expect(writes.filter(w => w.status === 'fulfilled')).toHaveLength(1);
    expect(writes.find(w => w.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    expect((await first.get('same'))?.value).toEqual({ private: 'logging' });
    await second.put('event%a', {}, 0); await second.put('event%b', {}, 0); await second.put('event-other', {}, 0);
    const page = await second.list({ prefix: 'event%', limit: 1 });
    expect(page.records.map(r => r.key)).toEqual(['event%a']);
    expect((await second.list({ prefix: 'event%', limit: 1, cursor: page.nextCursor! })).records.map(r => r.key)).toEqual(['event%b']);
    await expect(second.put('large', { value: 'x'.repeat(33000) }, 0)).rejects.toThrow();
    await expect(second.delete('same', 1)).rejects.toMatchObject({ statusCode: 409 });
    expect(await second.delete('same', 2)).toBe(true);
    if (provider === 'postgres') {
      const other = driver.scope('200000000000000001'); await other.initialize('Other', [exampleDefinition]);
      expect(await other.resources('example').data.get('event%a')).toBeNull();
    }
  });
  it('expires module records and preserves live data across database restart', async () => {
    const data=store().resources('logging').data;
    await data.put('expire', { n:1 }, 0, 1000); await data.put('persist', { n:2 }, 0);
    await mutateForTest("UPDATE module_record SET expires_at=now()-interval '1 second' WHERE key='expire'", "UPDATE omo_module_record SET expires_at=0 WHERE key='expire'");
    expect(await data.get('expire')).toBeNull();
    await expect(data.put('expire', {}, 1)).rejects.toMatchObject({statusCode:409});
    await store().cleanup();
    await release!(); release=undefined;
    if (provider==='pocketbase') await pb!.restart(); else {await driver.close(); driver=new Database(pg!.url);}
    release=await driver.singleton(guild,()=>{});
    expect((await store().resources('logging').data.get('persist'))?.value).toEqual({n:2});
  });
  it('upgrades versioned settings once while preserving applied configuration', async () => {
    await store().initialize('Test', [exampleDefinition]);
    const upgraded={...exampleDefinition,manifest:{...exampleDefinition.manifest,settingsVersion:2},settingsMigrations:{1:(old:unknown)=>({greeting:z.object({greeting:z.string()}).parse(old).greeting+' Upgraded.'})}};
    await Promise.all([store().initialize('Test',[upgraded]),store().initialize('Test',[upgraded])]);
    const state=await store().getModule('example');
    expect(state.settingsVersion).toBe(2); expect(state.desiredRevision).toBe(2);
    expect(state.appliedSettingsVersion).toBe(1); expect(state.appliedSettings).toEqual(exampleDefinition.defaultSettings);
    await expect(store().initialize('Test',[exampleDefinition])).rejects.toThrow('newer');
    await expect(store().initialize('Test',[{...upgraded,manifest:{...upgraded.manifest,settingsVersion:3},settingsMigrations:{}}])).rejects.toThrow('missing settings migration');
    expect((await store().getModule('example')).desiredRevision).toBe(2);
  });
  it('dispatches generic jobs only to active modules and persists their own result', async () => {
    await store().initialize('Test', [exampleDefinition]);
    const host=new ModuleHost(guild,[exampleModule()],store(),{info(){},error(){}});
    const jobs=store().resources('example').jobs;
    const id=await jobs.enqueue('remember',{},'one');
    await host.sync(); await runModuleJobs(store(),host);
    expect((await store().call('jobGet',{id})).state).toBe('pending');
    const loggingJob=await store().enqueueJob('logging','test',{},'other-module');
    await store().updateModule('example',1,owner,{enabled:true}); await host.sync();
    await runModuleJobs(store(),host);
    expect((await store().call('jobGet',{id})).state).toBe('completed');
    expect((await store().call('jobGet',{id})).module_id).toBe('example');
    expect((await store().resources('example').data.get<{jobId:string}>('last-task'))?.value.jobId).toBe(id);
    expect((await store().call('jobGet',{id:loggingJob})).state).toBe('pending');
    expect(await jobs.enqueue('remember',{},'one')).toBe(id);
    const delayed=await jobs.enqueue('remember',{},'later',{delayMs:60000,ttlMs:1000});
    await runModuleJobs(store(),host); expect((await store().call('jobGet',{id:delayed})).state).toBe('pending');
    const invalid=await jobs.enqueue('remember',{secret:'never return this'},'invalid');
    await runModuleJobs(store(),host); const failed=await store().call('jobGet',{id:invalid});
    expect(failed.state).toBe('failed'); expect(failed.error).not.toContain('secret');
    await host.stop();
  });
  it('reclaims a generic job and ignores stale or expired completion', async () => {
    await store().initialize('Test',[exampleDefinition]);
    const id=await store().resources('example').jobs.enqueue('remember',{n:4},'claim');
    const first=(await store().call('jobClaim',{moduleIds:['example']}))!;
    expect(first.payload).toEqual({n:4});
    await mutateForTest("UPDATE core_job SET lease_until=now()-interval '1 second'",'UPDATE omo_job SET lease_until=0');
    const second=(await store().call('jobClaim',{moduleIds:['example']}))!;
    expect(second.attempts).toBe(2); expect(second.claim_token).not.toBe(first.claim_token);
    await store().call('jobFinish',{id,claimToken:first.claim_token!,error:null,message:'stale'});
    expect((await store().call('jobGet',{id})).result).toBeNull();
    await mutateForTest("UPDATE core_job SET expires_at=now()-interval '1 second'",'UPDATE omo_job SET expires_at=0');
    await store().call('jobFinish',{id,claimToken:second.claim_token!,error:null,message:'expired'});
    expect((await store().call('jobGet',{id})).result).toBeNull();
  });
  if (provider === 'pocketbase') {
    it('fences an expired owner before another worker takes over', async () => {
      await mutateForTest('', 'UPDATE omo_lease SET expires_at=0');
      const second = new PocketBaseAdapter(pb!.url, pb!.key);
      const releaseSecond = await second.singleton(guild, () => {});
      try {
        await expect(store().call('workerVerify', {})).rejects.toMatchObject({ statusCode: 409 });
        await release!(); release = undefined;
        await expect(second.scope(guild).call('workerVerify', {})).resolves.toBeNull();
      } finally { await releaseSecond(); await second.close(); }
    });
    it('rejects wrong storage keys, other guilds, unknown operations and ownerless worker writes', async () => {
      await expect(new PocketBaseAdapter(pb!.url, '0'.repeat(64)).scope(guild).ready()).rejects.toThrow('storage access failed');
      await expect(driver.scope('200000000000000001').ready()).rejects.toMatchObject({ statusCode: 403 });
      const response = await fetch(`${pb!.url}/api/omo/v1/query`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-OMO-Storage-Key': pb!.key }, body: JSON.stringify({ guildId: guild, input: { sql: 'SELECT * FROM omo_session' } }) });
      expect(response.status).toBe(404);
      const other = new PocketBaseAdapter(pb!.url, pb!.key);
      await expect(other.scope(guild).heartbeat('online', {})).rejects.toMatchObject({ statusCode: 409 });
    });
    it('rolls back the event if queue insertion fails', async () => {
      await activate();
      await mutateForTest('', `CREATE TRIGGER reject_delivery BEFORE INSERT ON omo_delivery BEGIN SELECT RAISE(ABORT, 'test rollback'); END;`);
      await expect(repository().capture(event(), settings, 2)).rejects.toMatchObject({ statusCode: 503 });
      expect((await repository().list({ limit: 50 })).events).toHaveLength(0);
      expect((await store().call('status', {})).queue).toHaveLength(0);
    });
  }
});
