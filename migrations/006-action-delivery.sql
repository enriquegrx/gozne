ALTER TABLE actions ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'simulation'
CHECK(delivery_mode IN ('simulation','webhook'));

ALTER TABLE demo_deployments ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'simulation'
CHECK(delivery_mode IN ('simulation','webhook'));
ALTER TABLE demo_deployments ADD COLUMN delivery_status INTEGER;
ALTER TABLE demo_deployments ADD COLUMN response_digest TEXT;

CREATE TABLE action_deliveries (
  action_id TEXT PRIMARY KEY REFERENCES actions(id),
  state TEXT NOT NULL CHECK(state IN ('delivering','failed','delivered')),
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 5),
  lease_token_hash TEXT NOT NULL,
  session_id TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  delivered_at INTEGER,
  status_code INTEGER,
  response_digest TEXT,
  error_code TEXT
) STRICT;
