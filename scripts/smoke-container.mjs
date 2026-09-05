import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const name = `gozne-smoke-${process.pid}`;
const volume = `${name}-state`;
const image = process.argv[2] ?? 'gozne:dev';
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

try {
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=16m',
    '--mount',
    `type=volume,source=${volume},target=/app/state`,
    '-p',
    '127.0.0.1::3001',
    image,
  );
  let base;
  const waitUntilReady = async () => {
    // Docker can assign a new ephemeral host port after a restart.
    base = `http://${docker('port', name, '3001/tcp')}`;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch(`${base}/healthz`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.status === 200) return;
      } catch {
        /* Container may still be starting. */
      }
      await setTimeout(500);
    }
    throw new Error('Container did not become ready');
  };
  await waitUntilReady();
  assert.notEqual(docker('exec', name, 'node', '-p', 'process.getuid()'), '0');
  docker(
    'exec',
    name,
    'node',
    '-e',
    "try { require('node:fs').writeFileSync('/app/write-probe', 'x'); process.exit(1); } catch (e) { if (!['EROFS', 'EACCES'].includes(e.code)) throw e; }",
  );
  assert.equal(
    (await fetch(`${base}/v1/auth/validate?application=docs`)).status,
    503,
  );
  const before = JSON.parse(docker('exec', name, 'gozne', 'doctor', '--json'));
  assert.equal(before.status, 'ok');
  const migrationTime = () =>
    docker(
      'exec',
      name,
      'node',
      '--input-type=module',
      '-e',
      "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.env.GOZNE_DATABASE, { readOnly: true }); console.log(db.prepare('SELECT applied_at FROM schema_migrations WHERE version = 1').get().applied_at); db.close();",
    );
  const originalMigrationTime = migrationTime();
  docker('restart', name);
  await waitUntilReady();
  const after = JSON.parse(docker('exec', name, 'gozne', 'doctor', '--json'));
  assert.deepEqual(after, before);
  assert.equal(migrationTime(), originalMigrationTime);
  docker('stop', '--time', '15', name);
  assert.equal(docker('inspect', '--format', '{{.State.ExitCode}}', name), '0');
  console.log(
    'Container verified: non-root, read-only root, persistent SQLite, fail-closed auth and graceful shutdown.',
  );
} finally {
  try {
    docker('rm', '-f', name);
  } catch {
    /* Creation may have failed. */
  }
  try {
    docker('volume', 'rm', volume);
  } catch {
    /* Volume may not exist. */
  }
}
