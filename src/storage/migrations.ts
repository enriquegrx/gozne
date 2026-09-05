import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function loadMigrations(): Migration[] {
  const directory = fileURLToPath(
    new URL('../../../migrations/', import.meta.url),
  );
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name, index) => {
      if (
        !/^\d{3}-[a-z0-9-]+\.sql$/.test(name) ||
        Number(name.slice(0, 3)) !== index + 1
      ) {
        throw new Error('Migration files must form a consecutive sequence');
      }
      return {
        version: index + 1,
        name,
        sql: readFileSync(join(directory, name), 'utf8'),
      };
    });
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function verifyMigrations(
  db: DatabaseSync,
  migrations: Migration[],
): number {
  const rows = db
    .prepare(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    )
    .all();
  if (rows.length > migrations.length)
    throw new Error('Database schema is newer than this build');
  for (const [index, row] of rows.entries()) {
    const migration = migrations[index];
    if (
      !migration ||
      row.version !== migration.version ||
      row.name !== migration.name ||
      row.checksum !== checksum(migration.sql)
    ) {
      throw new Error('Migration history does not match this build');
    }
  }
  return rows.length;
}

export function migrate(
  db: DatabaseSync,
  migrations = loadMigrations(),
): number {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT`);
    const current = verifyMigrations(db, migrations);
    const record = db.prepare(
      'INSERT INTO schema_migrations VALUES (?, ?, ?, ?)',
    );
    for (const migration of migrations.slice(current)) {
      db.exec(migration.sql);
      record.run(
        migration.version,
        migration.name,
        checksum(migration.sql),
        new Date().toISOString(),
      );
    }
    db.exec('COMMIT');
    return migrations.length;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
