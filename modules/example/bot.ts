import type { BotModule } from '../../packages/module-sdk/src/server.js';
import { exampleDefinition } from './definition.js';
export function exampleModule(): BotModule {
  let greeting = exampleDefinition.defaultSettings.greeting;
  return { ...exampleDefinition,
    async start(context) { greeting = exampleDefinition.settingsSchema.parse(context.settings).greeting; context.onCommand('example ping', async () => greeting);
      context.onJob('remember', async job => {
        const previous = await context.data.get<{jobId:string}>('last-task');
        if (previous?.value.jobId !== job.id) await context.data.put('last-task', { jobId: job.id, greeting, completedAt: new Date().toISOString() }, previous?.revision ?? 0);
        return 'Greeting remembered. The module stored its own task result.';
      }); },
    async applySettings(input) { greeting = exampleDefinition.settingsSchema.parse(input).greeting; },
    async stop() {}
  };
}

export function createBot(services?: unknown) { void services; return exampleModule(); }
