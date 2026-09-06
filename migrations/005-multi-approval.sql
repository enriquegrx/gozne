ALTER TABLE actions ADD COLUMN required_approvals INTEGER NOT NULL DEFAULT 1
CHECK(required_approvals BETWEEN 1 AND 10);

CREATE TABLE action_approvals (
  action_id TEXT NOT NULL REFERENCES actions(id),
  approver_identity TEXT NOT NULL,
  approver_token_hash TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(action_id, approver_identity)
) STRICT;

INSERT INTO action_approvals(
  action_id,
  approver_identity,
  approver_token_hash,
  approved_at,
  expires_at
)
SELECT
  id,
  approved_by,
  approver_token_hash,
  approved_at,
  approval_expires_at
FROM actions
WHERE approved_by IS NOT NULL
  AND approver_token_hash IS NOT NULL
  AND approved_at IS NOT NULL
  AND approval_expires_at IS NOT NULL;

CREATE INDEX action_approvals_action
ON action_approvals(action_id, expires_at);
