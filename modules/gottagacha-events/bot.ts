import type { BotModule, BotModuleContext } from '../../packages/module-sdk/src/server.js';
import type { ModulePackageServices } from '../../packages/core/src/module-package.js';
import { definition, settingsSchema } from './definition.js';
import { eventTime, upcoming, type FixtureSnapshot } from './fixtures.js';
import { refreshFixtures } from './service.js';
import { renderDraft, saveDraft, type Draft } from './drafts.js';

export function createBot(services: ModulePackageServices): BotModule {
  let settings = settingsSchema.parse(definition.defaultSettings), revision = 0;
  const apply = async (input: unknown, nextRevision: number) => {
    const next = settingsSchema.parse(input);
    if (next.mode === 'fixtures') for (const channelId of next.staffChannelIds) await services.validateDestination(channelId);
    settings = next; revision = nextRevision;
  };
  const requireFixtures = () => { if (settings.mode !== 'fixtures') throw new Error('Choose fixture mode first. The live API is not connected.'); };
  return {
    ...definition,
    async start(context: BotModuleContext) {
      await apply(context.settings, context.revision);
      context.onJob('refresh-fixtures', async job => {
        requireFixtures();
        const input = definition.jobSchemas['refresh-fixtures'].parse(job.payload);
        if (input.revision !== revision) throw new Error('Settings changed. Request a new fixture refresh.');
        const created = await refreshFixtures(context.data);
        return `Fixture refresh complete. ${created} new announcement previews. Nothing was sent.`;
      });
      context.onCommand('events upcoming', async () => {
        if (settings.mode !== 'fixtures') return 'GottaGacha events is not connected yet. Staff are confirming the API contract.';
        const snapshot = await context.data.get<FixtureSnapshot>('fixture-snapshot');
        if (!snapshot) return 'FIXTURE MODE • Ask staff to refresh the sample events in the dashboard.';
        const events = upcoming(snapshot.value.events);
        return `FIXTURE MODE • Sample events only\n${events.length ? events.slice(0, 5).map(event => `${event.title}\n${eventTime(event)} • ${event.location}`).join('\n\n') : 'No upcoming sample events.'}\nThese are not real GottaGacha events.`;
      });
      context.onCommand('events draft', async command => {
        if (settings.mode !== 'fixtures') return 'Draft previews require fixture mode. Publishing is unavailable.';
        const id = command.options.id;
        if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return 'Use the review ID from the draft reply.';
        const draft = await context.data.get<Draft>(`draft:${id}`);
        return draft ? renderDraft(draft.value) : 'That draft is unavailable or expired. Drafts last 24 hours.';
      });
      context.onMessage({ channelIds: () => settings.mode === 'fixtures' ? settings.staffChannelIds : [], access: 'admin' }, async message => {
        if (!message.channelId || !/^event:\s*/i.test(message.content)) return;
        const draft = await saveDraft(context.data, { ...message, channelId: message.channelId });
        await message.reply(renderDraft(draft));
      });
    },
    applySettings: apply,
    async stop() { settings = settingsSchema.parse(definition.defaultSettings); revision = 0; }
  };
}
