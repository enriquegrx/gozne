import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Wallet } from 'ethers';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';

const directory = mkdtempSync(join(tmpdir(), 'gozne-proxy-'));
const project = `gozne-test-${randomUUID().slice(0, 8)}`;
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `https://localhost:${port}`;
const env = {
  ...process.env,
  DEMO_PORT: String(port),
  DEMO_TLS_DIRECTORY: directory,
  DEMO_POLICY_FILE: join(directory, 'policy.json'),
};
const compose = (...args) =>
  execFileSync(
    'docker',
    ['compose', '-p', project, '-f', 'examples/compose/compose.yaml', ...args],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
const eth = Wallet.createRandom();
const solKey = ed25519.utils.randomSecretKey();
const solAddress = base58.encode(ed25519.getPublicKey(solKey));
const policy = {
  version: 1,
  applications: [
    {
      id: 'demo',
      origin,
      evmChainIds: [1],
      solanaChains: ['solana:devnet'],
      requiredRoles: ['reader'],
    },
  ],
  identities: [
    {
      id: 'tester',
      wallets: [
        { network: 'evm', address: eth.address },
        { network: 'solana', address: solAddress },
      ],
      grants: { demo: ['reader', 'admin'] },
    },
  ],
};

try {
  execFileSync('sh', ['scripts/demo-certs.sh', directory], { stdio: 'pipe' });
  writeFileSync(env.DEMO_POLICY_FILE, JSON.stringify(policy), { mode: 0o644 });
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
  compose('up', '-d', '--wait', '--wait-timeout', '90');
  const ca = readFileSync(join(directory, 'cert.pem'));
  const http = (path, { body, cookie, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        `${origin}${path}`,
        {
          family: 4,
          ca,
          method: payload ? 'POST' : 'GET',
          headers: {
            origin,
            'sec-fetch-site': 'same-origin',
            ...(cookie ? { cookie } : {}),
            ...(payload
              ? {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(payload),
                }
              : {}),
            ...headers,
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, text }),
          );
        },
      );
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')));
      req.end(payload);
    });
  assert.equal((await http('/')).status, 200);
  assert.equal((await http('/v1/auth/validate?application=demo')).status, 404);
  assert.equal((await http('/private/')).status, 302);
  const cookieFrom = (response, name) => {
    const cookie = response.headers['set-cookie']?.find((entry) =>
      entry.startsWith(`${name}=`),
    );
    assert.ok(cookie);
    assert.match(cookie, /Secure/);
    assert.doesNotMatch(cookie, /Domain=/);
    return cookie.split(';')[0];
  };
  for (const network of ['evm', 'solana']) {
    const nonce = await http('/v1/auth/nonce', {
      body: {
        application: 'demo',
        network,
        address: network === 'evm' ? eth.address : solAddress,
        chainId: network === 'evm' ? '1' : 'solana:devnet',
      },
    });
    assert.equal(nonce.status, 200, nonce.text);
    const issued = JSON.parse(nonce.text);
    const signature =
      network === 'evm'
        ? await eth.signMessage(issued.message)
        : Buffer.from(
            ed25519.sign(new TextEncoder().encode(issued.message), solKey),
          ).toString('base64');
    const verified = await http('/v1/auth/verify', {
      cookie: cookieFrom(nonce, '__Host-gozne-login'),
      body: { nonce: issued.nonce, message: issued.message, signature },
    });
    assert.equal(verified.status, 200, verified.text);
    const session = JSON.parse(verified.text);
    const cookie = cookieFrom(verified, '__Host-gozne-session');
    const inside = await http('/private/', {
      cookie,
      headers: {
        'x-gozne-identity': 'attacker',
        'x-gozne-role': 'admin',
        'x-gozne-injected': 'forged',
      },
    });
    assert.equal(inside.status, 200, inside.text);
    const result = JSON.parse(inside.text);
    assert.equal(result.headers['x-gozne-identity'], 'tester');
    assert.equal(result.headers['x-gozne-role'], 'reader,admin');
    assert.equal(result.headers['x-gozne-injected'], undefined);
    if (network === 'evm') {
      const control = (
        path,
        body = {},
        clientCookie = cookie,
        csrf = session.csrfToken,
      ) =>
        http(`/v1/auth/control/${path}`, {
          cookie: clientCookie,
          body,
          headers: { 'x-csrf-token': csrf },
        });
      const guest = Wallet.createRandom();
      const invited = await control('invitations', {
        network: 'evm',
        address: guest.address,
        minutes: 30,
      });
      assert.equal(invited.status, 200, invited.text);
      const guestNonce = await http('/v1/auth/nonce', {
        body: {
          application: 'demo',
          network: 'evm',
          address: guest.address,
          chainId: '1',
        },
      });
      assert.equal(guestNonce.status, 200, guestNonce.text);
      const issuedGuest = JSON.parse(guestNonce.text);
      const guestVerified = await http('/v1/auth/verify', {
        cookie: cookieFrom(guestNonce, '__Host-gozne-login'),
        body: {
          nonce: issuedGuest.nonce,
          message: issuedGuest.message,
          signature: await guest.signMessage(issuedGuest.message),
        },
      });
      assert.equal(guestVerified.status, 200, guestVerified.text);
      const guestCookie = cookieFrom(guestVerified, '__Host-gozne-session');
      const guestSession = JSON.parse(guestVerified.text);
      assert.equal(
        (await http('/private/', { cookie: guestCookie })).status,
        200,
      );
      const requested = await control(
        'actions',
        { project: 'website', version: 'v1.2.3', environment: 'staging' },
        guestCookie,
        guestSession.csrfToken,
      );
      assert.equal(requested.status, 200, requested.text);
      const action = JSON.parse(requested.text);
      const challenge = await control(`actions/${action.id}/challenge`, {
        chainId: '1',
      });
      assert.equal(challenge.status, 200, challenge.text);
      const proof = JSON.parse(challenge.text);
      const approval = await control(`actions/${action.id}/approve`, {
        nonce: proof.nonce,
        message: proof.message,
        signature: await eth.signMessage(proof.message),
      });
      assert.equal(approval.status, 200, approval.text);
      const execute = () =>
        control(
          `actions/${action.id}/execute`,
          {},
          guestCookie,
          guestSession.csrfToken,
        );
      assert.equal((await execute()).status, 200);
      assert.equal((await execute()).status, 409);
      assert.equal(
        (await control(`sessions/${guestSession.id}/revoke`)).status,
        200,
      );
      assert.equal(
        (await http('/private/', { cookie: guestCookie })).status,
        302,
      );
      assert.equal(
        (await control(`invitations/${JSON.parse(invited.text).id}/revoke`))
          .status,
        200,
      );
      assert.equal(
        (await http('/private/', { cookie: guestCookie })).status,
        302,
      );
    }
    if (network === 'solana') {
      const directory = await http('/v1/auth/control/users', { cookie });
      assert.equal(directory.status, 200, directory.text);
      const saved = await http('/v1/auth/control/users', {
        cookie,
        headers: { 'x-csrf-token': session.csrfToken },
        body: {
          revision: JSON.parse(directory.text).revision,
          create: true,
          id: 'permanent-reader',
          wallets: [],
          roles: ['reader'],
        },
      });
      assert.equal(saved.status, 200, saved.text);
      assert.equal(JSON.parse(saved.text).reauthenticationRequired, true);
      assert.equal((await http('/private/', { cookie })).status, 302);
      const nextNonce = await http('/v1/auth/nonce', {
        body: {
          application: 'demo',
          network: 'evm',
          address: eth.address,
          chainId: '1',
        },
      });
      assert.equal(nextNonce.status, 200, nextNonce.text);
      const nextProof = JSON.parse(nextNonce.text);
      const nextLogin = await http('/v1/auth/verify', {
        cookie: cookieFrom(nextNonce, '__Host-gozne-login'),
        body: {
          nonce: nextProof.nonce,
          message: nextProof.message,
          signature: await eth.signMessage(nextProof.message),
        },
      });
      assert.equal(nextLogin.status, 200, nextLogin.text);
      const nextCookie = cookieFrom(nextLogin, '__Host-gozne-session');
      assert.equal(
        (
          await http('/v1/auth/logout', {
            cookie: nextCookie,
            body: {},
            headers: { 'x-csrf-token': JSON.parse(nextLogin.text).csrfToken },
          })
        ).status,
        200,
      );
      assert.equal(
        (await http('/private/', { cookie: nextCookie })).status,
        302,
      );
    }
    if (network === 'evm')
      compose(
        'exec',
        '-T',
        'gateway',
        'gozne',
        'session',
        'revoke',
        session.id,
        '--json',
      );
    assert.equal((await http('/private/', { cookie })).status, 302);
  }
  compose(
    'exec',
    '-T',
    'gateway',
    'gozne',
    'database',
    'backup',
    '/app/state/backup.sqlite',
    '--json',
  );
  compose(
    'exec',
    '-T',
    'gateway',
    'gozne',
    'database',
    'restore',
    '/app/state/backup.sqlite',
    '/app/state/restored.sqlite',
    '--json',
  );
  const restoredCommand = (...args) =>
    JSON.parse(
      compose(
        'exec',
        '-T',
        '-e',
        'GOZNE_DATABASE=/app/state/restored.sqlite',
        'gateway',
        'gozne',
        ...args,
        '--json',
      ),
    );
  assert.equal(restoredCommand('doctor').status, 'ok');
  assert.deepEqual(restoredCommand('session', 'list').sessions, []);
  assert.equal(restoredCommand('policy', 'export').identities[0].id, 'tester');
  compose('stop', 'gateway');
  assert.ok(
    [500, 502, 503].includes((await http('/private/')).status),
    'proxy must fail closed when Gozne is unavailable',
  );
  console.log(
    'HTTPS/Nginx verified: EVM + SIWS login, header sanitation, CLI and panel revocation, logout, permanent user management, wallet-bound invitation, signed action, one-time execution, backup/restore and failure closure.',
  );
} catch (error) {
  // These are isolated synthetic services; request bodies and signatures are not logged.
  try {
    process.stderr.write(compose('logs', '--tail', '30'));
  } catch {
    /* Startup may have failed. */
  }
  throw error;
} finally {
  try {
    compose('down', '--volumes', '--remove-orphans');
  } finally {
    rmSync(resolve(directory), { recursive: true, force: true });
  }
}
