ALTER TABLE audit ADD COLUMN application TEXT;

UPDATE audit
SET application = (
  SELECT sessions.application
  FROM sessions
  WHERE sessions.id = audit.session_id
)
WHERE session_id IS NOT NULL;

CREATE INDEX audit_application_sequence
ON audit(application, sequence DESC);
