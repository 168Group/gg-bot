import { installedDefinitions } from '../registry/definitions.js';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { localPocketBase } from './local-pocketbase.js';
import { readConfig } from '../packages/core/src/config.js';
import { createServer } from '../apps/web/src/server.js';
import { ModuleHost } from '../packages/core/src/host.js';
import { botRegistry } from '../registry/bot.js';
import { LoggingRepository } from '../modules/logging/bot/repository.js';
import { defaultLoggingSettings } from '../modules/logging/shared/settings.js';
import { DeliveryWorker } from '../modules/logging/bot/delivery.js';
import { runModuleJobs } from '../packages/core/src/jobs.js';

if (process.env.NODE_ENV === 'production') throw new Error('Demo mode is forbidden in production.');
if (!existsSync('dist/dashboard-demo/index.html')) throw new Error('Run pnpm build:demo before starting the local demo.');
const port = Number(process.env.DEMO_PORT ?? 3000);
const pb = await localPocketBase({ directory: process.env.DEMO_DB_DIR ?? '.local/demo-pocketbase', port: Number(process.env.DEMO_DB_PORT ?? 8091) });
const db = pb.driver;
const config = readConfig({ NODE_ENV: 'development', STORAGE_PROVIDER: 'pocketbase', POCKETBASE_URL: pb.url, POCKETBASE_SERVICE_KEY: pb.key, DISCORD_GUILD_ID: pb.guildId, OWNER_USER_IDS: '100000000000000002', DASHBOARD_ORIGIN: `http://localhost:${port}`, COMMUNITY_NAME: 'My Community', BOT_NAME: 'OMO Bot' });
const store = db.scope(config.DISCORD_GUILD_ID);
let stopped = false, activeTick: Promise<void> = Promise.resolve();
const release = await db.singleton(store.guildId, () => { stopped = true; console.error('Demo worker ownership lost; no further fixture work will run.'); process.exitCode = 1; });
const { app } = await createServer({ config, db, demo: true, clientId: 'fixture', encryptionKey: randomBytes(32).toString('hex'), identity: {
  async exchange() { throw new Error('Use /auth/demo in fixture mode.'); }, async identity() { throw new Error('Use /auth/demo in fixture mode.'); },
  async membership(tokens) { if (tokens.access_token !== 'fixture') throw new Error('Invalid fixture.'); return { roles: [], tokens }; }
} });
const repository = new LoggingRepository(store);
await store.replaceCatalog([
  { id: '100000000000000010', name: 'staff-logs', type: 0, parentId: '100000000000000020', canSend: true },
  { id: '100000000000000011', name: 'general', type: 0, parentId: null, canSend: true },
  { id: '100000000000000012', name: 'trading-floor', type: 0, parentId: null, canSend: true },
  { id: '100000000000000020', name: 'STAFF', type: 4, parentId: null, canSend: false }
]);
const settings = { ...defaultLoggingSettings, destinationId: '100000000000000010' };
const loggingInstalled = installedDefinitions(false).some(m=>m.manifest.id==='logging');
const state = loggingInstalled ? await store.getModule('logging') : null;
if (state?.desiredRevision === 1) await store.updateModule('logging', 1, config.OWNER_USER_IDS[0]!, { enabled: true, settings });
const validate = async (id: string) => { if (!(await store.catalog()).some(c => c.id === id && c.type === 0 && c.canSend)) throw new Error('Unknown fixture destination.'); };
const host = new ModuleHost(store.guildId, botRegistry(repository, validate, false), store, { info: console.info, error: console.error });
await host.sync();
for (let index = 0; loggingInstalled && index < 5; index++) await repository.capture({
  guildId: store.guildId, sourceKey: `fixture:initial:${index}`, type: ['channel.created', 'channel.updated', 'channel.created', 'channel.deleted', 'channel.updated'][index]!,
  subjectId: `10000000000000003${index}`, channelId: `10000000000000003${index}`, parentId: null,
  label: ['collector-showcase', 'trading-floor', 'community-events', 'weekend-popup', 'announcements'][index]!,
  observedAt: new Date(Date.now() - (index + 1) * 185000).toISOString(), before: index % 2 ? { name: 'previous-name' } : null,
  after: index === 3 ? null : { name: ['collector-showcase', 'trading-floor', 'community-events', 'weekend-popup', 'announcements'][index]!, type: 'GuildText' }
}, settings, 2);
const worker = new DeliveryWorker(repository, { validate, async find() { return null; }, async send() { return `100${Date.now()}`; } });
await store.heartbeat('online', { gateway: false, simulated: true });
let timer: ReturnType<typeof setTimeout> | undefined;
const tick = async () => {
  if (stopped) return;
  try { await host.sync(); await runModuleJobs(store, host); if (host.activeModuleIds().includes('logging')) for (let i = 0; i < 5; i++) await worker.tick(); await store.cleanup(); await repository.cleanup(); await store.heartbeat('online', { gateway: false, simulated: true }); }
  catch { console.error('Demo worker tick failed.'); }
  finally { if (!stopped) timer = setTimeout(() => { activeTick = tick(); }, 1000); }
};
await app.listen({ host: '127.0.0.1', port }); activeTick = tick();
console.info(`LOCAL FIXTURE DEMO: http://localhost:${port}/auth/demo: actual PocketBase storage; no Discord connection or real messages.`);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { if (closing) return; closing = true; stopped = true; if (timer) clearTimeout(timer); void (async () => { await app.close(); await activeTick; await host.stop(); try { await release(); await db.close(); } finally { await pb.stop(); } })(); });
