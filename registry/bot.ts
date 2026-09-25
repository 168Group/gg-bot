import { installedBots } from './installed-bots.js';
import type { LoggingRepository } from '../modules/logging/bot/repository.js';
export function botRegistry(repository: LoggingRepository, validateDestination: (id: string) => Promise<void>, production: boolean) {
  return installedBots({store:repository.store,validateDestination},production);
}
