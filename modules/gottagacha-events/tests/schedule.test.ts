import { afterEach, expect, it, vi } from 'vitest';
import { scheduleHourlyRefresh } from '../schedule.js';
import { REFRESH_INTERVAL_MS as hour } from '../live-model.js';
import type { ModuleJobs } from '../../../packages/module-sdk/src/services.js';
import type { ModuleState } from '../../../packages/module-sdk/src/browser.js';
import type { ModulePackageServices } from '../../../packages/core/src/module-package.js';
import { ModuleHost } from '../../../packages/core/src/host.js';
import { createBot } from '../bot.js';

afterEach(() => { vi.useRealTimers(); });
const start = Date.parse('2030-03-10T06:30:00Z'); // Detroit spring DST transition.
function queue() {
  const jobs = new Map<string, { due: number; payload: unknown }>();
  const enqueue = vi.fn<ModuleJobs['enqueue']>(async (_type, payload, key, options) => {
    if (!jobs.has(key)) jobs.set(key, { due: Date.now() + (options?.delayMs ?? 0), payload });
    return key;
  });
  return { jobs, context: { jobs: { enqueue }, logger: { info: vi.fn(), error: vi.fn() } }, enqueue };
}
it('queues immediate and hourly durable jobs, deduplicates restart, crosses DST and cleans up', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start);
  const { jobs, context, enqueue } = queue();
  let stop = await scheduleHourlyRefresh(context, 2);
  expect([...jobs.values()].map(job => job.due)).toEqual([start, start + hour / 2]);
  expect(enqueue.mock.calls.every(call => call[0] === 'refresh-api' && call[3]?.ttlMs === hour)).toBe(true);
  await stop(); stop = await scheduleHourlyRefresh(context, 2);
  expect(jobs.size).toBe(2);
  await vi.advanceTimersByTimeAsync(hour / 2);
  expect(jobs.size).toBe(3);
  expect([...jobs.values()].at(-1)).toEqual({ due: start + hour * 1.5, payload: { revision: 2 } });
  await stop(); const calls = enqueue.mock.calls.length;
  await vi.advanceTimersByTimeAsync(hour * 3);
  expect(enqueue).toHaveBeenCalledTimes(calls);
  stop = await scheduleHourlyRefresh(context, 3);
  expect([...jobs.values()].filter(job => (job.payload as { revision: number }).revision === 3)).toHaveLength(2);
  await stop();
});
it('bounds scheduling retries, sanitizes errors and resumes the next hour after an outage', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start);
  const { context, enqueue } = queue();
  enqueue.mockRejectedValue(new Error('PRIVATE STORAGE DETAILS'));
  const stop = await scheduleHourlyRefresh(context, 1);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(enqueue).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(enqueue).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(context.logger.error.mock.calls)).not.toContain('PRIVATE');
  enqueue.mockResolvedValue('recovered');
  await vi.advanceTimersByTimeAsync(hour / 2 - 180_000);
  expect(enqueue).toHaveBeenCalledTimes(5);
  await stop();
});
it('waits for an in-flight enqueue on stop without scheduling further work', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start);
  const { context, enqueue } = queue();
  const stop = await scheduleHourlyRefresh(context, 1);
  let finish!: (id: string) => void;
  enqueue.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(hour / 2);
  const stopped = stop(); finish('queued'); await stopped;
  await vi.advanceTimersByTimeAsync(hour * 3);
  expect(enqueue).toHaveBeenCalledTimes(3);
});
it('stops automatic work in fixture/disconnected/disabled modes and fences jobs from earlier revisions', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start);
  const { context, enqueue } = queue(), reader = vi.fn();
  const module = createBot({ validateDestination: vi.fn() } as unknown as ModulePackageServices, reader);
  let state: ModuleState = { moduleId: module.manifest.id, settingsVersion: 2, enabled: true, appliedEnabled: false,
    settings: { mode: 'api-readonly', staffChannelIds: [] }, appliedSettings: {}, desiredRevision: 1, appliedRevision: 0, applyError: null };
  const unused = async (): Promise<never> => { throw new Error('No storage reads expected'); };
  const host = new ModuleHost('guild', [module], {
    async getModule() { return state; }, resources: () => ({ jobs: context.jobs, data: { get: unused, put: unused, list: unused, delete: unused } }),
    async acknowledge(_id, next) { state = { ...next, appliedEnabled: next.enabled, appliedRevision: next.desiredRevision }; },
    async reject(_id, _revision, message) { throw new Error(message); }
  }, context.logger);
  try {
    await host.sync(); expect(enqueue).toHaveBeenCalledTimes(2);
    for (const mode of ['fixtures', 'disconnected']) {
      state = { ...state, desiredRevision: state.desiredRevision + 1, settings: { mode, staffChannelIds: [] } }; await host.sync();
      await vi.advanceTimersByTimeAsync(hour); expect(enqueue).toHaveBeenCalledTimes(2);
    }
    state = { ...state, desiredRevision: 4, settings: { mode: 'api-readonly', staffChannelIds: [] } }; await host.sync();
    await expect(host.job(module.manifest.id, { id: 'old', type: 'refresh-api', payload: { revision: 1 }, attempt: 1 })).rejects.toThrow('Settings changed');
    expect(enqueue).toHaveBeenCalledTimes(4);
    state = { ...state, desiredRevision: 5, enabled: false }; await host.sync();
    await expect(host.job(module.manifest.id, { id: 'disabled', type: 'refresh-api', payload: { revision: 4 }, attempt: 1 })).rejects.toThrow('unavailable');
    await vi.advanceTimersByTimeAsync(hour * 2); expect(enqueue).toHaveBeenCalledTimes(4);
    expect(reader).not.toHaveBeenCalled();
  } finally { await host.stop(); }
});
