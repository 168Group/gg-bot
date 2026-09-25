-- Existing unscoped sessions intentionally become unusable after this upgrade.
ALTER TABLE dashboard_session ADD COLUMN guild_id text NOT NULL DEFAULT '';
ALTER TABLE oauth_state ADD COLUMN guild_id text NOT NULL DEFAULT '';
ALTER TABLE core_job ADD COLUMN claim_token text;
ALTER TABLE logging_delivery ADD COLUMN claim_token text;
CREATE TABLE worker_lease (guild_id text PRIMARY KEY, owner text NOT NULL, expires_at timestamptz NOT NULL);
