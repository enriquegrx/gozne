import {
  chmodSync,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { inspectStorage } from './database.js';
import { AuthStore } from '../auth/store.js';

function syncPath(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function checkSnapshot(path: string): number {
  const { schemaVersion } = inspectStorage(path);
  const db = new DatabaseSync(path, { readOnly: true, timeout: 1000 });
  try {
    db.exec('PRAGMA trusted_schema = OFF');
    if (
      db
        .prepare("SELECT value FROM service_metadata WHERE key = 'service'")
        .get()?.value !== 'gozne'
    )
      throw new Error('Not a Gozne database');
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Foreign key integrity failed');
    new AuthStore(db).policy();
    return schemaVersion;
  } finally {
    db.close();
  }
}

/** Publish a complete snapshot with no overwrite, even if another process creates the destination. */
async function snapshot(source: string, destination: string, restore: boolean) {
  const target = resolve(destination);
  // Reject existing files, directories and dangling symlinks before doing any work.
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    if (lstatSync(target + suffix, { throwIfNoEntry: false }))
      throw new Error('Destination or SQLite sidecar already exists');
  }
  inspectStorage(source);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(dirname(target), '.gozne-recovery-'));
  chmodSync(stage, 0o700);
  const temporary = join(stage, 'snapshot.sqlite');
  try {
    const db = new DatabaseSync(source, { readOnly: true, timeout: 1000 });
    try {
      // SQLite's backup API includes committed WAL pages while the service remains online.
      await backup(db, temporary);
    } finally {
      db.close();
    }
    chmodSync(temporary, 0o600);
    const schemaVersion = checkSnapshot(temporary);
    const copy = new DatabaseSync(temporary, { timeout: 1000 });
    try {
      // Make the published file self-contained: no sidecar journal is needed after close.
      copy.exec(
        'PRAGMA trusted_schema = OFF; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;',
      );
      if (restore) {
        copy.exec('BEGIN IMMEDIATE');
        try {
          // Old cookies must not become valid again after restoring a pre-revocation snapshot.
          copy.exec(
            "DELETE FROM sessions; DELETE FROM nonces; DELETE FROM action_challenges; UPDATE actions SET status = 'canceled' WHERE status IN ('pending','approved'); UPDATE invitations SET revoked_at = COALESCE(revoked_at, 0);",
          );
          copy
            .prepare('INSERT INTO audit(at, event) VALUES (?, ?)')
            .run(Date.now(), 'database.restored');
          copy.exec('COMMIT');
        } catch (error) {
          if (copy.isTransaction) copy.exec('ROLLBACK');
          throw error;
        }
      }
    } finally {
      copy.close();
    }
    checkSnapshot(temporary);
    syncPath(temporary);
    // Both paths are on the same filesystem. link fails on any pre-existing destination.
    linkSync(temporary, target);
    syncPath(dirname(target));
    return {
      status: 'ok',
      schemaVersion,
      ...(restore ? { sessionsCleared: true } : {}),
    };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export const backupDatabase = (source: string, destination: string) =>
  snapshot(source, destination, false);
export const restoreDatabase = (source: string, destination: string) =>
  snapshot(source, destination, true);
