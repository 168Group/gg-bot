import type { ModuleJob, ModuleResources } from './services.js';
export type { ModuleData, ModuleJobs, ModuleRecord, ModuleJob, ModuleResources } from './services.js';
import type { ZodType } from 'zod';
import type { Access, ModuleManifest, ModuleState } from './browser.js';

export interface Observation {
  guildId: string; sourceKey: string; type: string; subjectId: string;
  channelId: string | null; parentId: string | null; label: string;
  observedAt: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null;
}
export interface CommandDefinition {
  name: string; description: string; access: 'member' | 'viewer' | 'admin';
  options?: { name: string; description: string; type: 'string' | 'integer' | 'boolean' | 'channel'; required?: boolean }[];
}
export interface CommandContext {
  guildId: string; userId: string; channelId: string | null; access: Access | null;
  options: Record<string, string | number | boolean>;
}
export interface ModuleMessage extends CommandContext { id: string; content: string; reply(text: string): Promise<void> }
export interface MessageSubscription { channelIds(): string[]; access: 'member' | 'admin' }
export interface ModuleDefinition {
  manifest: ModuleManifest;
  settingsSchema: ZodType;
  defaultSettings: unknown;
  commands: string[];
  commandDefinitions?: CommandDefinition[];
  jobSchemas?: Record<string, ZodType>;
  settingsMigrations?: Record<number, (settings: unknown) => unknown>;
}
export interface Logger { info(message: string): void; error(message: string): void }
export interface BotModuleContext extends ModuleResources {
  guildId: string;
  settings: unknown;
  revision: number;
  logger: Logger;
  onObservation(handler: (observation: Observation) => Promise<void>): void;
  onCommand(name: string, handler: (context: CommandContext) => Promise<string>): void;
  onJob(type: string, handler: (job: ModuleJob) => Promise<string>): void;
  onMessage(subscription: MessageSubscription, handler: (message: ModuleMessage) => Promise<void>): void;
  secret(name: string): string;
  track(disposer: () => void | Promise<void>): void;
}
export interface BotModule extends ModuleDefinition {
  start(context: BotModuleContext): Promise<void>;
  applySettings(settings: unknown, revision: number): Promise<void>;
  stop(reason: string): Promise<void>;
}
export interface ModuleConfigurationStore {
  getModule(id: string): Promise<ModuleState>;
  resources?(moduleId: string): ModuleResources;
  acknowledge(id: string, state: ModuleState): Promise<void>;
  reject(id: string, revision: number, message: string): Promise<void>;
}
