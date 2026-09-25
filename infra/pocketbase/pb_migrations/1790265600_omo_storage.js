/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const statements = [
    `CREATE TABLE omo_schema(version INTEGER NOT NULL)`,
    `INSERT INTO omo_schema(version) VALUES(1)`,
    `CREATE TABLE omo_guild(guild_id TEXT PRIMARY KEY,display_name TEXT NOT NULL)`,
    `CREATE TABLE omo_module(guild_id TEXT NOT NULL,module_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,applied_enabled INTEGER NOT NULL DEFAULT 0,settings TEXT NOT NULL,applied_settings TEXT NOT NULL,desired_revision INTEGER NOT NULL DEFAULT 1,applied_revision INTEGER NOT NULL DEFAULT 0,settings_version INTEGER NOT NULL,apply_error TEXT,PRIMARY KEY(guild_id,module_id))`,
    `CREATE TABLE omo_settings_audit(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,actor_id TEXT NOT NULL,module_id TEXT NOT NULL,before_value TEXT NOT NULL,after_value TEXT NOT NULL,created_at INTEGER NOT NULL)`,
    `CREATE TABLE omo_session(guild_id TEXT NOT NULL,id_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,label TEXT NOT NULL,tokens TEXT NOT NULL,csrf_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,checked_at INTEGER,access TEXT)`,
    `CREATE TABLE omo_oauth(guild_id TEXT NOT NULL,id_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)`,
    `CREATE TABLE omo_catalog(guild_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(guild_id,kind,id))`,
    `CREATE TABLE omo_health(guild_id TEXT PRIMARY KEY,heartbeat INTEGER NOT NULL,status TEXT NOT NULL,details TEXT NOT NULL)`,
    `CREATE TABLE omo_incident(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,started_at INTEGER NOT NULL,reason TEXT NOT NULL,dropped_count INTEGER)`,
    `CREATE TABLE omo_job(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,module_id TEXT NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,idempotency_key TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',due_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease_until INTEGER,claim_token TEXT,result TEXT,error TEXT,created_at INTEGER NOT NULL,UNIQUE(guild_id,module_id,idempotency_key))`,
    `CREATE INDEX omo_job_due ON omo_job(guild_id,state,due_at)`,
    `CREATE TABLE omo_event(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,type TEXT NOT NULL,source_key TEXT NOT NULL,subject_id TEXT NOT NULL,subject_label TEXT NOT NULL,channel_id TEXT,parent_id TEXT,observed_at INTEGER NOT NULL,before_value TEXT,after_value TEXT,actor_id TEXT,reason TEXT,attribution TEXT NOT NULL DEFAULT 'unavailable',config_revision INTEGER NOT NULL,expires_at INTEGER NOT NULL,UNIQUE(guild_id,source_key),UNIQUE(guild_id,id))`,
    `CREATE INDEX omo_event_time ON omo_event(guild_id,observed_at DESC,id DESC)`,
    `CREATE INDEX omo_event_type ON omo_event(guild_id,type,observed_at DESC)`,
    `CREATE INDEX omo_event_subject ON omo_event(guild_id,subject_id,observed_at DESC)`,
    `CREATE TABLE omo_delivery(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,event_id TEXT NOT NULL,destination_id TEXT NOT NULL,marker TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL,lease_until INTEGER,claim_token TEXT,message_id TEXT,last_error TEXT,created_at INTEGER NOT NULL,UNIQUE(event_id,destination_id),UNIQUE(marker),FOREIGN KEY(guild_id,event_id) REFERENCES omo_event(guild_id,id) ON DELETE CASCADE)`,
    `CREATE INDEX omo_delivery_due ON omo_delivery(guild_id,state,next_attempt)`,
    `CREATE TABLE omo_lease(guild_id TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL)`
  ];
  for (const sql of statements) app.db().newQuery(sql).execute();
}, () => {
  // Rollbacks must be explicit: never destroy an instance's logs as an automatic downgrade.
  throw new Error('Restore a verified backup to roll back the initial OMO schema.');
});
