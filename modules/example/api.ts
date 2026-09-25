import { z } from 'zod';
import { exampleDefinition } from './definition.js';
import type { ProtectedModuleApi } from '../../apps/web/src/protected-api.js';
export function registerApi(api: ProtectedModuleApi) {
  api.route('GET', '/settings', z.object({}).strict(), async (_, { store }) => store.getModule('example'));
  api.route('PUT', '/settings', z.object({ revision: z.number().int().positive(), settings: exampleDefinition.settingsSchema }).strict(), async (input, { store, user }) => store.updateModule('example', input.revision, user.userId, { settings: input.settings }));
  api.route('GET', '/last-task', z.object({}).strict(), async (_, { data }) => data.get('last-task'));
  api.route('POST', '/tasks', z.object({ key: z.uuid() }).strict(), async (input, { jobs }) => ({ id: await jobs.enqueue('remember', {}, input.key) }), true, true);
}
