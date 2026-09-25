import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { StorageDriver } from '../../../packages/db/src/contracts.js';
import type { Config } from '../../../packages/core/src/config.js';
import { HttpError } from '../../../packages/core/src/access.js';
import { TokenVault } from '../../../packages/core/src/crypto.js';
import { validateRegistry } from '../../../packages/core/src/registry.js';
import { apiRegistry } from '../../../registry/api.js';
import { ProtectedModuleApi } from './protected-api.js';
import { Auth, type IdentityProvider } from './auth.js';

export interface ServerOptions { config: Config; db: StorageDriver; encryptionKey: string; clientId: string; identity: IdentityProvider; demo?: boolean }
export async function createServer(options: ServerOptions) {
  const { config, db } = options;
  // Request URLs can contain OAuth codes. Never enable automatic request logging.
  const app = Fastify({ logger: false, bodyLimit: 65536, requestTimeout: 15000, trustProxy: false });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null
  } } });
  const requestClass = (url: string, method: string) => url.startsWith('/auth/') ? 'auth' : method !== 'GET' ? 'write' : url.startsWith('/api/') ? 'read' : 'page';
  const budgets = { auth: 20, write: 60, read: 360, page: 120 };
  await app.register(rateLimit, { timeWindow: '1 minute',
    keyGenerator: request => `${request.ip}:${requestClass(request.url, request.method)}`,
    max: request => budgets[requestClass(request.url, request.method)]
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.url.startsWith('/auth/')) reply.header('Referrer-Policy', 'no-referrer');
  });
  app.setErrorHandler((error, request, reply) => {
    const validation = error instanceof z.ZodError;
    const rateLimited = error instanceof Error && 'statusCode' in error && error.statusCode === 429;
    const status = error instanceof HttpError ? error.statusCode : validation ? 400 : rateLimited ? 429 : 500;
    const code = error instanceof HttpError ? error.code : validation ? 'INVALID_INPUT' : status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR';
    const message = error instanceof HttpError ? error.message : validation ? 'Check the supplied fields and try again.' : status === 429 ? 'Too many requests. Try again shortly.' : 'The request could not be completed. Check service health.';
    return reply.code(status).send({ error: { code, message, requestId: request.id } });
  });
  const modules = validateRegistry(apiRegistry(config.NODE_ENV === 'production'));
  const store = db.scope(config.DISCORD_GUILD_ID);
  await store.initialize(config.COMMUNITY_NAME, modules);
  const auth = new Auth(db, config, new TokenVault(options.encryptionKey), options.identity, options.demo);
  auth.register(app, options.clientId);
  if (options.demo) app.get('/auth/demo', async (_request, reply) => {
    await auth.createSession(reply, { id: config.OWNER_USER_IDS[0]!, username: 'Demo operator' }, { access_token: 'fixture', refresh_token: 'fixture', expires_at: Date.now() + 3600000 });
    return reply.redirect('/');
  });
  app.get('/health/live', async () => ({ ok: true }));
  app.get('/health/ready', async (_request, reply) => {
    try { await store.ready(); return { ok: true }; } catch { return reply.code(503).send({ ok: false }); }
  });
  app.get('/api/me', async request => ({ data: await auth.authorize(request) }));
  app.get('/api/modules', async request => {
    await auth.authorize(request);
    return { data: await Promise.all(modules.map(async module => ({ manifest: module.manifest, ...await store.getModule(module.manifest.id) }))) };
  });
  app.patch('/api/modules/:moduleId/state', async request => {
    const user = await auth.authorize(request, true);
    const { moduleId } = z.object({ moduleId: z.string() }).parse(request.params);
    if (!modules.some(m => m.manifest.id === moduleId)) throw new HttpError(404, 'NOT_FOUND', 'Module not found.');
    const input = z.object({ revision: z.number().int().positive(), enabled: z.boolean() }).strict().parse(request.body);
    const module = modules.find(m => m.manifest.id === moduleId)!;
    if (input.enabled) {
      for (const dependency of module.manifest.dependencies) {
        const state = await store.getModule(dependency);
        if (!state.enabled || !state.appliedEnabled || state.applyError) throw new HttpError(409, 'MODULE_DEPENDENCY', `Enable and apply ${dependency} first.`);
      }
    } else {
      for (const dependent of modules.filter(m => m.manifest.dependencies.includes(moduleId))) {
        const state = await store.getModule(dependent.manifest.id);
        if (state.enabled || state.appliedEnabled) throw new HttpError(409, 'MODULE_DEPENDENCY', `Disable ${dependent.manifest.id} and wait for it to stop first.`);
      }
    }
    return { data: await store.updateModule(moduleId, input.revision, user.userId, { enabled: input.enabled }) };
  });
  app.get('/api/status', async request => {
    await auth.authorize(request);
    const status = await store.call('status', {});
    const row = status.health;
    return { data: { ...status, storageProvider: db.kind, online: Boolean(row && Date.now() - new Date(row.heartbeat).getTime() < 60000 && row.status !== 'offline'),
      capabilities: { channels: true, members: false, roles: false, messages: false, voice: false, moderation: false } } };
  });
  app.get('/api/catalog/channels', async request => { await auth.authorize(request); return { data: await store.catalog() }; });
  app.get('/api/catalog/roles', async request => { await auth.authorize(request); return { data: await store.call('rolesGet', {}) }; });
  app.get('/api/jobs/:jobId', async request => {
    await auth.authorize(request);
    const { jobId } = z.object({ jobId: z.uuid() }).parse(request.params);
    const job = await store.call('jobGet', { id: jobId });
    return { data: { id: job.id, moduleId: job.module_id, type: job.type, state: job.state, result: job.result, error: job.error, expires_at: job.expires_at } };
  });
  for (const module of modules) module.register(new ProtectedModuleApi(app, auth, store, module.manifest.id));
  const dashboard = resolve(options.demo ? 'dist/dashboard-demo' : 'dist/dashboard');
  if (existsSync(dashboard)) {
    await app.register(staticFiles, { root: dashboard, wildcard: false });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/') || request.url.startsWith('/auth/') || request.url.startsWith('/health/') || request.url.startsWith('/assets/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.', requestId: request.id } });
      return reply.sendFile('index.html');
    });
  }
  return { app, auth };
}
