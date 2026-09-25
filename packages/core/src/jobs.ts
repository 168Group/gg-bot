import type { GuildStore } from '../../db/src/index.js';
import type { ModuleHost } from './host.js';
/** Handler side effects must be idempotent by job.id; an interrupted job can be retried. */
export async function runModuleJobs(store: GuildStore, host: ModuleHost) {
  const moduleIds = host.activeModuleIds();
  if (!moduleIds.length) return;
  const job = await store.call('jobClaim', { moduleIds });
  if (!job) return;
  try {
    await store.call('workerVerify', {});
    const message = await host.job(job.module_id, { id: job.id, type: job.type, payload: job.payload, attempt: job.attempts });
    await store.call('jobFinish', { id: job.id, claimToken: job.claim_token!, error: null, message });
  } catch {
    await store.call('jobFinish', { id: job.id, claimToken: job.claim_token!, error: 'Module task failed. Check its configuration and connection, then submit a new request.', message: null });
  }
}
