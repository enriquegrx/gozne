import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Wallet } from 'ethers';
import { buildApp } from '../src/api/app.js';
import { loadConfig } from '../src/config.js';
import { openStorage } from '../src/storage/database.js';
import { validatePolicy } from '../src/policy/policy.js';

const publicOrigin = 'https://app.example.test';
const adminOrigin = 'https://admin.example.test';
test('separate processes share policy but reject cross-surface sessions and proofs', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gozne-surfaces-'));
  const path = join(dir, 'state.sqlite');
  const owner = Wallet.createRandom();
  const state = openStorage(path);
  state.auth.applyPolicy({
    version: 1,
    applications: [
      {
        id: 'demo',
        origin: publicOrigin,
        adminOrigin,
        evmChainIds: [1],
        solanaChains: [],
        requiredRoles: ['reader'],
      },
    ],
    identities: [
      {
        id: 'owner',
        wallets: [{ network: 'evm', address: owner.address }],
        grants: { demo: ['reader', 'admin'] },
      },
    ],
  });
  const pub = buildApp(
    loadConfig({ GOZNE_DATABASE: path, GOZNE_LOG_LEVEL: 'silent' }),
    state,
  );
  const admin = buildApp(
    loadConfig({
      GOZNE_DATABASE: path,
      GOZNE_LOG_LEVEL: 'silent',
      GOZNE_SURFACE: 'admin',
    }),
    openStorage(path),
  );
  t.after(async () => {
    await pub.close();
    await admin.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const issue = (app: typeof pub, origin: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/auth/nonce',
      headers: { origin },
      payload: {
        application: 'demo',
        network: 'evm',
        address: owner.address,
        chainId: '1',
      },
    });
  const cookies = (response: Awaited<ReturnType<typeof issue>>) =>
    response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  for (const [app, origin, other] of [
    [pub, publicOrigin, admin],
    [admin, adminOrigin, pub],
  ] as const) {
    const issued = await issue(app, origin);
    assert.equal(issued.statusCode, 200);
    const { nonce, message } = issued.json();
    const payload = {
      nonce,
      message,
      signature: await owner.signMessage(message),
    };
    // Correct Origin still cannot move a proof to the other listener.
    assert.equal(
      (
        await other.inject({
          method: 'POST',
          url: '/v1/auth/verify',
          headers: { origin, cookie: cookies(issued) },
          payload,
        })
      ).statusCode,
      401,
    );
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      headers: { origin, cookie: cookies(issued) },
      payload,
    });
    assert.equal(login.statusCode, 200, login.body);
    const cookie = cookies(login);
    assert.equal(
      (await app.inject({ url: '/v1/auth/me', headers: { cookie } }))
        .statusCode,
      200,
    );
    // No Origin header: the stored audience must still be enforced.
    for (const url of ['/v1/auth/me', '/v1/auth/validate?application=demo'])
      assert.equal(
        (await other.inject({ url, headers: { cookie } })).statusCode,
        403,
      );
    if (app === pub) {
      assert.equal(
        (
          await admin.inject({
            url: '/v1/auth/control/users',
            headers: { cookie },
          })
        ).statusCode,
        403,
      );
      for (const url of ['/v1/auth/control', '/v1/auth/control/users'])
        assert.equal(
          (await pub.inject({ url, headers: { cookie } })).statusCode,
          404,
        );
    } else {
      const directory = await admin.inject({
        url: '/v1/auth/control/users',
        headers: { cookie },
      });
      assert.equal(directory.statusCode, 200);
      const saved = await admin.inject({
        method: 'POST',
        url: '/v1/auth/control/users',
        headers: { cookie, origin, 'x-csrf-token': login.json().csrfToken },
        payload: {
          revision: directory.json().revision,
          create: true,
          id: 'reader',
          wallets: [],
          roles: ['reader'],
        },
      });
      assert.equal(saved.statusCode, 200, saved.body);
      assert.ok(
        state.auth.policy()?.policy.identities.some((i) => i.id === 'reader'),
      );
      assert.equal(
        state.auth.listSessions().filter((s) => s.revokedAt === null).length,
        0,
      );
    }
  }
  assert.equal((await issue(pub, adminOrigin)).statusCode, 403);
  assert.equal((await issue(admin, publicOrigin)).statusCode, 403);
});

test('admin surface requires a distinct configured HTTPS hostname', () => {
  assert.equal(loadConfig({}).surface, 'public');
  assert.throws(() => loadConfig({ GOZNE_SURFACE: 'combined' }));
  const application = {
    id: 'demo',
    origin: publicOrigin,
    evmChainIds: [1],
    solanaChains: [],
    requiredRoles: ['reader'],
  };
  for (const adminOrigin of [
    publicOrigin,
    `${publicOrigin}:8443`,
    'http://admin.example.test',
    'https://admin.example.test/path',
    'https://user@admin.example.test',
  ])
    assert.throws(() =>
      validatePolicy({
        version: 1,
        applications: [{ ...application, adminOrigin }],
        identities: [],
      }),
    );
  assert.throws(() =>
    validatePolicy({
      version: 1,
      applications: [
        { ...application, adminOrigin },
        { ...application, id: 'other', origin: adminOrigin },
      ],
      identities: [],
    }),
  );
});
