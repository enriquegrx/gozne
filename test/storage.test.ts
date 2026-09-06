import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { inspectStorage, openStorage } from '../src/storage/database.js';
import { loadMigrations, migrate } from '../src/storage/migrations.js';

test('schema survives restart and database is owner-only', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gozne-storage-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'state', 'gozne.sqlite');
  const first = openStorage(path);
  first.check();
  first.close();
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const second = openStorage(path);
  second.check();
  second.close();
  assert.equal(inspectStorage(path).schemaVersion, 5);
});

test('failed migration rolls back its DDL and migration record', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const initial = loadMigrations();
    migrate(db, initial);
    assert.throws(() =>
      migrate(db, [
        ...initial,
        {
          version: 6,
          name: '006-broken.sql',
          sql: 'CREATE TABLE partial (id INTEGER); INSERT INTO missing VALUES (1);',
        },
      ]),
    );
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'partial'").get(),
      undefined,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS total FROM schema_migrations').get()
        ?.total,
      5,
    );
    assert.equal(db.isTransaction, false);
  } finally {
    db.close();
  }
});

test('changed and newer migration histories are rejected', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const migrations = loadMigrations();
    migrate(db, migrations);
    assert.throws(() =>
      migrate(
        db,
        migrations.map((migration) => ({
          ...migration,
          sql: migration.sql + '\n-- changed',
        })),
      ),
    );
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(
      6,
      '006-future.sql',
      'synthetic-checksum',
      'test',
    );
    assert.throws(() => migrate(db, migrations), /newer/);
  } finally {
    db.close();
  }
});

test('audit migration backfills application from an existing session', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const migrations = loadMigrations();
    migrate(db, migrations.slice(0, 3));
    db.prepare(
      'INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
    ).run(
      'hash',
      'session-id',
      'owner',
      'demo',
      'evm',
      '0x0000000000000000000000000000000000000001',
      'https://example.test',
      1,
      2,
    );
    db.prepare(
      'INSERT INTO audit(at, event, identity, session_id) VALUES (?, ?, ?, ?)',
    ).run(1, 'login.succeeded', 'owner', 'session-id');
    assert.equal(migrate(db, migrations), 5);
    assert.equal(
      db.prepare('SELECT application FROM audit').get()?.application,
      'demo',
    );
  } finally {
    db.close();
  }
});

test('multi-approval migration preserves an existing approval', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const migrations = loadMigrations();
    migrate(db, migrations.slice(0, 3));
    db.prepare(
      `INSERT INTO actions(
        id, application, requester, requester_token_hash, payload, payload_hash,
        created_at, expires_at, status, approver_token_hash, approved_by,
        approved_at, approval_expires_at, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      'action-id',
      'demo',
      'requester',
      'requester-hash',
      '{}',
      'payload-hash',
      1,
      10,
      'approved',
      'approver-hash',
      'owner',
      2,
      9,
    );
    assert.equal(migrate(db, migrations), 5);
    assert.equal(
      db.prepare('SELECT required_approvals FROM actions').get()
        ?.required_approvals,
      1,
    );
    assert.deepEqual(
      {
        ...db
          .prepare(
            'SELECT action_id, approver_identity, approver_token_hash, approved_at, expires_at FROM action_approvals',
          )
          .get(),
      },
      {
        action_id: 'action-id',
        approver_identity: 'owner',
        approver_token_hash: 'approver-hash',
        approved_at: 2,
        expires_at: 9,
      },
    );
  } finally {
    db.close();
  }
});

test('diagnostic does not create a missing database and symlinks are rejected', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gozne-inspect-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'missing.sqlite');
  assert.throws(() => inspectStorage(path));
  assert.equal(existsSync(path), false);
  openStorage(path).close();
  const link = join(directory, 'link.sqlite');
  symlinkSync(path, link);
  assert.throws(() => openStorage(link));
  assert.throws(() => inspectStorage(link));
});
