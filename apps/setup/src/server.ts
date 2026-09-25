import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { InstallationStore } from './state.js';
import { Provisioner } from './provision.js';
import { ManagedRuntime } from './runtime.js';
import { setupInput, sftpAddress, discordInput, publicProfile, SetupError, type SetupJob } from './model.js';
import { probeSftp } from './sftp.js';
export async function createSetupServer(store: InstallationStore, origin: string) {
  const app = Fastify({ logger: false, bodyLimit: 65536, requestTimeout: 15000 });
  const provisioner = new Provisioner(store), runtime = new ManagedRuntime(provisioner, origin);
  let job: SetupJob | null = null, pending: Promise<void> = Promise.resolve(), closing = false;
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], upgradeInsecureRequests: origin.startsWith('https:') ? [] : null } } });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); reply.header('Referrer-Policy', 'no-referrer');
    if (request.url !== '/health/live' && request.headers.host !== new URL(origin).host) return reply.code(403).send({ error: 'Open setup using its configured address.' });
    if (request.method === 'GET' && request.url === '/' && !runtime.webUrl) return reply.redirect('/setup');
    if (!request.url.startsWith('/setup-api/') || request.url === '/setup-api/info') return;
    const supplied = typeof request.headers['x-setup-key'] === 'string' ? request.headers['x-setup-key'] : '';
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(store.accessKey) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(store.accessKey))) return reply.code(401).send({ error: 'Enter the installation access key from the bot host.' });
    if (request.method !== 'GET' && request.headers.origin !== origin) return reply.code(403).send({ error: 'Setup changes must come from this console.' });
  });
  app.setErrorHandler((error, _request, reply) => {
    const validation = error instanceof z.ZodError;
    return reply.code(validation ? 400 : error instanceof SetupError ? 409 : ('statusCode' in (error as object) && (error as { statusCode: number }).statusCode === 429) ? 429 : 500).send({ error: validation ? 'Check the required fields and connection details.' : error instanceof SetupError ? error.message : 'Setup could not complete. Check the connection and try again.' });
  });
  function start(work: (progress: (message: string) => void) => Promise<string | void>) {
    if (closing || job?.state === 'running') throw new SetupError('Another setup action is still running.');
    job = { id: randomUUID(), state: 'running', steps: [] }; const current = job;
    pending = (async () => {
      try { const id = await work(message => current.steps.push(message)); if (id) current.profileId = id; current.state = 'succeeded'; }
      catch (error) { current.state = 'failed'; current.error = error instanceof SetupError ? error.message : 'Setup failed. Check credentials, connectivity and service permissions.'; }
    })();
    return { id: current.id };
  }
  app.get('/setup-api/info', async () => ({ available: true }));
  app.get('/setup-api/state', async () => { const state = await store.read(); return { profiles: state.profiles.map(publicProfile), activeId: state.activeId, runtime: runtime.status, job }; });
  app.post('/setup-api/probe', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async request => { const input = sftpAddress.parse(request.body); return { fingerprint: await probeSftp(input.host, input.port) }; });
  app.post('/setup-api/prepare', async request => { const input = setupInput.parse(request.body); return start(async progress => (await provisioner.prepare(input, progress)).id); });
  app.post('/setup-api/discord', async request => {
    const input = z.object({ profileId: z.uuid(), discord: discordInput }).strict().parse(request.body);
    return start(async progress => {
      const state = await store.read(), profile = state.profiles.find(p => p.id === input.profileId);
      if (!profile?.ready) throw new SetupError('Prepare this storage profile first.');
      profile.discord = input.discord; await store.save(state); progress('Discord credentials saved securely. Activate when ready.'); return profile.id;
    });
  });
  app.post('/setup-api/activate', async request => {
    const input = z.object({ profileId: z.uuid(), useTargetData: z.literal(true) }).strict().parse(request.body);
    return start(async progress => {
      const state = await store.read(), profile = state.profiles.find(p => p.id === input.profileId);
      if (!profile?.ready || !profile.discord) throw new SetupError('Prepare storage and save Discord credentials first.');
      progress('Stopping the previous managed services.'); state.activeId = null; await store.save(state); await runtime.stop();
      progress('Starting bot and dashboard. Existing data stays in its original database.');
      await runtime.start(profile); state.activeId = profile.id; await store.save(state); progress('Bot and dashboard are ready.'); return profile.id;
    });
  });
  app.post('/setup-api/stop', async () => start(async progress => { const state = await store.read(); state.activeId = null; await store.save(state); await runtime.stop(); progress('Managed bot and dashboard stopped. Storage data is retained.'); }));
  app.get('/health/live', async () => ({ ok: true }));
  await app.register(staticFiles, { root: resolve('dist/dashboard'), wildcard: false });
  app.get('/setup', async (_request, reply) => reply.sendFile('index.html'));
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/setup-api/')) return reply.code(404).send({ error: 'Setup route not found.' });
    if (!runtime.webUrl) {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/auth/')) return reply.redirect('/setup');
      return reply.code(503).send({ error: { message: 'Activate an installation from setup first.' } });
    }
    const headers: Record<string, string> = {};
    for (const name of ['cookie', 'content-type', 'origin', 'x-csrf-token', 'accept']) { const value = request.headers[name]; if (typeof value === 'string') headers[name] = value; }
    const response = await fetch(`${runtime.webUrl}${request.url}`, { method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000), body: ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(request.body) });
    for (const name of ['content-type', 'location', 'cache-control']) { const value = response.headers.get(name); if (value) reply.header(name, value); }
    const cookies = response.headers.getSetCookie(); if (cookies.length) reply.header('set-cookie', cookies);
    return reply.code(response.status).send(Buffer.from(await response.arrayBuffer()));
  });
  app.addHook('onClose', async () => { closing = true; await pending; await runtime.stop(); await provisioner.close(); });
  async function resume() {
    const state = await store.read(), profile = state.profiles.find(p => p.id === state.activeId);
    if (profile) start(async progress => { progress('Restoring the active installation.'); await runtime.start(profile); await store.save(state); progress('Services are ready.'); return profile.id; });
  }
  return { app, resume, runtime, provisioner };
}
