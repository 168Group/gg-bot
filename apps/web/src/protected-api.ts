import { HttpError } from '../../../packages/core/src/access.js';
import type { ModuleResources } from '../../../packages/module-sdk/src/services.js';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { z, type ZodType } from 'zod';
import type { UserSession } from '../../../packages/module-sdk/src/browser.js';
import type { GuildStore } from '../../../packages/db/src/index.js';
import type { Auth } from './auth.js';
export class ProtectedModuleApi {
  constructor(private app: FastifyInstance, private auth: Auth, private store: GuildStore, private moduleId: string) {}
  route<T>(method: HTTPMethods, path: string, schema: ZodType<T>, handler: (input: T, context: ModuleResources & { user: UserSession; store: GuildStore; params: Record<string, string> }) => Promise<unknown>, accepted = false, activeOnly = false) {
    if (!path.startsWith('/') || path.includes('..')) throw new Error('Invalid module route.');
    this.app.route({ method, url: `/api/modules/${this.moduleId}${path}`, handler: async (request, reply) => {
      const user = await this.auth.authorize(request, method !== 'GET');
      if (activeOnly) {
        const state = await this.store.getModule(this.moduleId);
        if (!state.enabled || !state.appliedEnabled || state.desiredRevision !== state.appliedRevision || state.applyError) throw new HttpError(409, 'MODULE_UNAVAILABLE', 'Enable this module and wait for its settings to apply before running this action.');
      }
      const input = schema.parse(method === 'GET' ? request.query : request.body);
      const params = z.record(z.string(), z.string()).parse(request.params);
      const data = await handler(input, { ...this.store.resources(this.moduleId), user, store: this.store, params });
      return reply.code(accepted ? 202 : 200).send({ data });
    } });
  }
}
