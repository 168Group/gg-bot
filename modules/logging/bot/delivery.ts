import type { LoggingRepository } from './repository.js';
import { renderEvent } from './render.js';
export type DiscordPayload = ReturnType<typeof renderEvent>;
export interface DeliveryTransport {
  validate(destinationId: string): Promise<void>;
  find(destinationId: string, marker: string): Promise<string | null>;
  send(destinationId: string, payload: DiscordPayload, marker: string): Promise<string>;
}
export class DestinationError extends Error { constructor(readonly permanent: boolean) { super(permanent ? 'Destination unavailable. Check channel and permissions.' : 'Delivery interrupted. A retry is scheduled.'); } }
export class DeliveryWorker {
  constructor(private repository: LoggingRepository, private transport: DeliveryTransport) {}
  async tick(): Promise<void> {
    const { store } = this.repository;
    const delivery = await store.call('deliveryClaim', {});
    if (!delivery) return;
    try {
      const active = await this.repository.activeSettings();
      const event = await this.repository.detail(delivery.event_id);
      if (!active.enabled || this.repository.excluded(event, active.settings) || active.settings.destinationId !== delivery.destination_id || new Date(event.expiresAt).getTime() <= Date.now()) {
        await store.call('deliveryFinish', { id: delivery.id, claimToken: delivery.claim_token, state: 'cancelled' }); return;
      }
      await this.transport.validate(delivery.destination_id);
      const existing = delivery.attempts > 1 ? await this.transport.find(delivery.destination_id, delivery.marker) : null;
      await store.call('workerVerify', {});
      const messageId = existing ?? await this.transport.send(delivery.destination_id, renderEvent(event, delivery.marker, active.settings.accentColor), delivery.marker);
      await store.call('deliveryFinish', { id: delivery.id, claimToken: delivery.claim_token, state: 'sent', messageId });
    } catch (error) {
      const permanent = error instanceof DestinationError && error.permanent;
      const expired = Date.now() - new Date(delivery.created_at).getTime() >= 86400000;
      const delay = Math.min(300000, 1000 * 2 ** Math.min(delivery.attempts, 9)) + Math.floor(Math.random() * 1000);
      const state = permanent ? 'blocked' : expired ? 'failed' : 'pending';
      await store.call('deliveryFinish', { id: delivery.id, claimToken: delivery.claim_token, state, error: permanent ? 'Destination unavailable. Check channel and permissions.' : 'Delivery interrupted. Check worker and destination status.', delayMs: delay });
    }
  }
}
