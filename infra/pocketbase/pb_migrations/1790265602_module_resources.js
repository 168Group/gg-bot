migrate(app => {
  app.db().newQuery('ALTER TABLE omo_module ADD COLUMN applied_settings_version INTEGER NOT NULL DEFAULT 1').execute();
  app.db().newQuery('UPDATE omo_module SET applied_settings_version=settings_version').execute();
  app.db().newQuery(`CREATE TABLE omo_module_record (
    guild_id TEXT NOT NULL, module_id TEXT NOT NULL, key TEXT NOT NULL,
    value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL, expires_at INTEGER,
    PRIMARY KEY(guild_id,module_id,key),
    FOREIGN KEY(guild_id,module_id) REFERENCES omo_module(guild_id,module_id) ON DELETE CASCADE
  )`).execute();
  app.db().newQuery('CREATE INDEX omo_module_record_expiry ON omo_module_record(expires_at) WHERE expires_at IS NOT NULL').execute();
}, () => { throw new Error('Restore a backup to roll back module resource storage.'); });
