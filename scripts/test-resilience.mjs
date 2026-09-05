import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { Wallet } from 'ethers';

const image = process.argv[2] ?? 'gozne:dev';
const prefix = `gozne-resilience-${randomUUID().slice(0, 8)}`;
const directory = mkdtempSync(join(tmpdir(), 'gozne-resilience-'));
const containers = [];
const volumes = [];
const origin = 'https://resilience.example.test';
const wallet = Wallet.createRandom();
const policyFile = join(directory, 'policy.json');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  }).trim();
mkdirSync('reports', { recursive: true });
rmSync('reports/resilience.json', { force: true });
const report = {
  imageId: docker('image', 'inspect', '--format', '{{.Id}}', image),
  startedAt: new Date().toISOString(),
  scenarios: {},
};
const policy = {
  version: 1,
  applications: [
    {
      id: 'demo',
      origin,
      evmChainIds: [1],
      solanaChains: [],
      requiredRoles: ['reader'],
    },
  ],
  identities: [
    {
      id: 'tester',
      wallets: [{ network: 'evm', address: wallet.address }],
      grants: { demo: ['reader'] },
    },
  ],
};
writeFileSync(policyFile, JSON.stringify(policy), { mode: 0o644 });
const command = (name, ...args) =>
  docker('exec', name, 'gozne', ...args, '--json');
const worker = (name, ...args) =>
  docker('exec', name, 'node', '/resilience-worker.mjs', ...args);
async function ready(f) {
  f.base = `http://${docker('port', f.name, '3001/tcp')}`;
  for (let i = 0; i < 60; i++) {
    try {
      if (
        (
          await fetch(`${f.base}/healthz`, {
            signal: AbortSignal.timeout(1000),
          })
        ).status === 200
      )
        return;
    } catch {
      /* Wait for the process to bind its new port. */
    }
    await setTimeout(250);
  }
  throw new Error('Container did not become ready');
}
async function start(suffix, bounded = false) {
  const name = `${prefix}-${suffix}`;
  containers.push(name);
  const storageArgs = bounded
    ? [
        '--tmpfs',
        '/app/state:rw,noexec,nosuid,size=8m,uid=1000,gid=1000,mode=0700',
      ]
    : ['--mount', `type=volume,source=${name}-state,target=/app/state`];
  if (!bounded) volumes.push(`${name}-state`);
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--memory',
    '256m',
    '--pids-limit',
    '100',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=16m',
    ...storageArgs,
    '-p',
    '127.0.0.1::3001',
    '-e',
    'GOZNE_LOG_LEVEL=silent',
    '-e',
    'RESILIENCE_WORKER=1',
    '--mount',
    `type=bind,source=${policyFile},target=/policy.json,readonly`,
    '--mount',
    `type=bind,source=${resolve('scripts/resilience-worker.mjs')},target=/resilience-worker.mjs,readonly`,
    image,
  );
  const f = { name, base: '' };
  await ready(f);
  command(name, 'policy', 'apply', '/policy.json');
  return f;
}
async function http(f, path, { cookie, body, headers = {} } = {}) {
  const started = performance.now();
  const response = await fetch(`${f.base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin,
      'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    text,
    ms: performance.now() - started,
  };
}
function cookieFrom(response, name) {
  const entry = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`));
  assert.ok(entry, 'Expected authentication cookie');
  return entry.split(';')[0];
}
async function challenge(f) {
  const response = await http(f, '/v1/auth/nonce', {
    body: {
      application: 'demo',
      network: 'evm',
      address: wallet.address,
      chainId: '1',
    },
  });
  assert.equal(response.status, 200, response.text);
  const issued = JSON.parse(response.text);
  return {
    ...issued,
    context: cookieFrom(response, '__Host-gozne-login'),
    signature: await wallet.signMessage(issued.message),
  };
}
const verify = (f, issued) =>
  http(f, '/v1/auth/verify', {
    cookie: issued.context,
    body: {
      nonce: issued.nonce,
      message: issued.message,
      signature: issued.signature,
    },
  });
async function login(f) {
  const issued = await challenge(f);
  const response = await verify(f, issued);
  assert.equal(response.status, 200, response.text);
  return {
    ...JSON.parse(response.text),
    cookie: cookieFrom(response, '__Host-gozne-session'),
    issued,
  };
}
async function restart(f, kill = false) {
  if (kill) {
    docker('kill', '--signal=KILL', f.name);
    assert.equal(
      docker('inspect', '--format', '{{.State.ExitCode}}', f.name),
      '137',
    );
    docker('start', f.name);
  } else docker('restart', f.name);
  await ready(f);
}
const latency = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: Number(sorted[Math.floor(sorted.length * 0.5)].toFixed(2)),
    p95Ms: Number(
      sorted[
        Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
      ].toFixed(2),
    ),
    maxMs: Number(sorted.at(-1).toFixed(2)),
  };
};

