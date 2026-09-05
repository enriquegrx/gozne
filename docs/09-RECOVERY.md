# Backup and recovery

The CLI can snapshot an active database and restore it into a **new file**. It
never replaces the database the server is using. Commands reject existing
destinations, symlinks and destination names with WAL/journal sidecars.

## Create a live backup

```sh
docker compose -f examples/compose/orbstack.yaml exec gateway gozne database backup /app/state/backup-01.sqlite --json
```

Choose a new name for every backup. SQLite's backup API includes committed WAL
changes while the service stays online. Copying only an open `gozne.sqlite` file
with `cp` can lose those changes. Continuous writes can extend backup duration.

Gozne verifies integrity, migration history and policy, then publishes a
complete owner-only snapshot without overwriting a concurrently created
destination. The file has mode `0600` and needs no `-wal` or `-shm` sidecars.

Copy it out of the volume so loss of that volume does not destroy the backup:

```sh
mkdir -p backups
chmod 700 backups
docker compose -f examples/compose/orbstack.yaml cp gateway:/app/state/backup-01.sqlite backups/backup-01.sqlite
chmod 600 backups/backup-01.sqlite
```

Use a new local destination too. `backups/` is excluded from Git. Keep a second
copy in your normal backup system. These files contain identity mappings,
policy, audit, session hashes, invitations and action metadata. Restrict access
and encrypt copies that leave the machine.

## Restore for inspection

```sh
docker compose -f examples/compose/orbstack.yaml exec gateway gozne database restore /app/state/backup-01.sqlite /app/state/recovered-01.sqlite --json
docker compose -f examples/compose/orbstack.yaml exec -e GOZNE_DATABASE=/app/state/recovered-01.sqlite gateway gozne doctor --json
docker compose -f examples/compose/orbstack.yaml exec -e GOZNE_DATABASE=/app/state/recovered-01.sqlite gateway gozne policy export --json
```

Restoration preserves snapshot policy and history, but deliberately invalidates
all outstanding authority:

- Deletes every session and login challenge.
- Deletes all action challenges.
- Revokes every invitation, including accepted invitations.
- Cancels pending and approved actions.
- Preserves executed receipts present in the snapshot.
- Adds a `database.restored` audit event.

Everyone must sign in again, and temporary guests need a new invitation. An
approval from a pre-execution snapshot cannot be used to execute the same action
after supported restoration. Receipts newer than the backup are naturally
absent; this is not a reconstruction of events lost after that snapshot.

**Review permissions before activating the recovered database.** An old policy
may authorize a wallet disabled after the backup. Apply the current policy to
the recovered path if available, using the same `GOZNE_DATABASE` override.

Do not start the raw backup file directly: it contains historical sessions and
approvals that may since have been revoked or consumed. Restore only your own
trusted backups. Integrity validation does not establish file provenance.

## Activate the reviewed database

Create a private override:

```yaml
# examples/compose/recovery.local.yaml
services:
  gateway:
    environment:
      GOZNE_DATABASE: /app/state/recovered-01.sqlite
```

Stop the gateway and start it with both files, preserving the original database:

```sh
docker compose -f examples/compose/orbstack.yaml stop gateway
docker compose -f examples/compose/orbstack.yaml -f examples/compose/recovery.local.yaml up -d --wait
```

Check `/healthz`, create a fresh session and exercise the protected app.
Continue using both Compose files to retain the selected database path. Never
overwrite an open database or manually remove its WAL; it may contain committed
writes.

## Versions and upgrade safety

Backup/restore commands require the exact schema supported by the executable.
Keep the image digest or binary version alongside each backup. For an older
schema, first restore using its matching binary, then start the new binary on
that recovered copy to migrate it. Test this sequence before changing live
state.

Schema 4 is additive and scopes existing audit records when their original
session is still available. It does not promote existing users to admin. There
are no down migrations. Do not run an old binary against a schema-4 database;
use the pre-upgrade backup and matching image if rollback is needed, following
the safe restoration procedure above.

Tests cover committed WAL data, corruption, incompatible schemas, invalid
policy, permissions, overwrite/symlink rejection and removal of sessions and
approvals. HTTPS integration exercises backup, restore and doctor inside
containers. A full independent disaster-recovery drill and physical storage
failures remain untested.

Reference:
[Node SQLite backup API](https://nodejs.org/api/sqlite.html#sqlitebackupsource-db-path-options).
