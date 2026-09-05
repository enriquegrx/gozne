import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from '../src/api/app.js';
import { loadConfig } from '../src/config.js';
import { openStorage } from '../src/storage/database.js';

test('health, version and auth placeholder expose only the phase 1 contract', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gozne-api-'));
  const config = loadConfig({
    GOZNE_DATABASE: join(directory, 'gozne.sqlite'),
    GOZNE_LOG_LEVEL: 'silent',
  });
  const app = buildApp(config, openStorage(config.databasePath));
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const health = await app.inject({
    url: '/healthz',
    headers: { 'x-request-id': 'client-controlled' },
  });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });
  assert.equal(health.headers['cache-control'], 'no-store');
  assert.notEqual(health.headers['x-request-id'], 'client-controlled');
  assert.equal(
    (await app.inject('/version')).json<{ authentication: boolean }>()
      .authentication,
    true,
  );
  const denied = await app.inject({
    url: '/v1/auth/validate?application=docs',
    headers: {
      cookie: '__Host-gozne-session=synthetic',
      'x-gozne-role': 'admin',
      'x-forwarded-for': '192.0.2.1',
    },
  });
  assert.equal(denied.statusCode, 503);
  assert.equal(denied.headers['set-cookie'], undefined);
  assert.equal(denied.headers['x-gozne-role'], undefined);
  assert.equal((await app.inject('/v1/auth/me')).statusCode, 503);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/healthz' })).statusCode,
    404,
  );
});

test('storage failure is closed and errors do not echo internal details', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gozne-failure-'));
  const storage = openStorage(join(directory, 'gozne.sqlite'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = buildApp(loadConfig({ GOZNE_LOG_LEVEL: 'silent' }), {
    ...storage,
    check() {
      throw new Error('/private/example.sqlite synthetic-sensitive-value');
    },
  });
  app.get('/test-error', async () => {
    throw new Error('synthetic-sensitive-value');
  });
  t.after(() => app.close());
  const response = await app.inject('/healthz');
  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body, /private|sensitive/);
  const error = await app.inject('/test-error');
  assert.equal(error.statusCode, 500);
  assert.doesNotMatch(error.body, /sensitive|stack/);
});
