import { it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { InstallationStore } from '../../apps/setup/src/state.js';
import { createSetupServer } from '../../apps/setup/src/server.js';
import { Provisioner, bindPocketBase } from '../../apps/setup/src/provision.js';
import { localPocketBase } from '../../scripts/local-pocketbase.js';
import { localPostgres } from '../../scripts/local-postgres.js';
import { PocketBaseAdapter } from '../../packages/db/src/pocketbase.js';
const guildId = '100000000000000001';
it('prepares local storage without a database login, rejects unauthorized changes and preserves it across restart', async () => {
  const store = await InstallationStore.open(await mkdtemp(`${tmpdir()}/omo-install-api-`));
  const { app } = await createSetupServer(store, 'http://localhost:3000');
  const headers = { host: 'localhost:3000', origin: 'http://localhost:3000', 'x-setup-key': store.accessKey };
  try {
    expect((await app.inject({ url: '/', headers })).headers.location).toBe('/setup');
    expect((await app.inject({ url: '/setup-api/state', headers: { host: headers.host } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/setup-api/prepare', headers: { ...headers, origin: 'https://evil.example' }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/setup-api/prepare', headers, payload: { name: 'Test', guildId, storage: { kind: 'local' } } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/setup-api/prepare', headers, payload: { name: 'Test', guildId, storage: { kind: 'local' } } })).statusCode).toBe(409);
    let result;
    for (let n = 0; n < 100; n++) { result = (await app.inject({ url: '/setup-api/state', headers })).json(); if (result.job?.state !== 'running') break; await new Promise(done => setTimeout(done, 100)); }
    expect(result.job.state, result.job.error).toBe('succeeded'); expect(result.profiles[0].ready).toBe(true);
    expect(JSON.stringify(result)).not.toContain('POCKETBASE_SERVICE_KEY');
    const p = (await store.read()).profiles[0]!;
    const db = new PocketBaseAdapter(p.env.POCKETBASE_URL!, p.env.POCKETBASE_SERVICE_KEY!);
    await db.scope(guildId).ready(); await db.close();
  } finally { await app.close(); }
  const provisioner = new Provisioner(await InstallationStore.open(store.directory));
  try { const profile = (await store.read()).profiles[0]!; const pb = await provisioner.localFor(profile); await pb.driver.scope(guildId).ready(); }
  finally { await provisioner.close(); }
});
it('applies PostgreSQL migrations through the setup profile and supports rerunning them', async () => {
  const pg = await localPostgres(), u = new URL(pg.url);
  const store = await InstallationStore.open(await mkdtemp(`${tmpdir()}/omo-install-pg-`)), provisioner = new Provisioner(store);
  try {
    const input = { name: 'Test', guildId, storage: { kind: 'postgres' as const, host: u.hostname, port: Number(u.port), database: 'postgres', username: u.username, password: u.password, tls: false } };
    const first = await provisioner.prepare(input, () => {}); expect(first.ready).toBe(true);
    expect((await provisioner.prepare(input, () => {})).ready).toBe(true);
  } finally { await provisioner.close(); await pg.stop(); }
});
it('requires superadmin access to bind PocketBase and refuses rebinding another guild or key', async () => {
  const pb = await localPocketBase({ envBinding: false });
  const email = 'installer@example.com', password = 'local-fixture-password-123';
  try {
    await promisify(execFile)(resolve('.local/pocketbase-bin/pocketbase'), ['superuser', 'create', email, password, `--dir=${pb.directory}/pb_data`], { timeout: 10000 });
    const anonymous = await fetch(`${pb.url}/api/omo-install/bind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guildId, key: pb.key }) });
    expect(anonymous.status).toBe(401);
    await expect(bindPocketBase(pb.url, email, 'wrong-password', guildId, pb.key)).rejects.toThrow('login failed');
    expect(await bindPocketBase(pb.url, email, password, guildId, pb.key)).toBe(true);
    await pb.driver.scope(guildId).ready();
    expect(await bindPocketBase(pb.url, email, password, guildId, pb.key)).toBe(true);
    await expect(bindPocketBase(pb.url, email, password, '200000000000000001', pb.key)).rejects.toThrow('already bound');
    await expect(bindPocketBase(pb.url, email, password, guildId, '0'.repeat(64))).rejects.toThrow('already bound');
    await pb.restart(); await pb.driver.scope(guildId).ready();
  } finally { await pb.stop(); }
});

it('supervises real service processes, separates credentials and stops old workers before replacement', async () => {
  const { writeFile, readFile } = await import('node:fs/promises');
  const { ManagedRuntime } = await import('../../apps/setup/src/runtime.js');
  const dir = await mkdtemp(`${tmpdir()}/omo-runtime-test-`);
  const fixture = `${dir}/service.mjs`;
  await writeFile(fixture, `import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';const role=process.env.DISCORD_BOT_TOKEN?'bot':'web';writeFileSync(process.env.FIXTURE_PID_DIR+'/'+role,String(process.pid));const app=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,pid:process.pid,bot:!!process.env.DISCORD_BOT_TOKEN,oauth:!!process.env.DISCORD_CLIENT_SECRET,session:!!process.env.SESSION_ENCRYPTION_KEY}));});app.listen(Number(role==='bot'?process.env.BOT_HEALTH_PORT:process.env.WEB_PORT),'127.0.0.1');process.on('SIGTERM',()=>app.close());`);
  const store = await InstallationStore.open(`${dir}/install`), provisioner = new Provisioner(store);
  const runtime = new ManagedRuntime(provisioner, 'http://localhost:3000', { bot: fixture, web: fixture }, async () => {});
  const profile: import('../../apps/setup/src/model.js').Profile = { id: 'fixture', name: 'Test', guildId, kind: 'postgres', ready: true, createdAt: 'now', env: { DATABASE_URL: 'postgresql://fixture', FIXTURE_PID_DIR: dir }, discord: { applicationId: guildId, ownerId: guildId, botName: 'Test', botToken: 'fixture-token', clientSecret: 'fixture-secret' } };
  try {
    await runtime.start(profile); expect(runtime.status).toBe('running');
    expect(await (await fetch(runtime.webUrl!)).json()).toMatchObject({ bot: false, oauth: true, session: true });
    const old = await Promise.all(['bot', 'web'].map(async name => Number(await readFile(`${dir}/${name}`, 'utf8'))));
    await runtime.start(profile);
    for (const pid of old) expect(() => process.kill(pid, 0)).toThrow();
    const current = await Promise.all(['bot', 'web'].map(async name => Number(await readFile(`${dir}/${name}`, 'utf8'))));
    await runtime.stop(); for (const pid of current) expect(() => process.kill(pid, 0)).toThrow();
    await writeFile(`${dir}/failure.mjs`, 'process.exit(1)');
    const failing = new ManagedRuntime(provisioner, 'http://localhost:3000', { bot: `${dir}/failure.mjs`, web: fixture }, async () => {});
    await expect(failing.start(profile)).rejects.toThrow('service stopped');
    expect(failing.status).toBe('failed'); expect(failing.webUrl).toBeNull(); await failing.stop();
  } finally { await runtime.stop(); await provisioner.close(); }
});

it('retains the selected profile when preparation of another database fails', async () => {
  const { freePort } = await import('../../apps/setup/src/runtime.js');
  const store = await InstallationStore.open(await mkdtemp(`${tmpdir()}/omo-failed-prepare-`)), provisioner = new Provisioner(store);
  try {
    const profile = await provisioner.prepare({ name: 'Working', guildId, storage: { kind: 'local' } }, () => {});
    const state = await store.read(); state.activeId = profile.id; await store.save(state);
    await expect(provisioner.prepare({ name: 'Unavailable', guildId, storage: { kind: 'postgres', host: '127.0.0.1', port: await freePort(), database: 'missing', username: 'fixture', password: 'fixture-password', tls: false } }, () => {})).rejects.toThrow('PostgreSQL setup failed');
    const saved = await store.read(); expect(saved.activeId).toBe(profile.id); expect(saved.profiles.find(p => p.id === profile.id)?.ready).toBe(true);
    expect(saved.profiles.find(p => p.id !== profile.id)?.ready).toBe(false);
  } finally { await provisioner.close(); }
});
