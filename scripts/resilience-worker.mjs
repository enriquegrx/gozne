// Test-only worker, mounted exclusively into disposable resilience containers.
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

if (process.env.RESILIENCE_WORKER !== '1')
  throw new Error('This worker requires an isolated resilience container');
const path = '/app/state/gozne.sqlite';
const [command, sessionId, nonce] = process.argv.slice(2);
if (command === 'fill') {
  const fd = openSync('/app/state/disk-fill', 'wx', 0o600);
  let bytes = 0;
  let full = false;
  try {
    const block = Buffer.alloc(4096);
    while (bytes < 16 * 1024 * 1024) {
      try {
        bytes += writeSync(fd, block);
      } catch (error) {
        if (error.code !== 'ENOSPC') throw error;
        full = true;
        break;
      }
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (!full) throw new Error('Expected bounded test filesystem to be full');
  console.log(JSON.stringify({ full, bytes }));
} else if (command === 'release') {
  unlinkSync('/app/state/disk-fill');
} else if (command === 'ready') {
  console.log(
    JSON.stringify({
      ready: existsSync('/app/state/crash-ready'),
      walBytes: existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0,
    }),
  );
} else {
  const db = new DatabaseSync(path, {
    timeout: 1000,
    readOnly: command === 'inspect',
  });
  if (command === 'hold-uncommitted') {
    db.exec(
      'PRAGMA cache_size = 8; PRAGMA cache_spill = ON; PRAGMA wal_autocheckpoint = 0; BEGIN IMMEDIATE',
    );
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(
      Date.now(),
      sessionId,
    );
    const insert = db.prepare('INSERT INTO audit(at,event) VALUES (?,?)');
    for (let i = 0; i < 128; i++)
      insert.run(Date.now(), `uncommitted:${'x'.repeat(8192)}`);
    // Marker is published only after SQLite has spilled uncommitted pages to the WAL.
    writeFileSync('/app/state/crash-ready', 'ready', { mode: 0o600 });
    setInterval(() => {}, 1000);
  } else {
    try {
      if (command === 'checkpoint') {
        const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        if (result.busy !== 0) throw new Error('Checkpoint blocked');
        console.log(JSON.stringify(result));
      } else if (command === 'inspect') {
        console.log(
          JSON.stringify({
            integrity: db.prepare('PRAGMA quick_check').get().quick_check,
            session: db
              .prepare(
                'SELECT revoked_at AS revokedAt FROM sessions WHERE id = ?',
              )
              .get(sessionId),
            nonce: db
              .prepare(
                'SELECT consumed_at AS consumedAt FROM nonces WHERE nonce = ?',
              )
              .get(nonce),
            uncommitted: db
              .prepare(
                "SELECT COUNT(*) AS n FROM audit WHERE event LIKE 'uncommitted:%'",
              )
              .get().n,
          }),
        );
      } else throw new Error('Unknown worker command');
    } finally {
      db.close();
    }
  }
}
