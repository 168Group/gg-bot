import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { moduleConfig } from './schema.js';
import type { ModuleDefinition } from '../../module-sdk/src/server.js';
import type { ModuleState, CatalogChannel } from '../../module-sdk/src/browser.js';
import { HttpError } from '../../core/src/access.js';

export class PostgresDatabase {
  readonly pool: Pool;
  readonly orm;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    this.pool.on('error', () => { console.error('Database connection interrupted.'); });
    this.orm = drizzle(this.pool);
  }
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async close() { await this.pool.end(); }
  async singleton(guildId: string, lost: () => void): Promise<() => Promise<void>> {
    const client = await this.pool.connect();
    client.once('error', lost);
    const result = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [`bot:${guildId}`]);
    if (!result.rows[0]?.acquired) { client.release(); throw new Error('Another bot worker already holds this guild lock.'); }
    return async () => {
      try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`bot:${guildId}`]); }
      finally { client.removeListener('error', lost); client.release(); }
    };
  }
}
export class PostgresGuildStore {
  constructor(readonly db: PostgresDatabase, readonly guildId: string) {}
  async initialize(displayName: string, modules: ModuleDefinition[]) {
    await this.db.transaction(async client => {
      await client.query('INSERT INTO guild_config(guild_id,display_name) VALUES($1,$2) ON CONFLICT DO NOTHING', [this.guildId, displayName]);
      for (const module of modules) await client.query(`INSERT INTO module_config(guild_id,module_id,settings,applied_settings,settings_version)
        VALUES($1,$2,$3,$3,$4) ON CONFLICT DO NOTHING`, [this.guildId, module.manifest.id, JSON.stringify(module.defaultSettings), module.manifest.settingsVersion]);
    });
  }
  async getModule(id: string): Promise<ModuleState> {
    const [row] = await this.db.orm.select().from(moduleConfig).where(and(eq(moduleConfig.guildId, this.guildId), eq(moduleConfig.moduleId, id)));
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Module not found.');
    return row;
  }
  async updateModule(id: string, expected: number, actor: string, change: { settings?: unknown; enabled?: boolean }): Promise<ModuleState> {
    await this.db.transaction(async client => {
      const before = (await client.query('SELECT * FROM module_config WHERE guild_id=$1 AND module_id=$2 FOR UPDATE', [this.guildId, id])).rows[0];
      if (!before) throw new HttpError(404, 'NOT_FOUND', 'Module not found.');
      if (before.desired_revision !== expected) throw new HttpError(409, 'REVISION_CONFLICT', 'Settings changed in another session. Reload before saving.');
      const settings = change.settings ?? before.settings;
      const enabled = change.enabled ?? before.enabled;
      await client.query(`UPDATE module_config SET settings=$3,enabled=$4,desired_revision=desired_revision+1,apply_error=NULL,updated_at=now()
        WHERE guild_id=$1 AND module_id=$2`, [this.guildId, id, JSON.stringify(settings), enabled]);
      await client.query(`INSERT INTO settings_audit(id,guild_id,actor_id,module_id,action,before_value,after_value)
        VALUES($1,$2,$3,$4,'configure',$5,$6)`, [randomUUID(), this.guildId, actor, id, JSON.stringify({ enabled: before.enabled, settings: before.settings }), JSON.stringify({ enabled, settings })]);
    });
    return this.getModule(id);
  }
  async acknowledge(id: string, state: ModuleState) {
    // A concurrent edit remains pending; never overwrite newer desired settings.
    await this.db.query(`UPDATE module_config SET applied_revision=$3,applied_enabled=$4,applied_settings=$5,applied_settings_version=$6,
      apply_error=CASE WHEN desired_revision=$3 THEN NULL ELSE apply_error END WHERE guild_id=$1 AND module_id=$2`,
    [this.guildId, id, state.desiredRevision, state.enabled, JSON.stringify(state.settings), state.settingsVersion ?? 1]);
  }
  async reject(id: string, revision: number, message: string) {
    await this.db.query('UPDATE module_config SET apply_error=$4 WHERE guild_id=$1 AND module_id=$2 AND desired_revision=$3', [this.guildId, id, revision, message]);
  }
  async catalog(): Promise<CatalogChannel[]> {
    const rows = await this.db.query<{ data: CatalogChannel }>('SELECT data FROM guild_catalog WHERE guild_id=$1 AND kind=\'channel\' ORDER BY data->>\'name\'', [this.guildId]);
    return rows.map(row => row.data);
  }
  async replaceCatalog(channels: CatalogChannel[]) {
    await this.db.transaction(async client => {
      await client.query('DELETE FROM guild_catalog WHERE guild_id=$1 AND kind=\'channel\'', [this.guildId]);
      for (const channel of channels) await client.query(`INSERT INTO guild_catalog(guild_id,kind,id,data) VALUES($1,'channel',$2,$3)`, [this.guildId, channel.id, JSON.stringify(channel)]);
    });
  }
  async heartbeat(status: string, details: Record<string, unknown>) {
    await this.db.query(`INSERT INTO runtime_health(guild_id,process,status,details) VALUES($1,'bot',$2,$3)
      ON CONFLICT(guild_id,process) DO UPDATE SET heartbeat=now(),status=$2,details=$3`, [this.guildId, status, JSON.stringify(details)]);
  }
  async incident(reason: string, count: number | null = null) {
    await this.db.query('INSERT INTO coverage_incident(id,guild_id,module_id,reason,dropped_count) VALUES($1,$2,\'logging\',$3,$4)', [randomUUID(), this.guildId, reason, count]);
  }
  async enqueueJob(moduleId: string, type: string, payload: unknown, key: string) {
    const [row] = await this.db.query<{ id: string }>(`INSERT INTO core_job(id,guild_id,module_id,type,payload,idempotency_key,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes') ON CONFLICT(guild_id,module_id,idempotency_key)
      DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id`, [randomUUID(), this.guildId, moduleId, type, JSON.stringify(payload), key]);
    return row!.id;
  }
  async cleanup() {
    await this.db.transaction(async client => {
      await client.query('DELETE FROM module_record WHERE guild_id=$1 AND expires_at<=now()', [this.guildId]);
      await client.query('DELETE FROM settings_audit WHERE guild_id=$1 AND created_at<now()-interval \'90 days\'', [this.guildId]);
      await client.query(`UPDATE core_job SET state='expired',lease_until=NULL WHERE guild_id=$1 AND expires_at<now() AND state IN ('pending','sending')`, [this.guildId]);
      await client.query(`DELETE FROM core_job WHERE guild_id=$1 AND created_at<now()-interval '7 days' AND state NOT IN ('pending','sending')`, [this.guildId]);
      await client.query(`DELETE FROM coverage_incident WHERE guild_id=$1 AND started_at<now()-interval '30 days'`, [this.guildId]);
      await client.query(`DELETE FROM dashboard_session WHERE expires_at<now() OR last_seen<now()-interval '24 hours'`);
      await client.query('DELETE FROM oauth_state WHERE expires_at<now()');
    });
  }
}
