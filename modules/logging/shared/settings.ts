import { z } from 'zod';
import { snowflake } from '../../../packages/module-sdk/src/browser.js';
export const eventTypes = ['channel.created', 'channel.updated', 'channel.deleted'] as const;
export const loggingSettingsSchema = z.object({
  destinationId: snowflake.nullable().default(null),
  events: z.object({ 'channel.created': z.boolean(), 'channel.updated': z.boolean(), 'channel.deleted': z.boolean() }).strict(),
  excludedChannelIds: z.array(snowflake).max(100).default([]),
  excludedCategoryIds: z.array(snowflake).max(100).default([]),
  metadataRetentionDays: z.number().int().min(7).max(90).default(30),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#d7f47b')
}).strict();
export type LoggingSettings = z.infer<typeof loggingSettingsSchema>;
export const defaultLoggingSettings: LoggingSettings = loggingSettingsSchema.parse({
  events: { 'channel.created': true, 'channel.updated': true, 'channel.deleted': true }
});
export interface LogEvent {
  id: string; type: string; subjectId: string; subjectLabel: string; channelId: string | null;
  parentId: string | null; observedAt: string; before: Record<string, unknown> | null;
  after: Record<string, unknown> | null; actorId: string | null; reason: string | null;
  attribution: string; configRevision: number; expiresAt: string;
  deliveryState: string | null; messageId: string | null; destinationId: string | null;
}
