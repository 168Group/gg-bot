import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { localPocketBase } from '../../scripts/local-pocketbase.js';
import { localPostgres } from '../../scripts/local-postgres.js';
import { Database } from '../../packages/db/src/index.js';
import { migrate } from '../../packages/db/src/migrate.js';
import type { StorageDriver } from '../../packages/db/src/contracts.js';
import { ModuleSecrets } from '../../packages/core/src/secret-vault.js';
import { exampleDefinition } from '../../modules/example/definition.js';
import { ModuleHost } from '../../packages/core/src/host.js';
import { runModuleJobs } from '../../packages/core/src/jobs.js';
import { createServer } from '../../apps/web/src/server.js';
import { readConfig } from '../../packages/core/src/config.js';
import type { BotModule } from '../../packages/module-sdk/src/server.js';
const guild = '100000000000000001', owner = '100000000000000002', adminRole = '100000000000000003', viewerRole = '100000000000000004';
const value = 'synthetic-credential-one', replacement = 'synthetic-credential-two';
const encryption = 'a'.repeat(64), fallback = 'synthetic-environment-value';

describe.each(['postgres', 'pocketbase'] as const)('%s declared module secrets', provider => {
  let pg: Awaited<ReturnType<typeof localPostgres>> | undefined, pb: Awaited<ReturnType<typeof localPocketBase>> | undefined;
  let db: StorageDriver;
  const store = () => db.scope(guild);
  const secrets = (env: NodeJS.ProcessEnv = process.env) => new ModuleSecrets(store(), exampleDefinition, env);
  beforeAll(async () => { if (provider === 'postgres') pg = await localPostgres(); });
  afterAll(async () => { await pg?.stop(); });
  beforeEach(async () => {
    vi.stubEnv('MODULE_SECRET_ENCRYPTION_KEY', encryption); vi.stubEnv('OMO_MODULE_EXAMPLE_API_KEY', fallback);
    if (provider === 'postgres') { const driver = new Database(pg!.url); await migrate(driver); await driver.query('TRUNCATE guild_config,dashboard_session,oauth_state,worker_lease CASCADE'); db = driver; }
    else { pb = await localPocketBase(); db = pb.driver; }
    await store().initialize('Test', [exampleDefinition]);
  });
  afterEach(async () => { vi.unstubAllEnvs(); await db?.close(); await pb?.stop(); pb = undefined; });
  it('stores authenticated ciphertext only and binds it to guild, module and name', async () => {
    expect(await secrets().metadata('API_KEY')).toEqual({ name: 'API_KEY', source: 'environment', configured: null, revision: 0, canReveal: false });
    const saved = await secrets().replace('API_KEY', 0, value);
    expect(saved).toEqual({ name: 'API_KEY', source: 'stored', configured: true, revision: 1, canReveal: true });
    expect(await secrets().get('API_KEY')).toBe(value);
    const row = (await store().call('secretGet', { moduleId: 'example', name: 'API_KEY' }))!;
    expect(row.ciphertext).not.toContain(value); expect(JSON.stringify(row)).not.toContain(encryption);
    const raw = provider === 'postgres'
      ? JSON.stringify(await (db as Database).query('SELECT * FROM module_secret'))
      : (() => { const sqlite = new DatabaseSync(`${pb!.directory}/pb_data/data.db`); try { return JSON.stringify(sqlite.prepare('SELECT * FROM omo_module_secret').all()); } finally { sqlite.close(); } })();
    expect(raw).toContain(row.ciphertext); expect(raw).not.toContain(value); expect(raw).not.toContain(encryption);
    expect(JSON.stringify(await store().getModule('example'))).not.toContain(value);
    const alternate = { ...exampleDefinition, manifest: { ...exampleDefinition.manifest, id: 'alternate', requiredSecrets: ['API_KEY', 'OTHER'] } };
    await store().initialize('Test', [alternate]);
    await store().call('secretSet', { moduleId: 'alternate', name: 'API_KEY', expected: 0, mode: 'stored', ciphertext: row.ciphertext });
    await expect(new ModuleSecrets(store(), alternate).get('API_KEY')).rejects.toMatchObject({ code: 'MODULE_SECRET_UNAVAILABLE' });
    await store().call('secretSet', { moduleId: 'alternate', name: 'OTHER', expected: 0, mode: 'stored', ciphertext: row.ciphertext });
    await expect(new ModuleSecrets(store(), alternate).get('OTHER')).rejects.toMatchObject({ code: 'MODULE_SECRET_UNAVAILABLE' });
    if (provider === 'postgres') {
      const other = db.scope('200000000000000001'); await other.initialize('Other', [exampleDefinition]);
      await other.call('secretSet', { moduleId: 'example', name: 'API_KEY', expected: 0, mode: 'stored', ciphertext: row.ciphertext });
      await expect(new ModuleSecrets(other, exampleDefinition).get('API_KEY')).rejects.toMatchObject({ code: 'MODULE_SECRET_UNAVAILABLE' });
    } else await expect(db.scope('200000000000000001').call('secretGet', { moduleId: 'example', name: 'API_KEY' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(secrets().get('UNDECLARED')).rejects.toMatchObject({ statusCode: 404 });
    await expect(secrets().replace('UNDECLARED', 0, value)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('fences concurrent creation, replacement, deletion and stale reveal with monotonic tombstones', async () => {
    const created = await Promise.allSettled([secrets().replace('API_KEY', 0, value), secrets().replace('API_KEY', 0, replacement)]);
    expect(created.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(created.find(r => r.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    const changed = await Promise.allSettled([secrets().replace('API_KEY', 1, value), secrets().disable('API_KEY', 1)]);
    expect(changed.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(changed.find(r => r.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    await secrets().disable('API_KEY', 2);
    await expect(secrets().replace('API_KEY', 0, value)).rejects.toMatchObject({ statusCode: 409 });
    await expect(secrets().reveal('API_KEY', 1)).rejects.toMatchObject({ statusCode: 409 });
    await expect(secrets().get('API_KEY')).rejects.toMatchObject({ code: 'MODULE_SECRET_DISABLED' });
    await secrets().environment('API_KEY', 3); expect(await secrets().get('API_KEY')).toBe(fallback);
    await expect(secrets().reveal('API_KEY', 4)).rejects.toMatchObject({ code: 'MODULE_SECRET_NOT_STORED' });
  });
  it('fails closed on missing/wrong encryption keys and corrupted ciphertext without environment fallback', async () => {
    await expect(secrets({}).replace('API_KEY', 0, value)).rejects.toMatchObject({ code: 'MODULE_SECRET_UNAVAILABLE' });
    await secrets().replace('API_KEY', 0, value);
    const env = { OMO_MODULE_EXAMPLE_API_KEY: fallback };
    await expect(secrets(env).get('API_KEY')).rejects.toMatchObject({ code: 'MODULE_SECRET_UNAVAILABLE' });
    await expect(secrets({ ...env, MODULE_SECRET_ENCRYPTION_KEY: 'b'.repeat(64) }).get('API_KEY')).rejects.toMatchObject({ code: 'MODULE_SECRET_UNAVAILABLE' });
    expect((await secrets({}).metadata('API_KEY')).configured).toBe(true);
    await store().call('secretSet', { moduleId: 'example', name: 'API_KEY', expected: 1, mode: 'stored', ciphertext: 'X'.repeat(100) });
    await expect(secrets().reveal('API_KEY', 2)).rejects.toMatchObject({ code: 'MODULE_SECRET_UNAVAILABLE' });
    await expect(secrets().get('API_KEY')).rejects.toMatchObject({ code: 'MODULE_SECRET_UNAVAILABLE' });
    await secrets().environment('API_KEY', 2);
    await expect(secrets({}).get('API_KEY')).rejects.toMatchObject({ code: 'MODULE_SECRET_MISSING' });
  });
  it('reads rotations on the next job, blocks deleted credentials and requires explicit fallback restoration', async () => {
    const observed: string[] = [], logs: string[] = [];
    const module: BotModule = { ...exampleDefinition, async start(context) { context.onJob('remember', async () => { observed.push(await context.secrets.get('API_KEY')); return 'Credential checked.'; }); }, async applySettings() {}, async stop() {} };
    const host = new ModuleHost(guild, [module], store(), { info: message => logs.push(message), error: message => logs.push(message) });
    const release = await db.singleton(guild, () => {});
    try {
      await store().updateModule('example', 1, owner, { enabled: true }); await host.sync();
      const run = async (key: string) => { const id = await store().enqueueJob('example', 'remember', {}, key); await runModuleJobs(store(), host); return store().call('jobGet', { id }); };
      await run('environment'); await secrets().replace('API_KEY', 0, value); await run('first');
      await secrets().replace('API_KEY', 1, replacement); await run('rotated');
      await secrets().disable('API_KEY', 2); expect((await run('disabled')).state).toBe('failed');
      await secrets().environment('API_KEY', 3); const last = await run('restored');
      expect(observed).toEqual([fallback, value, replacement, fallback]);
      expect(JSON.stringify(last)).not.toContain(fallback); expect(JSON.stringify(logs)).not.toContain(value);
    } finally { await host.stop(); await release(); }
  });
  it('protects metadata and reveal with owner access, fresh membership, CSRF and revisions', async () => {
    let membership = true, checks = 0;
    const config = readConfig({ NODE_ENV: 'test', STORAGE_PROVIDER: provider, ...(provider === 'postgres' ? { DATABASE_URL: pg!.url } : { POCKETBASE_URL: pb!.url, POCKETBASE_SERVICE_KEY: pb!.key }), DISCORD_GUILD_ID: guild, OWNER_USER_IDS: owner, DASHBOARD_ADMIN_ROLE_IDS: adminRole, DASHBOARD_VIEWER_ROLE_IDS: viewerRole, DASHBOARD_ORIGIN: 'http://localhost:3000' });
    const { app, auth } = await createServer({ config, db, demo: true, clientId: 'fixture', encryptionKey: encryption, identity: { async exchange() { throw new Error('unused'); }, async identity() { throw new Error('unused'); }, async membership(tokens) { checks++; if (!membership) throw new Error('revoked'); return { tokens, roles: tokens.access_token === 'fixture' ? [] : [tokens.access_token] }; } } });
    for (const [role, id] of [['admin', adminRole], ['viewer', viewerRole]]) app.get(`/login-${role}`, async (_request, reply) => { await auth.createSession(reply, { id: id!, username: role! }, { access_token: id!, refresh_token: 'fixture', expires_at: Date.now() + 3600000 }); return {}; });
    const base = '/api/module-secrets/example', target = `${base}/API_KEY`;
    try {
      expect((await app.inject(base)).statusCode).toBe(401);
      const login = await app.inject('/auth/demo'), cookies = { omo_session: login.cookies[0]!.value };
      const me = (await app.inject({ url: '/api/me', cookies })).json().data;
      const headers = { origin: config.DASHBOARD_ORIGIN, 'x-csrf-token': me.csrf };
      for (const role of ['admin', 'viewer']) {
        const loginRole = await app.inject(`/login-${role}`), roleCookies = { omo_session: loginRole.cookies[0]!.value };
        const roleMe = (await app.inject({ url: '/api/me', cookies: roleCookies })).json().data;
        expect((await app.inject({ url: base, cookies: roleCookies })).statusCode).toBe(403);
        for (const [method, url, payload] of [['PUT', target, { revision: 0, value }], ['DELETE', target, { revision: 0 }], ['POST', `${target}/reveal`, { revision: 0 }], ['POST', `${target}/environment`, { revision: 0 }]] as const) {
          expect((await app.inject({ method, url, payload, cookies: roleCookies, headers: { origin: config.DASHBOARD_ORIGIN, 'x-csrf-token': roleMe.csrf } })).statusCode).toBe(403);
        }
      }
      expect((await app.inject({ method: 'PUT', url: target, cookies, payload: { revision: 0, value } })).statusCode).toBe(403);
      for (const url of ['/api/module-secrets/missing/API_KEY', `${base}/UNDECLARED`]) expect((await app.inject({ method: 'PUT', url, cookies, headers, payload: { revision: 0, value } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'PUT', url: target, cookies, headers, payload: { revision: 0, value, guildId: '200000000000000001' } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'PUT', url: target, cookies, headers, payload: { revision: 0, value: 'x'.repeat(4097) } })).statusCode).toBe(400);
      const saved = await app.inject({ method: 'PUT', url: target, cookies, headers, payload: { revision: 0, value } }); expect(saved.statusCode).toBe(200); expect(saved.body).not.toContain(value);
      const metadata = await app.inject({ url: base, cookies }); expect(metadata.body).not.toContain(value); expect(metadata.body).not.toContain('ciphertext'); expect(metadata.headers['cache-control']).toBe('no-store');
      const before = checks;
      const reveal = await app.inject({ method: 'POST', url: `${target}/reveal`, cookies, headers, payload: { revision: 1 } });
      expect(checks).toBe(before + 1); expect(reveal.json().data.value).toBe(value); expect(reveal.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ method: 'POST', url: `${target}/reveal`, cookies, headers: { ...headers, 'x-csrf-token': 'invalid' }, payload: { revision: 1 } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: target, cookies, headers, payload: { revision: 0, value: replacement } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'DELETE', url: target, cookies, headers, payload: { revision: 0 } })).statusCode).toBe(409);
      membership = false;
      const denied = await app.inject({ method: 'POST', url: `${target}/reveal`, cookies, headers, payload: { revision: 1 } }); expect(denied.statusCode).toBe(403); expect(denied.body).not.toContain(value);
      expect((await app.inject({ url: base, cookies })).statusCode).toBe(401);
    } finally { await app.close(); }
  });
});
