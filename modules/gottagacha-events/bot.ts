import type { BotModule, BotModuleContext } from '../../packages/module-sdk/src/server.js';
import type { ModulePackageServices } from '../../packages/core/src/module-package.js';
import { API_KEY_PATTERN, EventReadError, fetchEvents } from './client.js';
import { refreshLive, type EventReader } from './live-service.js';
import { liveView, venueTime, type LiveSnapshot } from './live-model.js';
import { definition, settingsSchema } from './definition.js';
import { eventTime, upcoming, type FixtureSnapshot } from './fixtures.js';
import { refreshFixtures } from './service.js';
import { renderDraft, saveDraft, type Draft } from './drafts.js';
import { scheduleHourlyRefresh } from './schedule.js';

export function createBot(services: ModulePackageServices, reader: EventReader = fetchEvents): BotModule {
  const display = (value: string) => value.replace(/[\r\n\t]/g, ' ').replace(/([*_~`>|[\]\\])/g, '\\$1');
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
      context.onCommand('events upcoming', async () => {
        if (settings.mode === 'api-readonly') {
          const stored = await context.data.get<LiveSnapshot>('api-snapshot');
          if (!stored) return 'The first event refresh is on its way. Please try again shortly, or ask staff to check the dashboard.';
          const view = liveView(stored.value, revision);
          if (view.state !== 'ready') return 'Current event information is unavailable. Ask staff to refresh the dashboard.';
          return `GottaGacha • This week in Warren\n${view.window.startDate} to ${view.window.endDate}\n${view.events.length ? view.events.slice(0, 5).map(event => `${display(event.title).slice(0, 120)}\n${venueTime(event)}${event.location ? ` • ${display(event.location).slice(0, 80)}` : ''}`).join('\n\n') : 'No public events were returned for this week.'}\n${view.events.length > 5 || view.truncated ? 'Showing a selection. ' : ''}Times are America/Detroit. Refreshes hourly. Last checked <t:${Math.floor(Date.parse(view.refreshedAt!) / 1000)}:R>.`;
        }
        if (settings.mode !== 'fixtures') return 'GottaGacha events is not connected yet. Staff can configure read-only browsing in the dashboard.';
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
      runtime = context;
      context.track(async () => { await stopSchedule?.(); });
      if (settings.mode === 'api-readonly') stopSchedule = await scheduleHourlyRefresh(context, revision);
    },
    applySettings: apply,
    async stop() { await stopSchedule?.(); stopSchedule = undefined; runtime = undefined; settings = settingsSchema.parse(definition.defaultSettings); revision = 0; }
  };
}
