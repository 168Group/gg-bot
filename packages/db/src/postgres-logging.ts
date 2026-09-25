import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { PostgresGuildStore } from './postgres.js';
import type { Observation } from '../../module-sdk/src/server.js';
import { loggingSettingsSchema, type LoggingSettings, type LogEvent } from '../../../modules/logging/shared/settings.js';
import { HttpError } from '../../core/src/access.js';

const selection = `e.id,e.type,e.subject_id AS "subjectId",e.subject_label AS "subjectLabel",e.channel_id AS "channelId",e.parent_id AS "parentId",
  e.observed_at AS "observedAt",e.before_value AS before,e.after_value AS after,e.actor_id AS "actorId",e.reason,e.attribution,
  e.config_revision AS "configRevision",e.expires_at AS "expiresAt",d.state AS "deliveryState",d.message_id AS "messageId",d.destination_id AS "destinationId"`;
export const eventFilter = z.object({
  type: z.enum(['channel.created', 'channel.updated', 'channel.deleted', 'logging.test']).optional(),
  subject: z.string().regex(/^\d{17,20}$/).optional(),
  cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(100).default(50)
}).strict();
export class PostgresLoggingRepository {
  constructor(readonly store: PostgresGuildStore) {}
  excluded(event: { subjectId: string; parentId: string | null }, settings: LoggingSettings): boolean {
    return settings.excludedChannelIds.includes(event.subjectId) || settings.excludedCategoryIds.includes(event.subjectId) || (event.parentId !== null && settings.excludedCategoryIds.includes(event.parentId));
  }
  async capture(event: Observation, settings: LoggingSettings, revision: number) {
    if (event.guildId !== this.store.guildId || this.excluded(event, settings)) return;
    if (event.type !== 'logging.test' && !settings.events[event.type as keyof LoggingSettings['events']]) return;
    if (event.type === 'channel.updated' && JSON.stringify(event.before) === JSON.stringify(event.after)) return;
    await this.store.db.transaction(async client => {
      const id = randomUUID();
      const result = await client.query(`INSERT INTO logging_event(id,guild_id,type,source_key,subject_id,subject_label,channel_id,parent_id,observed_at,before_value,after_value,config_revision,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$9::timestamptz+($13::int*interval '1 day')) ON CONFLICT(guild_id,source_key) DO NOTHING RETURNING id`,
      [id, this.store.guildId, event.type, event.sourceKey, event.subjectId, event.label, event.channelId, event.parentId, event.observedAt,
        event.before ? JSON.stringify(event.before) : null, event.after ? JSON.stringify(event.after) : null, revision, settings.metadataRetentionDays]);
      if (result.rowCount && settings.destinationId) {
        const marker = createHash('sha256').update(`${id}:${settings.destinationId}`).digest('hex').slice(0, 24);
        await client.query(`INSERT INTO logging_delivery(id,guild_id,event_id,destination_id,marker) VALUES($1,$2,$3,$4,$5)`, [randomUUID(), this.store.guildId, id, settings.destinationId, marker]);
      }
    });
  }
  async list(input: z.infer<typeof eventFilter>): Promise<{ events: LogEvent[]; nextCursor: string | null }> {
    let cursor: { time: string; id: string } | undefined;
    if (input.cursor) {
      try { cursor = z.object({ time: z.iso.datetime(), id: z.uuid() }).parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString())); }
      catch { throw new HttpError(400, 'INVALID_CURSOR', 'Invalid event cursor.'); }
    }
    const rows = await this.store.db.query<LogEvent>(`SELECT ${selection} FROM logging_event e LEFT JOIN logging_delivery d ON d.event_id=e.id AND d.guild_id=e.guild_id
      WHERE e.guild_id=$1 AND e.expires_at>now() AND ($2::text IS NULL OR e.type=$2) AND ($3::text IS NULL OR e.subject_id=$3)
      AND ($4::timestamptz IS NULL OR (e.observed_at,e.id)<($4::timestamptz,$5::uuid))
      ORDER BY e.observed_at DESC,e.id DESC LIMIT $6`, [this.store.guildId, input.type ?? null, input.subject ?? null, cursor?.time ?? null, cursor?.id ?? null, input.limit + 1]);
    const events = rows.slice(0, input.limit).map(serializeEvent);
    const last = events.at(-1);
    return { events, nextCursor: rows.length > input.limit && last ? Buffer.from(JSON.stringify({ time: last.observedAt, id: last.id })).toString('base64url') : null };
  }
  async detail(id: string): Promise<LogEvent> {
    const [row] = await this.store.db.query<LogEvent>(`SELECT ${selection} FROM logging_event e LEFT JOIN logging_delivery d ON d.event_id=e.id AND d.guild_id=e.guild_id WHERE e.guild_id=$1 AND e.id=$2 AND e.expires_at>now()`, [this.store.guildId, id]);
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Event not found or expired.');
    return serializeEvent(row);
  }
  async apply(settings: LoggingSettings) {
    // Update pending routes and policy atomically. Stored metadata still follows retention.
    await this.store.db.transaction(async client => {
      await client.query(`UPDATE logging_event SET expires_at=LEAST(expires_at,observed_at+($2::int*interval '1 day')) WHERE guild_id=$1`, [this.store.guildId, settings.metadataRetentionDays]);
      await client.query(`UPDATE logging_delivery d SET state='cancelled',lease_until=NULL FROM logging_event e
        WHERE d.guild_id=$1 AND e.id=d.event_id AND d.state IN ('pending','blocked','failed','sending') AND
        (e.expires_at<=now() OR e.subject_id=ANY($2::text[]) OR e.parent_id=ANY($3::text[]) OR e.subject_id=ANY($3::text[]) OR $4::text IS NULL)`,
      [this.store.guildId, settings.excludedChannelIds, settings.excludedCategoryIds, settings.destinationId]);
      if (settings.destinationId) await client.query(`UPDATE logging_delivery SET destination_id=$2,state='pending',next_attempt=now(),last_error=NULL,
        marker=substr(md5(event_id::text||':'||$2),1,24) WHERE guild_id=$1 AND state IN ('pending','blocked','failed')`, [this.store.guildId, settings.destinationId]);
    });
  }
  async cancelPending() {
    await this.store.db.query(`UPDATE logging_delivery SET state='cancelled',lease_until=NULL WHERE guild_id=$1 AND state IN ('pending','blocked','failed','sending')`, [this.store.guildId]);
  }
  async cleanup() { await this.store.db.query('DELETE FROM logging_event WHERE guild_id=$1 AND expires_at<=now()', [this.store.guildId]); }
  async activeSettings(): Promise<{ settings: LoggingSettings; revision: number; enabled: boolean }> {
    const config = await this.store.getModule('logging');
    return { settings: loggingSettingsSchema.parse(config.appliedSettings), revision: config.appliedRevision, enabled: config.appliedEnabled };
  }
}
function serializeEvent(row: LogEvent): LogEvent {
  return { ...row, observedAt: new Date(row.observedAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString() };
}
