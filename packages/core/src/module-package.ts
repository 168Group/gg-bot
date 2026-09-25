import type { GuildStore } from '../../db/src/index.js';
/** Trusted server entry point. Most modules use the narrower resources on BotModuleContext. */
export interface ModulePackageServices { store: GuildStore; validateDestination(id: string): Promise<void> }
