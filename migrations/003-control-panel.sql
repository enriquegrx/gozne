CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  application TEXT NOT NULL,
  network TEXT NOT NULL CHECK(network IN ('evm','solana')),
  address TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  accepted_at INTEGER
) STRICT;
CREATE UNIQUE INDEX invitations_live_wallet ON invitations(application, network, address) WHERE revoked_at IS NULL;
CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  application TEXT NOT NULL,
  requester TEXT NOT NULL,
  requester_token_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','executed','canceled')),
  approver_token_hash TEXT,
  approved_by TEXT,
  approved_at INTEGER,
  approval_expires_at INTEGER,
  executed_at INTEGER
) STRICT;
CREATE TABLE action_challenges (
  nonce TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES actions(id),
  session_id TEXT NOT NULL,
  fields TEXT NOT NULL,
  consumed_at INTEGER
) STRICT;
CREATE TABLE demo_deployments (
  action_id TEXT PRIMARY KEY REFERENCES actions(id),
  application TEXT NOT NULL,
  project TEXT NOT NULL,
  version TEXT NOT NULL,
  environment TEXT NOT NULL,
  executed_at INTEGER NOT NULL
) STRICT;
CREATE INDEX actions_application ON actions(application, created_at);
