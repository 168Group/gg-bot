import type { LoggingRepository } from './repository.js';
import { renderEvent } from './render.js';
import { loggingSettingsSchema } from '../shared/settings.js';
import { eventEnabled } from '../shared/policy.js';
export type DiscordPayload = ReturnType<typeof renderEvent>;
export interface DeliveryTransport {
  validate(destinationId: string): Promise<void>;
  find(destinationId: string, marker: string): Promise<string | null>;
  send(destinationId: string, payload: DiscordPayload, marker: string): Promise<string>;
}
export class DestinationError extends Error { constructor(readonly permanent: boolean) { super(permanent ? 'Destination unavailable. Check channel and permissions.' : 'Delivery interrupted. A retry is scheduled.'); } }
export class DeliveryWorker {
  constructor(private repository: LoggingRepository, private transport: DeliveryTransport) {}
  async drain(limit = 5): Promise<void> {
    for (let i = 0; i < limit; i++) if (!await this.tick()) break;
  }
  async tick(): Promise<boolean> {
    const { store } = this.repository;
    const prepared = await store.call('deliveryPrepare', {});
    if (!prepared) return false;
    const { delivery, event, module } = prepared;
    try {
      const active = { enabled: module.enabled && module.appliedEnabled, settings: loggingSettingsSchema.parse(module.appliedSettings) };
      if (!active.enabled || !eventEnabled(event.type, active.settings) || this.repository.excluded(event, active.settings) || active.settings.destinationId !== delivery.destination_id || new Date(event.expiresAt).getTime() <= Date.now()) {
        await store.call('deliveryFinish', { id: delivery.id, claimToken: delivery.claim_token, state: 'cancelled' }); return true;
      }
      await this.transport.validate(delivery.destination_id);
      const existing = delivery.attempts > 1 ? await this.transport.find(delivery.destination_id, delivery.marker) : null;
      if (!await store.call('deliveryVerify', { id: delivery.id, claimToken: delivery.claim_token, revision: module.appliedRevision })) throw new Error('Delivery configuration or claim changed.');
      const messageId = existing ?? await this.transport.send(delivery.destination_id, renderEvent(event, delivery.marker, active.settings.accentColor), delivery.marker);
      await store.call('deliveryFinish', { id: delivery.id, claimToken: delivery.claim_token, state: 'sent', messageId });
    } catch (error) {
      const permanent = error instanceof DestinationError && error.permanent;
      const expired = Date.now() - new Date(delivery.created_at).getTime() >= 86400000;
      const delay = Math.min(300000, 1000 * 2 ** Math.min(delivery.attempts, 9)) + Math.floor(Math.random() * 1000);
      const state = permanent ? 'blocked' : expired ? 'failed' : 'pending';
      await store.call('deliveryFinish', { id: delivery.id, claimToken: delivery.claim_token, state, error: permanent ? 'Destination unavailable. Check channel and permissions.' : 'Delivery interrupted. Check worker and destination status.', delayMs: delay });
    }
    return true;
  }
}
