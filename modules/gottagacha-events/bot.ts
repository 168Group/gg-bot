import type { BotModule, BotModuleContext } from '../../packages/module-sdk/src/server.js';
import type { ModulePackageServices } from '../../packages/core/src/module-package.js';
import { API_KEY_PATTERN, EventReadError, fetchEvents } from './client.js';
import { refreshLive, type EventReader } from './live-service.js';
import { liveView, type LiveSnapshot } from './live-model.js';
import { definition, settingsSchema } from './definition.js';
import { type FixtureSnapshot } from './fixtures.js';
import { refreshFixtures } from './service.js';
import { renderDraft, saveDraft, type Draft } from './drafts.js';
import { scheduleHourlyRefresh } from './schedule.js';
import { formatLiveEvents, formatFixtureEvents } from './replies.js';

export function createBot(services: ModulePackageServices, reader: EventReader = fetchEvents): BotModule {
  let settings = settingsSchema.parse(definition.defaultSettings), revision = 0;
  let runtime: BotModuleContext | undefined, stopSchedule: (() => Promise<void>) | undefined;
  const apply = async (input: unknown, nextRevision: number) => {
    const next = settingsSchema.parse(input);
    if (next.mode === 'fixtures') for (const channelId of next.staffChannelIds) await services.validateDestination(channelId);
    await stopSchedule?.(); stopSchedule = undefined;
    settings = next; revision = nextRevision;
    if (runtime && settings.mode === 'api-readonly') stopSchedule = await scheduleHourlyRefresh(runtime, revision);
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
      context.onJob('refresh-api', async job => {
        if (settings.mode !== 'api-readonly') throw new Error('Choose API read-only mode first.');
        if (definition.jobSchemas['refresh-api'].parse(job.payload).revision !== revision) throw new Error('Settings changed. Request a new API refresh.');
        const result = await refreshLive(context.data, revision, job.id, async window => {
          // Resolve only after the cache is invalidated and the refresh is claimed. Never retain a key between jobs.
          let key: string;
          try { key = await context.secrets.get('GG_API_KEY'); }
          catch { throw new EventReadError('auth', 'The API key is unavailable. Ask an owner to check Manage secrets and the server encryption configuration.'); }
          if (!API_KEY_PATTERN.test(key)) throw new EventReadError('auth', 'The API key has an unsupported format. Ask an owner to replace it in Manage secrets.');
          return reader(key, window);
        });
        if (result.state !== 'ready') throw new Error(result.message);
        return `API refresh complete. ${result.events.length} public occurrences cached. No announcements or writes were made.`;
      });
      const upcomingReply = async () => {
        if (settings.mode === 'api-readonly') {
          const stored = await context.data.get<LiveSnapshot>('api-snapshot');
          return formatLiveEvents(stored ? liveView(stored.value, revision) : null);
        }
        if (settings.mode !== 'fixtures') return 'GottaGacha events is not connected yet. Staff can configure read-only browsing in the dashboard.';
        const snapshot = await context.data.get<FixtureSnapshot>('fixture-snapshot');
        return formatFixtureEvents(snapshot?.value ?? null);
      };
      context.onCommand('events upcoming', upcomingReply);
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
      runtime = context;
      context.track(async () => { await stopSchedule?.(); });
      if (settings.mode === 'api-readonly') stopSchedule = await scheduleHourlyRefresh(context, revision);
    },
    applySettings: apply,
    async stop() { await stopSchedule?.(); stopSchedule = undefined; runtime = undefined; settings = settingsSchema.parse(definition.defaultSettings); revision = 0; }
  };
}
