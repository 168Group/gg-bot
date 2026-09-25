import type { PostgresDatabase } from './postgres.js';
import type { Operations } from './contracts.js';
import { resourceSchemas } from './module-resources.js';
import { HttpError } from '../../core/src/access.js';
import type { ModuleRecord } from '../../module-sdk/src/services.js';
const columns = 'key,value,revision,updated_at AS "updatedAt"';
export function postgresResources(db: PostgresDatabase, guild: string) {
  const conflict = () => { throw new HttpError(409, 'REVISION_CONFLICT', 'This record changed. Reload before saving.'); };
  return {
    async recordGet(input: Operations['recordGet']['input']) {
      const { moduleId, key } = resourceSchemas.recordGet.parse(input);
      return (await db.query<ModuleRecord>(`SELECT ${columns} FROM module_record WHERE guild_id=$1 AND module_id=$2 AND key=$3 AND (expires_at IS NULL OR expires_at>now())`, [guild, moduleId, key]))[0] ?? null;
    },
    async recordList(input: Operations['recordList']['input']) {
      const { moduleId, prefix, cursor, limit } = resourceSchemas.recordList.parse(input);
      const records = await db.query<ModuleRecord>(`SELECT ${columns} FROM module_record WHERE guild_id=$1 AND module_id=$2 AND left(key,length($3))=$3 AND key COLLATE "C">$4 AND (expires_at IS NULL OR expires_at>now()) ORDER BY key COLLATE "C" LIMIT $5`, [guild, moduleId, prefix, cursor, limit + 1]);
      const more = records.length > limit; if (more) records.pop();
      return { records, nextCursor: more ? records.at(-1)!.key : null };
    },
    async recordPut(input: Operations['recordPut']['input']) {
      const { moduleId, key, value, expected, ttlMs } = resourceSchemas.recordPut.parse(input);
      const expiry = ttlMs ? new Date(Date.now() + ttlMs) : null;
      const rows = expected === 0 ? await db.query<ModuleRecord>(`INSERT INTO module_record(guild_id,module_id,key,value,expires_at) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(guild_id,module_id,key) DO UPDATE SET value=$4,revision=module_record.revision+1,updated_at=now(),expires_at=$5 WHERE module_record.expires_at<=now() RETURNING ${columns}`, [guild, moduleId, key, JSON.stringify(value), expiry])
        : await db.query<ModuleRecord>(`UPDATE module_record SET value=$4,revision=revision+1,updated_at=now(),expires_at=$6 WHERE guild_id=$1 AND module_id=$2 AND key=$3 AND revision=$5 AND (expires_at IS NULL OR expires_at>now()) RETURNING ${columns}`, [guild, moduleId, key, JSON.stringify(value), expected, expiry]);
      return rows[0] ?? conflict();
    },
    async recordDelete(input: Operations['recordDelete']['input']) {
      const { moduleId, key, expected } = resourceSchemas.recordDelete.parse(input);
      const rows = await db.query(`DELETE FROM module_record WHERE guild_id=$1 AND module_id=$2 AND key=$3 AND revision=$4 AND (expires_at IS NULL OR expires_at>now()) RETURNING key`, [guild, moduleId, key, expected]);
      if (!rows.length) conflict(); return true;
    }
  };
}
