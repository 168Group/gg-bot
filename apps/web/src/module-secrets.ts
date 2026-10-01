import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ModuleDefinition } from '../../../packages/module-sdk/src/server.js';
import type { GuildStore } from '../../../packages/db/src/index.js';
import { ModuleSecrets, secretValue } from '../../../packages/core/src/secret-vault.js';
import { HttpError } from '../../../packages/core/src/access.js';
import type { Auth } from './auth.js';
const revision = z.number().int().min(0).max(2147483646);
const revisionInput = z.object({ revision }).strict();
export function registerModuleSecrets(app: FastifyInstance, auth: Auth, store: GuildStore, modules: ModuleDefinition[]) {
  const resolve = async (request: FastifyRequest, mutation: boolean) => {
    const user = await auth.authorize(request, mutation);
    if (user.access !== 'owner') throw new HttpError(403, 'FORBIDDEN', 'Only a server owner can manage module secrets.');
    const { moduleId, name } = z.object({ moduleId: z.string(), name: z.string().optional() }).parse(request.params);
    const module = modules.find(m => m.manifest.id === moduleId);
    if (!module || name !== undefined && !module.manifest.requiredSecrets?.includes(name)) throw new HttpError(404, 'NOT_FOUND', 'Declared module secret not found.');
    return { module, name: name!, secrets: new ModuleSecrets(store, module) };
  };
  app.get('/api/module-secrets/:moduleId', async request => {
    const { secrets, module } = await resolve(request, false);
    z.object({}).strict().parse(request.query);
    return { data: await Promise.all((module.manifest.requiredSecrets ?? []).map(name => secrets.metadata(name))) };
  });
  app.put('/api/module-secrets/:moduleId/:name', async request => {
    const { secrets, name } = await resolve(request, true);
    const input = z.object({ revision, value: secretValue }).strict().parse(request.body);
    return { data: await secrets.replace(name, input.revision, input.value) };
  });
  app.delete('/api/module-secrets/:moduleId/:name', async request => {
    const { secrets, name } = await resolve(request, true), input = revisionInput.parse(request.body);
    return { data: await secrets.disable(name, input.revision) };
  });
  app.post('/api/module-secrets/:moduleId/:name/environment', async request => {
    const { secrets, name } = await resolve(request, true), input = revisionInput.parse(request.body);
    return { data: await secrets.environment(name, input.revision) };
  });
  app.post('/api/module-secrets/:moduleId/:name/reveal', async (request, reply) => {
    const { secrets, name } = await resolve(request, true), input = revisionInput.parse(request.body);
    reply.header('Cache-Control', 'no-store');
    return { data: { value: await secrets.reveal(name, input.revision) } };
  });
}
