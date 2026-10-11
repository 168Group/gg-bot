import type { BotModuleContext } from '../../packages/module-sdk/src/server.js';
import { REFRESH_INTERVAL_MS } from './live-model.js';

/** Keep this hour and the next in the durable queue. Restarts reuse their keys. */
export async function scheduleHourlyRefresh(context: Pick<BotModuleContext, 'jobs' | 'logger'>, revision: number) {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void>, failures = 0;
  const run = async () => {
    try {
      const slot = Math.floor(Date.now() / REFRESH_INTERVAL_MS);
      for (const hour of [slot, slot + 1]) {
        if (stopped) return;
        await context.jobs.enqueue('refresh-api', { revision }, `hourly:${revision}:${hour}`, {
          delayMs: Math.max(0, hour * REFRESH_INTERVAL_MS - Date.now()), ttlMs: REFRESH_INTERVAL_MS
        });
      }
      failures = 0;
    } catch {
      failures++;
      context.logger.error('Could not queue the hourly event refresh. Scheduling will retry automatically.');
    } finally {
      if (!stopped) {
        const nextHour = REFRESH_INTERVAL_MS - Date.now() % REFRESH_INTERVAL_MS;
        const delay = failures > 0 && failures < 3 ? Math.min(60_000, nextHour) : nextHour;
        timer = setTimeout(() => { pending = run(); }, delay);
        timer.unref();
      }
    }
  };
  pending = run();
  await pending;
  return async () => { stopped = true; clearTimeout(timer); await pending; };
}
