import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { Wallet } from 'ethers';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { buildApp } from '../src/api/app.js';
import { loadConfig } from '../src/config.js';
import { openStorage } from '../src/storage/database.js';
import { validatePolicy } from '../src/policy/policy.js';
import { CONTEXT_COOKIE, SESSION_COOKIE } from '../src/auth/routes.js';
import { token } from '../src/auth/store.js';

const origin = 'https://docs.example.test';
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'gozne-auth-'));
  const path = join(directory, 'gozne.sqlite');
  const eth = Wallet.createRandom();
  const solKey = ed25519.utils.randomSecretKey();
  const solAddress = base58.encode(ed25519.getPublicKey(solKey));
  const policy = validatePolicy({
    version: 1,
    applications: [
      {
        id: 'docs',
        origin,
        evmChainIds: [1],
        solanaChains: ['solana:devnet'],
        requiredRoles: ['reader'],
      },
      {
        id: 'panel',
        origin: 'https://panel.example.test',
        evmChainIds: [1],
        solanaChains: [],
        requiredRoles: ['admin'],
      },
    ],
    identities: [
      {
        id: 'alice',
        wallets: [
          { network: 'evm', address: eth.address },
          { network: 'solana', address: solAddress },
        ],
        grants: { docs: ['reader'], panel: ['reader'] },
      },
    ],
  });
  const storage = openStorage(path);
  storage.auth.applyPolicy(policy);
  const clock = { value: Date.now() };
  const config = loadConfig({
    GOZNE_DATABASE: path,
    GOZNE_LOG_LEVEL: 'silent',
  });
  const f = {
    directory,
    path,
    eth,
    solKey,
    solAddress,
    policy,
    storage,
    clock,
    config,
    app: buildApp(config, storage, () => clock.value),
  };
  t.after(async () => {
    await f.app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return f;
}
type Fixture = ReturnType<typeof fixture>;
function browser(cookie?: string) {
  return {
    origin,
    'sec-fetch-site': 'same-origin',
    ...(cookie ? { cookie } : {}),
  };
}
function getCookie(
  response: { headers: Record<string, unknown> },
  name: string,
): string {
  const values = response.headers['set-cookie'];
  const entries = Array.isArray(values)
    ? (values as string[])
    : [String(values)];
  const entry = entries.find((value) => value.startsWith(`${name}=`));
  assert.ok(entry, `missing ${name}`);
  assert.match(entry, /Secure/);
  assert.match(entry, /HttpOnly/);
  assert.match(entry, /SameSite=Strict/i);
  assert.doesNotMatch(entry, /Domain=/i);
  return entry.split(';')[0]!;
}
async function challenge(
  f: Fixture,
  network: 'evm' | 'solana' = 'evm',
  address?: string,
) {
  const response = await f.app.inject({
    method: 'POST',
    url: '/v1/auth/nonce',
    headers: browser(),
    payload: {
      application: 'docs',
      network,
      address: address ?? (network === 'evm' ? f.eth.address : f.solAddress),
      chainId: network === 'evm' ? '1' : 'solana:devnet',
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  return {
    ...response.json<{ nonce: string; message: string }>(),
    cookie: getCookie(response, CONTEXT_COOKIE),
  };
}
async function login(f: Fixture, network: 'evm' | 'solana' = 'evm') {
  const issued = await challenge(f, network);
  const signature =
    network === 'evm'
      ? await f.eth.signMessage(issued.message)
      : Buffer.from(
          ed25519.sign(new TextEncoder().encode(issued.message), f.solKey),
        ).toString('base64');
  const response = await f.app.inject({
    method: 'POST',
    url: '/v1/auth/verify',
    headers: browser(issued.cookie),
    payload: { nonce: issued.nonce, message: issued.message, signature },
  });
  assert.equal(response.statusCode, 200, response.body);
  return {
    ...response.json<{ id: string; csrfToken: string; identity: string }>(),
    cookie: getCookie(response, SESSION_COOKIE),
    issued,
    signature,
  };
}

test('EVM and SIWS signatures create opaque, application-bound sessions', async (t) => {
  const f = fixture(t);
  for (const network of ['evm', 'solana'] as const) {
    const session = await login(f, network);
    assert.equal(session.identity, 'alice');
    assert.match(session.cookie, /^__Host-gozne-session=[A-Za-z0-9_-]{43}$/);
    const check = await f.app.inject({
      url: '/v1/auth/validate?application=docs',
      headers: { cookie: session.cookie, 'x-gozne-role': 'admin' },
    });
    assert.equal(check.statusCode, 200);
    assert.equal(check.headers['x-gozne-role'], 'reader');
    assert.equal(check.headers['x-gozne-session'], session.id);
    assert.equal(
      (
        await f.app.inject({
          url: '/v1/auth/validate?application=panel',
          headers: { cookie: session.cookie },
        })
      ).statusCode,
      403,
    );
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try {
      assert.equal(
        raw
          .prepare(
            'SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?',
          )
          .get(session.cookie.split('=')[1]!)?.count,
        0,
      );
    } finally {
      raw.close();
    }
  }
});

test('simultaneous proofs consume a nonce exactly once and reject replay', async (t) => {
  const f = fixture(t);
  const issued = await challenge(f);
  const payload = {
    nonce: issued.nonce,
    message: issued.message,
    signature: await f.eth.signMessage(issued.message),
  };
  const results = await Promise.all(
    [1, 2].map(() =>
      f.app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        headers: browser(issued.cookie),
        payload,
      }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.statusCode).sort(),
    [200, 401],
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        headers: browser(issued.cookie),
        payload,
      })
    ).statusCode,
    401,
  );
  assert.equal(f.storage.auth.listSessions().length, 1);
});

