import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectBoundary,
  certificateFinding,
  versionMetadataFinding,
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
const failures = (
  state: ContainerState[],
  networks = internal,
  allowedAdminHosts?: Set<string>,
) =>
  inspectBoundary(state, networks, allowedAdminHosts)
    .filter((f) => f.status === 'fail')
    .map((f) => f.check);
test('deployment diagnostics reject published APIs and unapproved administrative bindings', () => {
  const state = containers();
  assert.deepEqual(failures(state), []);
  state[4]!.ports.push({ host: '::', port: '9443' });
  state[3]!.ports.push({ host: '127.0.0.1', port: '3001' });
  assert.deepEqual(failures(state), [
    'admin-api.ports',
    'admin-panel.bind-address',
  ]);
});
test('deployment diagnostics accept an explicitly approved private admin address', () => {
  const state = containers();
  state[4]!.ports = [{ host: '172.26.200.110', port: '443' }];
  assert.deepEqual(failures(state, internal, new Set(['172.26.200.110'])), []);
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

test('deployment diagnostics require surface-specific version capabilities', () => {
  const publicMetadata = {
    name: 'gozne',
    version: '0.1.0-dev.13',
    stage: 'alpha',
    surface: 'public',
    authentication: true,
    capabilities: [
      'auth.evm.siwe.v1',
      'auth.solana.siws.v1',
      'forward-auth.session.v1',
      'forward-auth.request.v1',
    ],
  };
  assert.equal(
    versionMetadataFinding('public', 200, JSON.stringify(publicMetadata))
      .status,
    'pass',
  );
  assert.equal(
    versionMetadataFinding(
      'admin',
      200,
      JSON.stringify({
        ...publicMetadata,
        surface: 'admin',
        capabilities: [...publicMetadata.capabilities, 'control.admin.v1'],
      }),
    ).status,
    'pass',
  );
  for (const invalid of [
    { ...publicMetadata, surface: 'admin' },
    { ...publicMetadata, capabilities: ['forward-auth.session.v1'] },
    {
      ...publicMetadata,
      capabilities: [...publicMetadata.capabilities, 'control.admin.v1'],
    },
  ])
    assert.equal(
      versionMetadataFinding('public', 200, JSON.stringify(invalid)).status,
      'fail',
    );
  assert.equal(versionMetadataFinding('public', 404, '').status, 'fail');
  assert.equal(versionMetadataFinding('public', 200, '{').status, 'fail');
});
