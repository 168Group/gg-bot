CREATE TABLE logging_event (
  id uuid PRIMARY KEY, guild_id text NOT NULL REFERENCES guild_config(guild_id), type text NOT NULL,
  source_key text NOT NULL, subject_id text NOT NULL, subject_label text NOT NULL,
  channel_id text, parent_id text, observed_at timestamptz NOT NULL, occurred_at timestamptz,
  before_value jsonb, after_value jsonb, actor_id text, reason text,
  attribution text NOT NULL DEFAULT 'unavailable', content_status text NOT NULL DEFAULT 'not-applicable',
  config_revision integer NOT NULL, expires_at timestamptz NOT NULL,
  UNIQUE(guild_id, source_key), UNIQUE(guild_id, id)
);
CREATE INDEX logging_event_time ON logging_event(guild_id, observed_at DESC, id DESC);
CREATE INDEX logging_event_type ON logging_event(guild_id, type, observed_at DESC);
CREATE INDEX logging_event_subject ON logging_event(guild_id, subject_id, observed_at DESC);
CREATE INDEX logging_event_channel ON logging_event(guild_id, channel_id, observed_at DESC);
CREATE TABLE logging_delivery (
  id uuid PRIMARY KEY, guild_id text NOT NULL, event_id uuid NOT NULL,
  destination_id text NOT NULL, marker text NOT NULL, state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0, next_attempt timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz, message_id text, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(guild_id, event_id) REFERENCES logging_event(guild_id, id) ON DELETE CASCADE,
  UNIQUE(event_id, destination_id), UNIQUE(marker)
);
CREATE INDEX logging_delivery_due ON logging_delivery(guild_id, state, next_attempt);
