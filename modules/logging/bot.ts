import { loggingModule } from './bot/module.js';
import { LoggingRepository } from './bot/repository.js';
import type { ModulePackageServices } from '../../packages/core/src/module-package.js';
export function createBot(services: ModulePackageServices) { return loggingModule(new LoggingRepository(services.store), services.validateDestination); }
