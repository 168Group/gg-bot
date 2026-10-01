import { z } from 'zod';
import type { ModuleDefinition } from '../../packages/module-sdk/src/server.js';

export const settingsSchema = z.object({
  mode: z.enum(['disconnected', 'fixtures']),
  staffChannelIds: z.array(z.string().regex(/^\d{17,20}$/)).max(10).refine(ids => new Set(ids).size === ids.length, 'Choose each channel once.')
}).strict();
export type EventSettings = z.infer<typeof settingsSchema>;
export const definition = {
  manifest: {
    id: 'gottagacha-events', name: 'GottaGacha events', version: '0.1.0', apiVersion: 1 as const,
    description: 'Browse sample events and safely review staff drafts while the GottaGacha API contract is confirmed.',
    dependencies: [], requiredIntents: ['GuildMessages', 'MessageContent'],
    requiredBotPermissions: ['ViewChannel', 'SendMessages'], requiredSecrets: [], settingsVersion: 1
  },
  settingsSchema, defaultSettings: { mode: 'disconnected', staffChannelIds: [] } satisfies EventSettings,
  commands: ['events upcoming', 'events draft'],
  commandDefinitions: [
    { name: 'events upcoming', description: 'Browse upcoming events (currently fixtures only)', access: 'member' },
    { name: 'events draft', description: 'Review a saved event draft without publishing', access: 'admin', options: [{ name: 'id', description: 'Draft review ID', type: 'string', required: true }] }
  ],
  jobSchemas: { 'refresh-fixtures': z.object({ revision: z.number().int().positive() }).strict() }
} satisfies ModuleDefinition;
