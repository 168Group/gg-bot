import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { PostgresDatabase } from './postgres.js';
export const migrations = ['packages/db/migrations/0001_core.sql', 'modules/logging/db/0001_logging.sql', 'packages/db/migrations/0002_storage_contract.sql', 'packages/db/migrations/0003_module_resources.sql'];
export async function migrate(db: PostgresDatabase) {
  await db.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('omo:migrations', 0))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migration(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of migrations) {
      const sql = await readFile(name, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = (await client.query('SELECT checksum FROM schema_migration WHERE name=$1', [name])).rows[0];
      if (existing) { if (existing.checksum !== checksum) throw new Error(`Applied migration was modified: ${name}`); continue; }
      await client.query(sql);
      await client.query('INSERT INTO schema_migration(name,checksum) VALUES($1,$2)', [name, checksum]);
    }
  });
}