try {
  const durable = await start('crash');
  const session = await login(durable);
  const pending = await challenge(durable);
  docker(
    'exec',
    '-d',
    durable.name,
    'node',
    '/resilience-worker.mjs',
    'hold-uncommitted',
    session.id,
  );
  let marker;
  for (let i = 0; i < 40; i++) {
    marker = JSON.parse(worker(durable.name, 'ready'));
    if (marker.ready) break;
    await setTimeout(100);
  }
  assert.equal(marker?.ready, true);
  assert.ok(
    marker.walBytes > 512 * 1024,
    'Uncommitted data must have reached the WAL before killing',
  );
  await restart(durable, true);
  const recovered = JSON.parse(
    worker(durable.name, 'inspect', session.id, pending.nonce),
  );
  assert.equal(recovered.integrity, 'ok');
  assert.equal(recovered.uncommitted, 0);
  assert.equal(recovered.session.revokedAt, null);
  assert.equal(recovered.nonce.consumedAt, null);
  assert.equal(
    (await http(durable, '/v1/auth/me', { cookie: session.cookie })).status,
    200,
  );
  assert.equal((await verify(durable, pending)).status, 200);
  command(durable.name, 'session', 'revoke', session.id);
  await restart(durable, true);
  assert.equal(
    (await http(durable, '/v1/auth/me', { cookie: session.cookie })).status,
    401,
  );
  assert.equal((await verify(durable, pending)).status, 401);
  report.scenarios.crash = {
    passed: true,
    forcedStops: 2,
    uncommittedWalBytes: marker.walBytes,
    committedRevocationPreserved: true,
    committedNonceConsumptionPreserved: true,
  };
  console.log(
    'Crash recovery passed: uncommitted WAL rolled back; committed revocation and nonce consumption survived SIGKILL.',
  );

  const disk = await start('disk', true);
  const existing = await login(disk);
  const issued = await challenge(disk);
  worker(disk.name, 'checkpoint');
  const fill = JSON.parse(worker(disk.name, 'fill'));
  const failedLogin = await verify(disk, issued);
  assert.equal(failedLogin.status, 503);
  assert.equal(failedLogin.headers.get('set-cookie'), null);
  const failedLogout = await http(disk, '/v1/auth/logout', {
    cookie: existing.cookie,
    body: {},
    headers: { 'x-csrf-token': existing.csrfToken },
  });
  assert.equal(failedLogout.status, 503);
  assert.equal(failedLogout.headers.get('set-cookie'), null);
  assert.throws(() =>
    command(disk.name, 'wallet', 'disable', 'evm', wallet.address),
  );
  worker(disk.name, 'release');
  const unchanged = JSON.parse(
    worker(disk.name, 'inspect', existing.id, issued.nonce),
  );
  assert.equal(unchanged.integrity, 'ok');
  assert.equal(unchanged.session.revokedAt, null);
  assert.equal(unchanged.nonce.consumedAt, null);
  const livePolicy = JSON.parse(command(disk.name, 'policy', 'export'));
  assert.equal(livePolicy.identities[0].wallets[0].enabled, true);
  assert.equal((await verify(disk, issued)).status, 200);
  assert.equal(
    (
      await http(disk, '/v1/auth/logout', {
        cookie: existing.cookie,
        body: {},
        headers: { 'x-csrf-token': existing.csrfToken },
      })
    ).status,
    200,
  );
  report.scenarios.diskFull = {
    passed: true,
    boundedFilesystemBytes: 8 * 1024 * 1024,
    fillerBytes: fill.bytes,
    loginStatus: failedLogin.status,
    logoutStatus: failedLogout.status,
    recoveredWithoutRestart: true,
  };
  console.log(
    'Full storage passed: login, logout and policy writes failed closed; service recovered after releasing space.',
  );

  await restart(durable);
  const loadSession = await login(durable);
  const baseline = [];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let i = 0; i < 5; i++) {
        const r = await http(durable, '/v1/auth/validate?application=demo', {
          cookie: loadSession.cookie,
        });
        assert.equal(r.status, 200);
        baseline.push(r.ms);
      }
    }),
  );
  const statuses = { 200: 0, 429: 0 };
  const samples = [];
  const health = [];
  const started = performance.now();
  const until = started + 15_000;
  await Promise.all([
    ...Array.from({ length: 8 }, async () => {
      while (performance.now() < until) {
        const r = await http(durable, '/v1/auth/validate?application=demo', {
          cookie: loadSession.cookie,
        });
        assert.ok(
          r.status === 200 || r.status === 429,
          `Unexpected status during load: ${r.status}`,
        );
        statuses[r.status]++;
        samples.push(r.ms);
        await setTimeout(50);
      }
    }),
    (async () => {
      while (performance.now() < until) {
        const r = await http(durable, '/healthz');
        assert.equal(r.status, 200);
        health.push(r.ms);
        await setTimeout(1000);
      }
    })(),
  ]);
  assert.ok(statuses[200] > 0 && statuses[429] > 0);
  assert.ok(
    statuses[200] + baseline.length <= 120,
    'Per-IP quota must hold under concurrency',
  );
  const loadDurationMs = Math.round(performance.now() - started);
  command(durable.name, 'session', 'revoke', loadSession.id);
  await restart(durable);
  assert.equal(
    (
      await http(durable, '/v1/auth/validate?application=demo', {
        cookie: loadSession.cookie,
      })
    ).status,
    401,
  );
  assert.equal(JSON.parse(command(durable.name, 'doctor')).status, 'ok');
  report.scenarios.load = {
    passed: true,
    workers: 8,
    cadenceMs: 50,
    durationMs: loadDurationMs,
    baseline: latency(baseline),
    throttledRun: { statuses, ...latency(samples) },
    health: latency(health),
    revocationPreserved: true,
  };
  report.passed = true;
  report.completedAt = new Date().toISOString();
  mkdirSync('reports', { recursive: true });
  writeFileSync(
    'reports/resilience.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    `Concurrent validation passed: ${statuses[200]} allowed, ${statuses[429]} throttled; health stayed available. Report: reports/resilience.json`,
  );
} catch (error) {
  writeFileSync(
    'reports/resilience.json',
    JSON.stringify(
      { ...report, passed: false, failedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  for (const name of containers) {
    try {
      docker('rm', '-f', name);
    } catch {
      /* Container creation may have failed. */
    }
  }
  for (const name of volumes) {
    try {
      docker('volume', 'rm', name);
    } catch {
      /* Volume may not exist. */
    }
  }
  rmSync(directory, { recursive: true, force: true });
}