test('another browser cannot consume a challenge, but a bound invalid proof does', async (t) => {
  const f = fixture(t);
  const issued = await challenge(f);
  const good = {
    nonce: issued.nonce,
    message: issued.message,
    signature: await f.eth.signMessage(issued.message),
  };
  const send = (cookie: string, payload = good) =>
    f.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      headers: browser(cookie),
      payload,
    });
  assert.equal((await send(`${CONTEXT_COOKIE}=${token()}`)).statusCode, 401);
  assert.equal(
    (
      await send(issued.cookie, {
        ...good,
        message: good.message.replace(
          'docs.example.test',
          'other.example.test',
        ),
      })
    ).statusCode,
    401,
  );
  assert.equal((await send(issued.cookie)).statusCode, 401);
});

test('altered chain, URI, times and application resources are rejected', async (t) => {
  const f = fixture(t);
  for (const transform of [
    (message: string) => message.replace('Chain ID: 1', 'Chain ID: 2'),
    (message: string) =>
      message.replace(`URI: ${origin}/`, 'URI: https://other.example.test/'),
    (message: string) =>
      message.replace(/Issued At: .+/, 'Issued At: 2000-01-01T00:00:00.000Z'),
    (message: string) =>
      message.replace(
        /Expiration Time: .+/,
        'Expiration Time: 2099-01-01T00:00:00.000Z',
      ),
    (message: string) =>
      message.replace(
        'urn:gozne:application:docs',
        'urn:gozne:application:panel',
      ),
  ]) {
    const issued = await challenge(f);
    const message = transform(issued.message);
    const result = await f.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      headers: browser(issued.cookie),
      payload: {
        nonce: issued.nonce,
        message,
        signature: await f.eth.signMessage(message),
      },
    });
    assert.equal(result.statusCode, 401);
    assert.equal(result.headers['set-cookie'], undefined);
  }
});

test('unknown wallets and invalid signatures have the same public failure', async (t) => {
  const f = fixture(t);
  const unknown = Wallet.createRandom();
  const issued = await challenge(f, 'evm', unknown.address);
  const denied = await f.app.inject({
    method: 'POST',
    url: '/v1/auth/verify',
    headers: browser(issued.cookie),
    payload: {
      nonce: issued.nonce,
      message: issued.message,
      signature: await unknown.signMessage(issued.message),
    },
  });
  const own = await challenge(f);
  const errors = t.mock.method(console, 'error', () => {});
  const invalid = await f.app.inject({
    method: 'POST',
    url: '/v1/auth/verify',
    headers: browser(own.cookie),
    payload: {
      nonce: own.nonce,
      message: own.message,
      signature: `0x${'00'.repeat(65)}`,
    },
  });
  assert.equal(denied.statusCode, 401);
  assert.equal(invalid.statusCode, 401);
  assert.equal(
    denied.json<{ error: { code: string } }>().error.code,
    invalid.json<{ error: { code: string } }>().error.code,
  );
  assert.equal(
    errors.mock.callCount(),
    0,
    'malformed signatures must not reach library console logging',
  );
});

