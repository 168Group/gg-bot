ALTER TABLE module_config ADD COLUMN applied_settings_version integer NOT NULL DEFAULT 1;
UPDATE module_config SET applied_settings_version=settings_version;
CREATE TABLE module_record (
  guild_id text NOT NULL,
  module_id text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY(guild_id,module_id,key),
  FOREIGN KEY(guild_id,module_id) REFERENCES module_config(guild_id,module_id) ON DELETE CASCADE
);
CREATE INDEX module_record_expiry ON module_record(expires_at) WHERE expires_at IS NOT NULL;
