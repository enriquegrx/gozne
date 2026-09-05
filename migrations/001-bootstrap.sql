-- Only service metadata exists in phase 1. Authentication tables follow later.
CREATE TABLE service_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

INSERT INTO service_metadata (key, value) VALUES ('service', 'gozne');
