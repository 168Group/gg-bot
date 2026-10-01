import { expect, it, vi } from 'vitest';
import { DeliveryWorker } from '../modules/logging/bot/delivery.js';
import { LoggingRepository } from '../modules/logging/bot/repository.js';
import { GuildStore } from '../packages/db/src/index.js';
import type { StorageDriver } from '../packages/db/src/contracts.js';

it('stops an idle delivery batch after one actual storage claim', async () => {
  const call = vi.fn().mockResolvedValue(null);
  const store = new GuildStore({ call } as unknown as StorageDriver, 'guild');
  const send = vi.fn();
  const worker = new DeliveryWorker(new LoggingRepository(store), { validate: vi.fn(), find: vi.fn(), send });
  await worker.drain();
  expect(call).toHaveBeenCalledExactlyOnceWith('guild', 'deliveryClaim', {});
  expect(send).not.toHaveBeenCalled();
});

it('bounds nonempty delivery batches and stops immediately when the queue empties', async () => {
  const worker = new DeliveryWorker({} as LoggingRepository, { validate: vi.fn(), find: vi.fn(), send: vi.fn() });
  const tick = vi.spyOn(worker, 'tick').mockResolvedValue(true);
  await worker.drain();
  expect(tick).toHaveBeenCalledTimes(5);
  tick.mockClear().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await worker.drain();
  expect(tick).toHaveBeenCalledTimes(2);
});
