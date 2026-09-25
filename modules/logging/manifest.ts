import { z } from 'zod';
import type { ModuleDefinition } from '../../packages/module-sdk/src/server.js';
import { loggingSettingsSchema, defaultLoggingSettings } from './shared/settings.js';
export const loggingDefinition = {
  manifest: {
    id: 'logging', name: 'Activity logging', version: '0.1.0', apiVersion: 1 as const,
    description: 'A durable record of channel activity, with private delivery and clear attribution.',
    dependencies: [] as string[], requiredIntents: ['Guilds'],
    requiredBotPermissions: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'], settingsVersion: 1
  },
  settingsSchema: loggingSettingsSchema, defaultSettings: defaultLoggingSettings,
  commands: ['logging status', 'logging test'],
  commandDefinitions: [
    { name: 'logging status', description: 'Show logging status', access: 'viewer' },
    { name: 'logging test', description: 'Queue a logging test (approved administrators only)', access: 'admin' }
  ],
  jobSchemas: { test: z.object({}).strict(), diagnostics: z.object({}).strict() }
} satisfies ModuleDefinition;
