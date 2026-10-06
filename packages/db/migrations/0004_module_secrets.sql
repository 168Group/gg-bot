CREATE TABLE module_secret (
  guild_id text NOT NULL,
  module_id text NOT NULL,
  name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('stored','disabled','environment')),
  ciphertext text,
  revision integer NOT NULL CHECK (revision > 0),
  PRIMARY KEY(guild_id,module_id,name),
  FOREIGN KEY(guild_id,module_id) REFERENCES module_config(guild_id,module_id) ON DELETE CASCADE,
  CHECK ((mode='stored' AND ciphertext IS NOT NULL) OR (mode<>'stored' AND ciphertext IS NULL))
);
