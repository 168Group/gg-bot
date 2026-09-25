CREATE TABLE guild_config (
  guild_id text PRIMARY KEY, display_name text NOT NULL, revision integer NOT NULL DEFAULT 1,
  setup_complete boolean NOT NULL DEFAULT false
);
CREATE TABLE module_config (
  guild_id text NOT NULL REFERENCES guild_config(guild_id), module_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false, applied_enabled boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL, applied_settings jsonb NOT NULL, settings_version integer NOT NULL,
  desired_revision integer NOT NULL DEFAULT 1, applied_revision integer NOT NULL DEFAULT 0,
  apply_error text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id, module_id)
);
CREATE TABLE settings_audit (
  id uuid PRIMARY KEY, guild_id text NOT NULL REFERENCES guild_config(guild_id), actor_id text NOT NULL,
  module_id text NOT NULL, action text NOT NULL, before_value jsonb NOT NULL, after_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dashboard_session (
  id_hash text PRIMARY KEY, user_id text NOT NULL, label text NOT NULL, tokens text NOT NULL,
  csrf_hash text NOT NULL, expires_at timestamptz NOT NULL, last_seen timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz, access text
);
CREATE TABLE oauth_state (
  id_hash text PRIMARY KEY, expires_at timestamptz NOT NULL
);
CREATE TABLE runtime_health (
  guild_id text NOT NULL REFERENCES guild_config(guild_id), process text NOT NULL,
  heartbeat timestamptz NOT NULL DEFAULT now(), status text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(guild_id, process)
);
CREATE TABLE core_job (
  id uuid PRIMARY KEY, guild_id text NOT NULL REFERENCES guild_config(guild_id), module_id text NOT NULL,
  type text NOT NULL, payload jsonb NOT NULL, idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending', due_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz,
  result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guild_id, module_id, idempotency_key)
);
CREATE INDEX core_job_due ON core_job(guild_id, state, due_at);
CREATE TABLE guild_catalog (
  guild_id text NOT NULL REFERENCES guild_config(guild_id), kind text NOT NULL, id text NOT NULL,
  data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(guild_id, kind, id)
);
CREATE TABLE coverage_incident (
  id uuid PRIMARY KEY, guild_id text NOT NULL REFERENCES guild_config(guild_id), module_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, reason text NOT NULL, dropped_count integer
);
CREATE TABLE module_checkpoint (
  guild_id text NOT NULL REFERENCES guild_config(guild_id), module_id text NOT NULL, stream text NOT NULL,
  cursor text, generation text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id, module_id, stream)
);
