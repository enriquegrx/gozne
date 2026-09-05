import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectBoundary,
  certificateFinding,
} from '../src/operations/deployment.js';
import type { ContainerState } from '../src/operations/deployment.js';

function containers(): ContainerState[] {
  return [
    {
      service: 'gateway',
      running: true,
      surface: 'public',
      networks: ['public-backend'],
      ports: [],
      stateMounted: true,
    },
    {
      service: 'demo-app',
      running: true,
      networks: ['public-backend'],
      ports: [],
      stateMounted: false,
    },
    {
      service: 'proxy',
      running: true,
      networks: ['public-backend', 'public-entry'],
      ports: [],
      stateMounted: false,
    },
    {
      service: 'admin-api',
      running: true,
      surface: 'admin',
      networks: ['admin-backend'],
      ports: [],
      stateMounted: true,
    },
    {
      service: 'admin-panel',
      running: true,
      networks: ['admin-backend', 'admin-entry'],
      ports: [{ host: '127.0.0.1', port: '9443' }],
      stateMounted: false,
    },
  ];
}
const internal = new Set(['public-backend', 'admin-backend']);
const failures = (state: ContainerState[], networks = internal) =>
  inspectBoundary(state, networks)
    .filter((f) => f.status === 'fail')
    .map((f) => f.check);
test('deployment diagnostics reject published APIs and non-loopback administrative bindings', () => {
  const state = containers();
  assert.deepEqual(failures(state), []);
  state[4]!.ports.push({ host: '::', port: '9443' });
  state[3]!.ports.push({ host: '127.0.0.1', port: '3001' });
  assert.deepEqual(failures(state), [
    'admin-api.ports',
    'admin-panel.loopback',
  ]);
});
test('deployment diagnostics detect network drift, wrong surfaces and frontend state mounts', () => {
  const state = containers();
  state[3]!.networks.push('public-backend');
  state[0]!.surface = 'admin';
  state[4]!.stateMounted = true;
  assert.deepEqual(failures(state, new Set(['public-backend'])), [
    'gateway.surface',
    'admin-api.network',
    'admin-panel.storage',
    'networks.separation',
  ]);
});
test('deployment diagnostics fail closed for missing, stopped and duplicate services', () => {
  const state = containers();
  state.pop();
  state[3]!.running = false;
  state.push({ ...state[0]! });
  assert.deepEqual(failures(state), [
    'gateway.running',
    'admin-api.running',
    'admin-panel.running',
  ]);
});
test('certificate checks distinguish expiry from the two-day renewal window', () => {
  const now = Date.now();
  assert.equal(
    certificateFinding(new Date(now + 3 * 86400_000).toISOString(), now).status,
    'pass',
  );
  assert.equal(
    certificateFinding(new Date(now + 86400_000).toISOString(), now).status,
    'warn',
  );
  assert.equal(
    certificateFinding(new Date(now).toISOString(), now).status,
    'fail',
  );
  assert.equal(certificateFinding('invalid', now).status, 'fail');
});
