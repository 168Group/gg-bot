import { z } from 'zod';
import type { ProtectedModuleApi } from '../../apps/web/src/protected-api.js';
import { canMutate, HttpError } from '../../packages/core/src/access.js';
import { liveView, type LiveSnapshot } from './live-model.js';
import { definition, settingsSchema } from './definition.js';
const id = definition.manifest.id;
const page = z.object({ cursor: z.string().max(160).optional() }).strict();
export function registerApi(api: ProtectedModuleApi) {
  api.route('GET', '/settings', z.object({}).strict(), async (_, { store }) => store.getModule(id));
  api.route('PUT', '/settings', z.object({ revision: z.number().int().positive(), settings: settingsSchema }).strict(), async (input, { store, user }) => {
    const channels = await store.catalog();
    if (input.settings.staffChannelIds.some(channelId => !channels.some(channel => channel.id === channelId && channel.type === 0 && channel.canSend))) throw new HttpError(400, 'INVALID_CHANNEL', 'Choose an available text channel that the bot can access.');
    return store.updateModule(id, input.revision, user.userId, { settings: input.settings });
  });
  api.route('GET', '/snapshot', z.object({}).strict(), async (_, { store, data }) => {
    if (settingsSchema.parse((await store.getModule(id)).settings).mode !== 'fixtures') return null;
    return data.get('fixture-snapshot');
  });
  api.route('GET', '/api-snapshot', z.object({}).strict(), async (_, { store, data }) => {
    const state = await store.getModule(id);
    if (settingsSchema.parse(state.settings).mode !== 'api-readonly' || !state.enabled || !state.appliedEnabled || state.applyError || state.desiredRevision !== state.appliedRevision) return null;
    const snapshot = await data.get<LiveSnapshot>('api-snapshot');
    return snapshot ? liveView(snapshot.value, state.appliedRevision) : null;
  });
  api.route('POST', '/refresh-api', z.object({ key: z.uuid() }).strict(), async (input, { store, jobs }) => {
    const state = await store.getModule(id);
    if (settingsSchema.parse(state.settings).mode !== 'api-readonly') throw new HttpError(409, 'API_OFF', 'Choose API read-only mode first.');
    return { id: await jobs.enqueue('refresh-api', { revision: state.appliedRevision }, input.key, { ttlMs: 300000 }) };
  }, true, true);
  api.route('GET', '/previews', page, async (input, { data }) => data.list({ prefix: 'preview:', cursor: input.cursor, limit: 20 }));
  api.route('GET', '/drafts', page, async (input, { data, user }) => {
    if (!canMutate(user.access)) throw new HttpError(403, 'FORBIDDEN', 'Only administrators can review staff drafts.');
    return data.list({ prefix: 'draft:', cursor: input.cursor, limit: 20 });
  });
  api.route('POST', '/refresh-fixtures', z.object({ key: z.uuid() }).strict(), async (input, { store, jobs }) => {
    const state = await store.getModule(id);
    if (settingsSchema.parse(state.settings).mode !== 'fixtures') throw new HttpError(409, 'FIXTURES_OFF', 'Choose fixture mode before refreshing sample events.');
    return { id: await jobs.enqueue('refresh-fixtures', { revision: state.appliedRevision }, input.key, { ttlMs: 300000 }) };
  }, true, true);
}
