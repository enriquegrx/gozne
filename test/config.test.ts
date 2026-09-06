import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('configuration defaults to loopback and persistent storage', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3001);
  assert.match(config.databasePath, /state\/gozne.sqlite$/);
  assert.deepEqual(config.actionDelivery, { mode: 'simulation' });
});

test('rejects ambiguous ports, unknown options and volatile storage', () => {
  for (const port of ['', '0', '-1', '65536', '3001oops', '3e3', ' 3001']) {
    assert.throws(() => loadConfig({ GOZNE_PORT: port }));
  }
  assert.throws(() => loadConfig({ GOZNE_DATABASE: ':memory:' }));
  assert.throws(() => loadConfig({ GOZNE_HOST: 'example.test' }));
  assert.throws(() => loadConfig({ GOZNE_LOG_LEVEL: 'debug' }));
  assert.throws(() => loadConfig({ GOZNE_POTR: '3001' }));
  assert.throws(() =>
    loadConfig({ GOZNE_ACTION_WEBHOOK_URL: 'https://adapter.example.test' }),
  );
  assert.throws(() =>
    loadConfig({
      GOZNE_SURFACE: 'admin',
      GOZNE_ACTION_MODE: 'webhook',
      GOZNE_ACTION_WEBHOOK_URL: 'http://adapter.example.test',
      GOZNE_ACTION_WEBHOOK_SECRET: 'x'.repeat(32),
    }),
  );
  assert.throws(() =>
    loadConfig({
      GOZNE_SURFACE: 'public',
      GOZNE_ACTION_MODE: 'webhook',
      GOZNE_ACTION_WEBHOOK_URL: 'https://adapter.example.test',
      GOZNE_ACTION_WEBHOOK_SECRET: 'x'.repeat(32),
    }),
  );
});

test('validates a private HTTPS webhook without exposing its secret', () => {
  const config = loadConfig({
    GOZNE_SURFACE: 'admin',
    GOZNE_ACTION_MODE: 'webhook',
    GOZNE_ACTION_WEBHOOK_URL: 'https://adapter.example.test/actions',
    GOZNE_ACTION_WEBHOOK_SECRET: 'test-webhook-secret.'.repeat(2),
    GOZNE_ACTION_WEBHOOK_TIMEOUT_MS: '750',
  });
  assert.deepEqual(config.actionDelivery, {
    mode: 'webhook',
    url: 'https://adapter.example.test/actions',
    secret: 'test-webhook-secret.'.repeat(2),
    timeoutMs: 750,
  });
});
