import { pgTable, text, boolean, integer, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
export const moduleConfig = pgTable('module_config', {
  guildId: text('guild_id').notNull(), moduleId: text('module_id').notNull(),
  enabled: boolean().notNull(), appliedEnabled: boolean('applied_enabled').notNull(),
  settings: jsonb().notNull(), appliedSettings: jsonb('applied_settings').notNull(),
  settingsVersion: integer('settings_version').notNull(), appliedSettingsVersion: integer('applied_settings_version').notNull(),
  desiredRevision: integer('desired_revision').notNull(), appliedRevision: integer('applied_revision').notNull(),
  applyError: text('apply_error'), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
}, table => [primaryKey({ columns: [table.guildId, table.moduleId] })]);
