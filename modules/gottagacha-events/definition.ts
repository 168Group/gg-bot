import { z } from 'zod';
import type { ModuleDefinition } from '../../packages/module-sdk/src/server.js';

export const settingsSchema = z.object({
  mode: z.enum(['disconnected', 'fixtures', 'api-readonly']),
  staffChannelIds: z.array(z.string().regex(/^\d{17,20}$/)).max(10).refine(ids => new Set(ids).size === ids.length, 'Choose each channel once.')
}).strict();
export type EventSettings = z.infer<typeof settingsSchema>;
export const definition = {
  manifest: {
    id: 'gottagacha-events', name: 'GottaGacha events', version: '0.5.0', apiVersion: 1 as const,
    description: 'Browse public GottaGacha events or explore fixtures. Announcements and event publishing remain unavailable.',
    dependencies: [], requiredIntents: ['GuildMessages', 'MessageContent'],
    requiredBotPermissions: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'], requiredSecrets: ['GG_API_KEY'], settingsVersion: 2
  },
  settingsSchema, defaultSettings: { mode: 'disconnected', staffChannelIds: [] } satisfies EventSettings,
  commands: ['events upcoming', 'events draft'],
  commandDefinitions: [
    { name: 'events upcoming', description: 'Browse the upcoming week or sample events', access: 'member' },
    { name: 'events draft', description: 'Review a saved event draft without publishing', access: 'admin', options: [{ name: 'id', description: 'Draft review ID', type: 'string', required: true }] }
  ],
  settingsMigrations: { 1: (input: unknown) => settingsSchema.parse(input) },
  jobSchemas: {
    'refresh-fixtures': z.object({ revision: z.number().int().positive() }).strict(),
    'refresh-api': z.object({ revision: z.number().int().positive() }).strict()
  }
} satisfies ModuleDefinition;
