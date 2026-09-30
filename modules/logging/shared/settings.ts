import { z } from 'zod';
import { snowflake } from '../../../packages/module-sdk/src/browser.js';
export const eventTypes = ['channel.created', 'channel.updated', 'channel.deleted', 'message.edited', 'message.deleted', 'member.nickname.updated', 'member.roles.updated', 'voice.joined', 'voice.left'] as const;
export type LoggingEventType = typeof eventTypes[number];
export const filterEventTypes = [...eventTypes, 'logging.test'] as const;
export const eventLabels: Record<string, string> = {
  'channel.created': 'Channel created', 'channel.updated': 'Channel updated', 'channel.deleted': 'Channel deleted',
  'message.edited': 'Message edited', 'message.deleted': 'Message deleted', 'member.nickname.updated': 'Nickname changed',
  'member.roles.updated': 'Member roles changed', 'voice.joined': 'Voice channel joined', 'voice.left': 'Voice channel left', 'logging.test': 'Delivery test'
};
export const eventGroups: { name: string; types: LoggingEventType[] }[] = [
  { name: 'Channels', types: ['channel.created', 'channel.updated', 'channel.deleted'] },
  { name: 'Messages', types: ['message.edited', 'message.deleted'] },
  { name: 'Members', types: ['member.nickname.updated', 'member.roles.updated'] },
  { name: 'Voice', types: ['voice.joined', 'voice.left'] }
];
export const loggingSettingsSchema = z.object({
  destinationId: snowflake.nullable().default(null),
  events: z.object({ 'channel.created': z.boolean(), 'channel.updated': z.boolean(), 'channel.deleted': z.boolean(),
    'message.edited': z.boolean().default(false), 'message.deleted': z.boolean().default(false),
    'member.nickname.updated': z.boolean().default(false), 'member.roles.updated': z.boolean().default(false),
    'voice.joined': z.boolean().default(false), 'voice.left': z.boolean().default(false) }).strict(),
  excludedChannelIds: z.array(snowflake).max(100).default([]),
  excludedCategoryIds: z.array(snowflake).max(100).default([]),
  metadataRetentionDays: z.number().int().min(7).max(90).default(30),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#d7f47b')
}).strict();
export type LoggingSettings = z.infer<typeof loggingSettingsSchema>;
export const defaultLoggingSettings: LoggingSettings = loggingSettingsSchema.parse({
  events: Object.fromEntries(eventTypes.map(type => [type, true]))
});
export interface LogEvent {
  id: string; type: string; subjectId: string; subjectLabel: string; channelId: string | null;
  parentId: string | null; observedAt: string; before: Record<string, unknown> | null;
  after: Record<string, unknown> | null; actorId: string | null; reason: string | null;
  attribution: string; configRevision: number; expiresAt: string;
  deliveryState: string | null; messageId: string | null; destinationId: string | null;
}
