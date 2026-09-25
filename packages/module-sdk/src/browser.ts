import { z } from 'zod';

export const snowflake = z.string().regex(/^\d{17,20}$/, 'Use a Discord ID.');
export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/), apiVersion: z.literal(1),
  description: z.string(), dependencies: z.array(z.string()),
  requiredIntents: z.array(z.string()), requiredBotPermissions: z.array(z.string()),
  settingsVersion: z.number().int().positive(),
  requiredSecrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).optional()
}).strict();
export type ModuleManifest = z.infer<typeof manifestSchema>;
export type Access = 'owner' | 'admin' | 'viewer';
export interface ModuleState {
  moduleId: string; settingsVersion?: number; appliedSettingsVersion?: number; enabled: boolean; appliedEnabled: boolean;
  settings: unknown; appliedSettings: unknown; desiredRevision: number;
  appliedRevision: number; applyError: string | null;
}
export interface CatalogChannel { id: string; name: string; type: number; parentId: string | null; canSend: boolean }
export interface ModuleInventory extends ModuleState { manifest: ModuleManifest }
export interface UserSession { userId: string; label: string; access: Access; csrf: string; guildId: string; communityName: string; botName: string; demo: boolean }
export interface WebModule {
  id: string; navigation: { label: string; path: string; order: number };
  load: () => Promise<{ default: import('react').ComponentType }>;
}
