migrate(app => {
  app.db().newQuery(`CREATE TABLE omo_module_secret (
    guild_id TEXT NOT NULL, module_id TEXT NOT NULL, name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('stored','disabled','environment')),
    ciphertext TEXT, revision INTEGER NOT NULL CHECK (revision > 0),
    PRIMARY KEY(guild_id,module_id,name),
    FOREIGN KEY(guild_id,module_id) REFERENCES omo_module(guild_id,module_id) ON DELETE CASCADE,
    CHECK ((mode='stored' AND ciphertext IS NOT NULL) OR (mode<>'stored' AND ciphertext IS NULL))
  )`).execute();
}, () => { throw new Error('Restore a verified backup to roll back module secret storage.'); });
