// Wallet proofs are created only in Gozne's test harness, never in the research app.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Wallet } from 'ethers';

const research = process.env.RESEARCH_REPOSITORY;
assert.ok(research, 'Set RESEARCH_REPOSITORY to the app.quique.es checkout');
const directory = mkdtempSync(join(tmpdir(), 'gozne-research-'));
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
assert.ok(address && typeof address !== 'string');
const port = address.port;
await new Promise((resolve) => listener.close(resolve));
const origin = `https://localhost:${port}`;
const project = `gozne-research-${randomUUID().slice(0, 8)}`;
const env = {
  ...process.env,
  POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
  LAB_RUNTIME_PASSWORD: randomBytes(32).toString('hex'),
  RESEARCH_TEST_PORT: String(port),
  RESEARCH_TEST_TLS: directory,
  RESEARCH_TEST_POLICY: join(directory, 'policy.json'),
};
const compose = (...args) =>
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      project,
      '-f',
      join(resolve(research), 'compose.yaml'),
      '-f',
      join(resolve(research), 'tests/compose.gozne.yaml'),
      ...args,
    ],
    {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000,
    },
  );
const reader = Wallet.createRandom();
const admin = Wallet.createRandom();
writeFileSync(
  env.RESEARCH_TEST_POLICY,
  JSON.stringify({
    version: 1,
    applications: [
      {
        id: 'quique',
        origin,
        evmChainIds: [1],
        solanaChains: ['solana:mainnet'],
        requiredRoles: ['reader'],
      },
    ],
    identities: [
      {
        id: 'reader',
        wallets: [{ network: 'evm', address: reader.address }],
        grants: { quique: ['reader'] },
      },
      {
        id: 'research-admin',
        wallets: [{ network: 'evm', address: admin.address }],
        grants: { quique: ['reader', 'admin'] },
      },
    ],
  }),
);
let ca;
const http = (
  path,
  { method = 'GET', body, cookie, csrf, headers = {} } = {},
) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      origin + path,
      {
        ca,
        family: 4,
        method,
        headers: {
          origin,
          'sec-fetch-site': 'same-origin',
          ...(cookie ? { cookie } : {}),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          ...(payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (response) => {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            json: () => JSON.parse(text),
          }),
        );
      },
    );
    req.setTimeout(10000, () => req.destroy(Error('HTTPS test timeout')));
    req.on('error', reject);
    req.end(payload);
  });
const cookie = (response, name) =>
  response.headers['set-cookie']
    .find((value) => value.startsWith(name + '='))
    .split(';')[0];
async function login(wallet) {
  const challenge = await http('/v1/auth/nonce', {
    method: 'POST',
    body: {
      application: 'quique',
      network: 'evm',
      address: wallet.address,
      chainId: '1',
    },
  });
  assert.equal(challenge.status, 200);
  const { nonce, message } = challenge.json();
  const verified = await http('/v1/auth/verify', {
    method: 'POST',
    cookie: cookie(challenge, '__Host-gozne-login'),
    body: { nonce, message, signature: await wallet.signMessage(message) },
  });
  assert.equal(verified.status, 200);
  return {
    cookie: cookie(verified, '__Host-gozne-session'),
    csrf: verified.json().csrfToken,
  };
}

try {
  execFileSync('sh', ['scripts/demo-certs.sh', directory], { stdio: 'pipe' });
  ca = readFileSync(join(directory, 'cert.pem'));
  compose(
    'run',
    '--rm',
    '--no-deps',
    'gateway',
    'gozne',
    'policy',
    'apply',
    '/app/policy.json',
    '--json',
  );
  compose('up', '-d', '--wait', '--wait-timeout', '120');
  const readerSession = await login(reader);
  const adminSession = await login(admin);
  const body = {
    title: 'HTTPS protected research',
    protocol: 'RAILGUN',
    network: 'eip155:1',
    objective: 'Observe',
    methodology: 'Manual only',
  };
  assert.equal(
    (
      await http('/private/api/v1/experiments', {
        ...readerSession,
        method: 'POST',
        body,
        headers: { 'x-gozne-role': 'admin', 'x-original-method': 'GET' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await http('/private/api/v1/experiments', {
        cookie: adminSession.cookie,
        method: 'POST',
        body,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await http('/private/api/v1/experiments', {
        ...adminSession,
        csrf: readerSession.csrf,
        method: 'POST',
        body,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await http('/private/api/v1/experiments', {
        ...adminSession,
        method: 'POST',
        body,
        headers: { origin: 'https://evil.test' },
      })
    ).status,
    403,
  );
  const created = await http('/private/api/v1/experiments', {
    ...adminSession,
    method: 'POST',
    body,
    headers: { 'x-gozne-identity': 'attacker' },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json().researcher, 'research-admin');
  assert.equal(created.json().title, body.title);
  const experiment = created.json();
  const updated = await http('/private/api/v1/experiments/' + experiment.id, {
    ...adminSession,
    method: 'PATCH',
    body: {
      ...body,
      title: 'Corrected through proxy',
      version: experiment.version,
      reason: 'Title correction',
    },
  });
  assert.equal(updated.status, 200, updated.text);
  const listing = await http('/private/api/v1/experiments', readerSession);
  assert.equal(listing.status, 200);
  assert.equal(listing.json()[0].title, 'Corrected through proxy');
  const html = await http('/private/', adminSession);
  assert.equal(html.status, 200);
  for (const asset of html.text.matchAll(
    /(?:src|href)="(\/private\/assets\/[^"]+)"/g,
  ))
    assert.equal((await http(asset[1], adminSession)).status, 200);
  assert.equal(
    (
      await http(
        '/v1/auth/validate-request?application=quique&method=POST&write_role=admin',
        adminSession,
      )
    ).status,
    404,
  );
  const logout = await http('/v1/auth/logout', {
    ...adminSession,
    method: 'POST',
    body: {},
  });
  assert.equal(logout.status, 200);
  assert.equal(
    (
      await http('/private/api/v1/experiments', {
        ...adminSession,
        method: 'POST',
        body,
      })
    ).status,
    302,
  );
  console.log(
    'Real Gozne + Research HTTPS passed: reader/admin, original method, CSRF binding, origin, sanitized identity, JSON POST/PATCH, React/assets, logout revocation.',
  );
} finally {
  try {
    compose('down', '-v', '--remove-orphans');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
