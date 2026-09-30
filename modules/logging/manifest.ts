import { z } from 'zod';
import type { ModuleDefinition } from '../../packages/module-sdk/src/server.js';
import { loggingSettingsSchema, defaultLoggingSettings } from './shared/settings.js';
export const loggingDefinition = {
  manifest: {
    id: 'logging', name: 'Activity logging', version: '0.2.0', apiVersion: 1 as const,
    description: 'Readable logs for channels, message edits/deletions, member nicknames/roles and voice activity.',
    dependencies: [] as string[], requiredIntents: ['Guilds', 'GuildMessages', 'MessageContent', 'GuildMembers', 'GuildVoiceStates'],
    requiredBotPermissions: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'], settingsVersion: 2
  },
  settingsSchema: loggingSettingsSchema, defaultSettings: defaultLoggingSettings,
  settingsMigrations: { 1: (settings: unknown) => loggingSettingsSchema.parse(settings) },
  commands: ['logging status', 'logging test'],
  commandDefinitions: [
    { name: 'logging status', description: 'Show logging status', access: 'viewer' },
    { name: 'logging test', description: 'Queue a logging test (approved administrators only)', access: 'admin' }
  ],
  jobSchemas: { test: z.object({}).strict(), diagnostics: z.object({}).strict() }
} satisfies ModuleDefinition;
