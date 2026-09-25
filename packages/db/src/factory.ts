import type { Config } from '../../core/src/config.js';
import type { StorageDriver } from './contracts.js';
import { PostgresAdapter } from './postgres-adapter.js';
import { PocketBaseAdapter } from './pocketbase.js';
export function openStorage(config: Config): StorageDriver {
  if (config.STORAGE_PROVIDER === 'postgres') return new PostgresAdapter(config.DATABASE_URL!);
  return new PocketBaseAdapter(config.POCKETBASE_URL!, config.POCKETBASE_SERVICE_KEY!);
}
