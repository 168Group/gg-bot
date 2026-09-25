import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ProtectedModuleApi } from '../../../apps/web/src/protected-api.js';
import { loggingSettingsSchema } from '../shared/settings.js';
import { eventFilter, LoggingRepository } from '../bot/repository.js';
import { renderEvent } from '../bot/render.js';
import { HttpError } from '../../../packages/core/src/access.js';
export function registerLoggingApi(api: ProtectedModuleApi) {
  api.route('GET', '/settings', z.object({}).strict(), async (_, { store }) => store.getModule('logging'));
  api.route('PUT', '/settings', z.object({ revision: z.number().int().positive(), settings: loggingSettingsSchema }).strict(), async (input, { store, user }) => {
    if (input.settings.destinationId) {
      const channel = (await store.catalog()).find(c => c.id === input.settings.destinationId && c.type === 0);
      if (!channel) throw new HttpError(400, 'INVALID_DESTINATION', 'Choose a text channel from this server.');
    }
    return store.updateModule('logging', input.revision, user.userId, { settings: input.settings });
  });
  api.route('GET', '/events', eventFilter, async (input, { store }) => new LoggingRepository(store).list(input));
  api.route('GET', '/events/:eventId', z.object({}).strict(), async (_, { store, params }) => new LoggingRepository(store).detail(z.uuid().parse(params.eventId)));
  api.route('POST', '/preview', z.object({ settings: loggingSettingsSchema }).strict(), async ({ settings }) => renderEvent({
    id: randomUUID(), type: 'channel.created', subjectId: '100000000000000001', subjectLabel: '#new-channel', channelId: null,
    parentId: null, observedAt: new Date().toISOString(), before: null, after: { name: 'new-channel', type: 'text' }, actorId: null,
    reason: null, attribution: 'unavailable', configRevision: 0, expiresAt: new Date().toISOString(), deliveryState: null, messageId: null, destinationId: null
  }, 'PREVIEW · no message sent', settings.accentColor));
  for (const type of ['test', 'diagnostics']) api.route('POST', `/${type}`, z.object({ key: z.uuid() }).strict(), async ({ key }, { store }) => ({ jobId: await store.enqueueJob('logging', type, {}, key) }), true);
  api.route('POST', '/deliveries/:deliveryId/retry', z.object({}).strict(), async (_, { store, params }) => {
    const id = z.uuid().parse(params.deliveryId);
    if (!await store.call('deliveryRetry', { id })) throw new HttpError(404, 'NOT_RETRYABLE', 'Delivery not found or not retryable.');
    return { queued: true };
  });
}
