import type { Observation } from '../../../packages/module-sdk/src/server.js';
import type { LoggingSettings, LoggingEventType } from './settings.js';

export function eventEnabled(type: string, settings: LoggingSettings): boolean {
  return type === 'logging.test' || settings.events[type as LoggingEventType] === true;
}
export function excludedEvent(event: Pick<Observation, 'subjectId' | 'channelId' | 'parentId' | 'before' | 'after' | 'type'>, settings: LoggingSettings): boolean {
  const container = event.after?.containerId ?? event.before?.containerId;
  return settings.excludedChannelIds.includes(event.subjectId)
    || (event.channelId !== null && settings.excludedChannelIds.includes(event.channelId))
    || (typeof container === 'string' && settings.excludedChannelIds.includes(container))
    || settings.excludedCategoryIds.includes(event.subjectId)
    || (event.parentId !== null && settings.excludedCategoryIds.includes(event.parentId))
    || (event.type.startsWith('message.') && event.channelId === settings.destinationId);
}
