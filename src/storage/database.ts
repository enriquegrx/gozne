import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadMigrations, migrate, verifyMigrations } from './migrations.js';

export interface Storage {
  schemaVersion: number;
  check(): void;
  close(): void;
}

export function openStorage(path: string): Storage {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (
    existsSync(path) &&
    (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
  ) {
    throw new Error('Database must be a regular file');
  }
  // The entry point sets umask 077; chmod also hardens an existing database.
  const db = new DatabaseSync(path, {
    timeout: 1000,
    enableForeignKeyConstraints: true,
  });
  try {
    chmodSync(path, 0o600);
    db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF;',
    );
    const schemaVersion = migrate(db);
    const checkQuery = db.prepare(
      "SELECT value FROM service_metadata WHERE key = 'service'",
    );
    return {
      schemaVersion,
      check() {
        if (checkQuery.get()?.value !== 'gozne')
          throw new Error('Storage is unavailable');
      },
      close() {
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function inspectStorage(path: string): { schemaVersion: number } {
  if (
    !existsSync(path) ||
    !lstatSync(path).isFile() ||
    lstatSync(path).isSymbolicLink()
  ) {
    throw new Error('Database is missing or is not a regular file');
  }
  const db = new DatabaseSync(path, { readOnly: true, timeout: 1000 });
  try {
    const migrations = loadMigrations();
    const schemaVersion = verifyMigrations(db, migrations);
    if (schemaVersion !== migrations.length)
      throw new Error('Migrations are pending');
    if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
      throw new Error('Integrity check failed');
    return { schemaVersion };
  } finally {
    db.close();
  }
}
