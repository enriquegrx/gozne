import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('configuration defaults to loopback and persistent storage', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3001);
  assert.match(config.databasePath, /state\/gozne.sqlite$/);
});

test('rejects ambiguous ports, unknown options and volatile storage', () => {
  for (const port of ['', '0', '-1', '65536', '3001oops', '3e3', ' 3001']) {
    assert.throws(() => loadConfig({ GOZNE_PORT: port }));
  }
  assert.throws(() => loadConfig({ GOZNE_DATABASE: ':memory:' }));
  assert.throws(() => loadConfig({ GOZNE_HOST: 'example.test' }));
  assert.throws(() => loadConfig({ GOZNE_LOG_LEVEL: 'debug' }));
  assert.throws(() => loadConfig({ GOZNE_POTR: '3001' }));
});
