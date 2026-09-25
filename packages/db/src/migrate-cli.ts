import { Database } from './index.js';
import { migrate } from './migrate.js';
import { requireSecret } from '../../core/src/config.js';
import { PocketBaseAdapter } from './pocketbase.js';
if ((process.env.STORAGE_PROVIDER ?? 'pocketbase') === 'pocketbase') {
  const db = new PocketBaseAdapter(requireSecret('POCKETBASE_URL'), requireSecret('POCKETBASE_SERVICE_KEY'));
  try { await db.scope(requireSecret('DISCORD_GUILD_ID')).ready(); console.info('PocketBase schema is ready. Its committed migrations run on instance startup.'); }
  finally { await db.close(); }
} else {
  const db = new Database(requireSecret('MIGRATION_DATABASE_URL'));
  try { await migrate(db); console.info('PostgreSQL migrations applied.'); }
  finally { await db.close(); }
}
