import type { BotModule } from '../../../packages/module-sdk/src/server.js';
import { loggingDefinition } from '../manifest.js';
import { loggingSettingsSchema, defaultLoggingSettings } from '../shared/settings.js';
import type { LoggingRepository } from './repository.js';
export function loggingModule(repository: LoggingRepository, validateDestination: (id: string) => Promise<void>): BotModule {
  let settings = defaultLoggingSettings, revision = 0;
  const apply = async (input: unknown, nextRevision: number) => {
    const next = loggingSettingsSchema.parse(input);
    if (!next.destinationId) throw new Error('Select a destination before enabling logging.');
    await validateDestination(next.destinationId);
    await repository.apply(next);
    settings = next; revision = nextRevision;
  };
  return { ...loggingDefinition,
    async start(context) {
      await apply(context.settings, context.revision);
      const run = async (job: { id: string; type: string }) => {
        const active = await repository.activeSettings();
        if (!active.enabled || !active.settings.destinationId) throw new Error('Enable logging with an applied destination first.');
        await validateDestination(active.settings.destinationId);
        if (job.type === 'test') await repository.capture({ guildId: context.guildId, sourceKey: `test:${job.id}`, type: 'logging.test', subjectId: context.guildId, channelId: null, parentId: null, label: 'Logging connection test', observedAt: new Date().toISOString(), before: null, after: { result: 'Test requested by an authorized administrator.' } }, active.settings, active.revision);
        return job.type === 'test' ? 'Test event committed to the delivery queue. Check Events for delivery status.' : 'Destination permissions verified.';
      };
      context.onJob('test', run); context.onJob('diagnostics', run);
      context.onObservation(event => repository.capture(event, settings, revision));
      context.onCommand('logging status', async () => `Channel logging active · configuration revision ${revision}. Other event families are not implemented yet.`);
      context.onCommand('logging test', async () => {
        const id = await repository.store.enqueueJob('logging', 'test', {}, crypto.randomUUID());
        return `Test queued: ${id}. It expires after five minutes if the worker is offline.`;
      });
    }, applySettings: apply,
    async stop(reason) { if (reason === 'disabled') await repository.cancelPending(); }
  };
}