test('expiry, restart, revocation and invalid policy preserve correct session state', async (t) => {
  const f = fixture(t);
  const session = await login(f);
  const me = () =>
    f.app.inject({ url: '/v1/auth/me', headers: browser(session.cookie) });
  assert.throws(() =>
    f.storage.auth.applyPolicy({ ...f.policy, unexpected: true }),
  );
  assert.equal((await me()).statusCode, 200);
  await f.app.close();
  f.storage = openStorage(f.path);
  f.app = buildApp(f.config, f.storage, () => f.clock.value);
  assert.equal((await me()).statusCode, 200);
  f.storage.auth.revoke(session.id, f.clock.value);
  await f.app.close();
  f.storage = openStorage(f.path);
  f.app = buildApp(f.config, f.storage, () => f.clock.value);
  assert.equal((await me()).statusCode, 401);
  const expired = await challenge(f);
  f.clock.value += 300_001;
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        headers: browser(expired.cookie),
        payload: {
          nonce: expired.nonce,
          message: expired.message,
          signature: await f.eth.signMessage(expired.message),
        },
      })
    ).statusCode,
    401,
  );
  const fresh = await login(f);
  f.clock.value += 3600_001;
  assert.equal(
    (await f.app.inject({ url: '/v1/auth/me', headers: browser(fresh.cookie) }))
      .statusCode,
    401,
  );
});

test('policy changes revoke sessions and invalidate outstanding challenges atomically', async (t) => {
  const f = fixture(t);
  const session = await login(f);
  const issued = await challenge(f);
  const changed = structuredClone(f.policy);
  changed.identities[0]!.wallets[0]!.enabled = false;
  f.storage.auth.applyPolicy(changed);
  assert.equal(
    (
      await f.app.inject({
        url: '/v1/auth/me',
        headers: browser(session.cookie),
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        headers: browser(issued.cookie),
        payload: {
          nonce: issued.nonce,
          message: issued.message,
          signature: await f.eth.signMessage(issued.message),
        },
      })
    ).statusCode,
    401,
  );
  f.storage.auth.applyPolicy(f.policy);
  assert.equal(
    (
      await f.app.inject({
        url: '/v1/auth/me',
        headers: browser(session.cookie),
      })
    ).statusCode,
    401,
  );
});

test('CSRF, foreign origins and forged identity headers cannot grant access', async (t) => {
  const f = fixture(t);
  const session = await login(f);
  assert.equal(
    (
      await f.app.inject({
        url: '/v1/auth/validate?application=docs',
        headers: { 'x-gozne-identity': 'alice', 'x-gozne-role': 'admin' },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: browser(session.cookie),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: {
          ...browser(session.cookie),
          origin: 'https://evil.example.test',
          'x-csrf-token': session.csrfToken,
        },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: {
          ...browser(session.cookie),
          'x-csrf-token': session.csrfToken,
        },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/v1/auth/me',
        headers: browser(session.cookie),
      })
    ).statusCode,
    401,
  );
});

test('session or audit write failures roll back both login and nonce consumption', async (t) => {
  const f = fixture(t);
  const control = new DatabaseSync(f.path);
  t.after(() => control.close());
  for (const table of ['sessions', 'audit']) {
    const issued = await challenge(f);
    const payload = {
      nonce: issued.nonce,
      message: issued.message,
      signature: await f.eth.signMessage(issued.message),
    };
    control.exec(
      `CREATE TRIGGER reject_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`,
    );
    const failed = await f.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      headers: browser(issued.cookie),
      payload,
    });
    assert.equal(failed.statusCode, 503, failed.body);
    assert.equal(failed.headers['set-cookie'], undefined);
    assert.doesNotMatch(failed.body, /synthetic failure/);
    assert.equal(
      control
        .prepare('SELECT consumed_at FROM nonces WHERE nonce = ?')
        .get(issued.nonce)?.consumed_at,
      null,
    );
    control.exec('DROP TRIGGER reject_write');
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/v1/auth/verify',
          headers: browser(issued.cookie),
          payload,
        })
      ).statusCode,
      200,
    );
  }
});

test('invalid JSON, excessive payloads, unknown fields and per-IP abuse are bounded', async (t) => {
  const f = fixture(t);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        headers: { ...browser(), 'content-type': 'application/json' },
        payload: '{',
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        headers: { ...browser(), 'content-type': 'application/json' },
        payload: JSON.stringify({ message: 'a'.repeat(20000) }),
      })
    ).statusCode,
    413,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/v1/auth/nonce',
        headers: browser(),
        payload: {
          application: 'docs',
          network: 'evm',
          address: f.eth.address,
          chainId: '1',
          role: 'admin',
        },
      })
    ).statusCode,
    400,
  );
  let last = 0;
  for (let i = 0; i < 21; i++) {
    last = (
      await f.app.inject({
        method: 'POST',
        url: '/v1/auth/nonce',
        headers: { ...browser(), 'x-forwarded-for': `192.0.2.${i}` },
        payload: {
          application: 'docs',
          network: 'evm',
          address: f.eth.address,
          chainId: '1',
        },
      })
    ).statusCode;
  }
  assert.equal(last, 429);
});
