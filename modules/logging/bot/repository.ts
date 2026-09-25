import { z } from 'zod';
import type { GuildStore } from '../../../packages/db/src/index.js';
import type { Observation } from '../../../packages/module-sdk/src/server.js';
import { loggingSettingsSchema, type LoggingSettings } from '../shared/settings.js';
export const eventFilter = z.object({
  type: z.enum(['channel.created', 'channel.updated', 'channel.deleted', 'logging.test']).optional(),
  subject: z.string().regex(/^\d{17,20}$/).optional(), cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
}).strict();
export class LoggingRepository {
  constructor(readonly store: GuildStore) {}
  excluded(event: { subjectId: string; parentId: string | null }, settings: LoggingSettings): boolean {
    return settings.excludedChannelIds.includes(event.subjectId) || settings.excludedCategoryIds.includes(event.subjectId) || (event.parentId !== null && settings.excludedCategoryIds.includes(event.parentId));
  }
  async capture(event: Observation, settings: LoggingSettings, revision: number) {
    if (event.guildId !== this.store.guildId || this.excluded(event, settings)) return;
    if (event.type !== 'logging.test' && !settings.events[event.type as keyof LoggingSettings['events']]) return;
    if (event.type === 'channel.updated' && JSON.stringify(event.before) === JSON.stringify(event.after)) return;
    await this.store.call('eventCapture', { event, settings, revision });
  }
  list(input: z.infer<typeof eventFilter>) { return this.store.call('eventList', eventFilter.parse(input)); }
  detail(id: string) { return this.store.call('eventDetail', { id }); }
  async apply(settings: LoggingSettings) { await this.store.call('loggingApply', { settings }); }
  async cancelPending() { await this.store.call('loggingCancel', {}); }
  async cleanup() { await this.store.call('loggingCleanup', {}); }
  async activeSettings(): Promise<{ settings: LoggingSettings; revision: number; enabled: boolean }> {
    const config = await this.store.getModule('logging');
    return { settings: loggingSettingsSchema.parse(config.appliedSettings), revision: config.appliedRevision, enabled: config.appliedEnabled };
  }
}
