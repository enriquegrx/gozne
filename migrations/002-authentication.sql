CREATE TABLE effective_policy (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  document TEXT NOT NULL,
  digest TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE nonces (
  nonce TEXT PRIMARY KEY,
  context_hash TEXT NOT NULL,
  application TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('evm', 'solana')),
  address TEXT NOT NULL,
  chain TEXT NOT NULL,
  origin TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  message TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;
CREATE INDEX nonces_expiry ON nonces(expires_at);
CREATE INDEX nonces_context ON nonces(context_hash);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  identity TEXT NOT NULL,
  application TEXT NOT NULL,
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE audit (
  sequence INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  event TEXT NOT NULL,
  identity TEXT,
  session_id TEXT
) STRICT;
