import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { backupDatabase, restoreDatabase } from '../src/storage/recovery.js';
import { openStorage } from '../src/storage/database.js';

test('live backup captures committed WAL data, rejects overwrites and leaves no staging files', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gozne-recovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source.sqlite');
  const storage = openStorage(source);
  const writer = new DatabaseSync(source);
  try {
    writer.exec('PRAGMA wal_autocheckpoint = 0');
    writer
      .prepare('INSERT INTO audit(at,event) VALUES (?,?)')
      .run(Date.now(), 'synthetic.before-backup');
    assert.ok(statSync(`${source}-wal`).size > 0);
    const target = join(dir, 'backup with spaces.sqlite');
    await backupDatabase(source, target);
    assert.equal(statSync(target).mode & 0o777, 0o600);
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(
        copy.prepare('SELECT event FROM audit').get()?.event,
        'synthetic.before-backup',
      );
      assert.equal(
        copy.prepare('PRAGMA journal_mode').get()?.journal_mode,
        'delete',
      );
    } finally {
      copy.close();
    }
    const orphanTarget = join(dir, 'orphan.sqlite');
    writeFileSync(`${orphanTarget}-wal`, 'old journal');
    await assert.rejects(restoreDatabase(target, orphanTarget));
    assert.equal(existsSync(orphanTarget), false);
    const saved = readFileSync(target);
    await assert.rejects(backupDatabase(source, target));
    await assert.rejects(restoreDatabase(target, source));
    assert.deepEqual(readFileSync(target), saved);
    const link = join(dir, 'symlink.sqlite');
    symlinkSync(join(dir, 'missing.sqlite'), link);
    await assert.rejects(backupDatabase(source, link));
    assert.equal(existsSync(join(dir, 'missing.sqlite')), false);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith('.gozne-recovery-')),
      false,
    );
    writer
      .prepare('INSERT INTO audit(at,event) VALUES (?,?)')
      .run(Date.now(), 'synthetic.after-backup');
    assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM audit').get()?.n, 2);
  } finally {
    writer.close();
    storage.close();
  }
});

test('corrupt or incompatible backups never publish a destination', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gozne-recovery-invalid-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source.sqlite');
  const target = join(dir, 'restored.sqlite');
  writeFileSync(source, 'not a database');
  await assert.rejects(restoreDatabase(source, target));
  assert.equal(existsSync(target), false);
  rmSync(source);
  openStorage(source).close();
  const db = new DatabaseSync(source);
  try {
    db.exec("UPDATE schema_migrations SET checksum = 'wrong'");
  } finally {
    db.close();
  }
  await assert.rejects(restoreDatabase(source, target));
  assert.equal(existsSync(target), false);
  assert.equal(
    readdirSync(dir).some((name) => name.startsWith('.gozne-recovery-')),
    false,
  );
});

test('invalid policy in an otherwise readable snapshot is rejected before publication', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gozne-recovery-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source.sqlite');
  openStorage(source).close();
  const db = new DatabaseSync(source);
  try {
    db.exec("INSERT INTO effective_policy VALUES (1, '{}', 'incorrect', 0)");
  } finally {
    db.close();
  }
  await assert.rejects(restoreDatabase(source, join(dir, 'target.sqlite')));
  assert.equal(existsSync(join(dir, 'target.sqlite')), false);
  assert.equal(
    readdirSync(dir).some((name) => name.startsWith('.gozne-recovery-')),
    false,
  );
});
