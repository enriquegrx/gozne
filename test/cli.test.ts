import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sealAudit } from '../src/audit/export.js';

const cli = fileURLToPath(new URL('../cli/gozne.js', import.meta.url));
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GOZNE_')),
);

test('CLI validation is read-only and has stable failure codes', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gozne-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'gozne.sqlite');
  const env = { ...cleanEnv, GOZNE_DATABASE: path };
  const result = execFileSync(
    process.execPath,
    [cli, 'config', 'check', '--json'],
    { env, encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(result), { status: 'ok' });
  assert.equal(existsSync(path), false);
  assert.equal(
    spawnSync(process.execPath, [cli, 'doctor', '--json'], { env }).status,
    1,
  );
  assert.equal(existsSync(path), false);
  assert.equal(
    spawnSync(process.execPath, [cli, 'config', 'check'], {
      env: { ...env, GOZNE_PORT: 'bad' },
    }).status,
    78,
  );
  assert.equal(
    spawnSync(process.execPath, [cli, 'unknown'], { env }).status,
    64,
  );
});

test('CLI verifies a sealed audit export without opening service storage', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gozne-audit-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'missing.sqlite');
  const path = join(directory, 'audit.json');
  const sealed = sealAudit([
    {
      sequence: 1,
      at: 1000,
      event: 'policy.applied',
      identity: null,
      sessionId: null,
      application: null,
    },
  ]);
  writeFileSync(path, JSON.stringify(sealed));
  const env = { ...cleanEnv, GOZNE_DATABASE: database };
  const result = execFileSync(
    process.execPath,
    [cli, 'audit', 'verify', path, sealed.finalDigest, '--json'],
    { env, encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(result), {
    status: 'ok',
    count: 1,
    finalDigest: sealed.finalDigest,
  });
  assert.equal(existsSync(database), false);
  writeFileSync(path, JSON.stringify({ ...sealed, count: 0 }));
  assert.equal(
    spawnSync(process.execPath, [cli, 'audit', 'verify', path, '--json'], {
      env,
    }).status,
    78,
  );
});
