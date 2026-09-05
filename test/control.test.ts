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
import { backupDatabase, restoreDatabase } from '../src/storage/recovery.js';

const origin = 'https://control.example.test';
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'gozne-control-'));
  const path = join(directory, 'gozne.sqlite');
  const owner = Wallet.createRandom();
  const guest = Wallet.createRandom();
  const other = Wallet.createRandom();
  const solKey = ed25519.utils.randomSecretKey();
  const solAddress = base58.encode(ed25519.getPublicKey(solKey));
  const storage = openStorage(path);
  storage.auth.applyPolicy({
    version: 1,
    applications: [
      {
        id: 'demo',
        origin: 'https://public.example.test',
        adminOrigin: origin,
        evmChainIds: [1],
        solanaChains: ['solana:devnet'],
        requiredRoles: ['reader'],
      },
      {
        id: 'other',
        origin: 'https://public.example.test',
        adminOrigin: origin,
        evmChainIds: [1],
        solanaChains: [],
        requiredRoles: ['reader'],
      },
    ],
    identities: [
      {
        id: 'owner',
        wallets: [
          { network: 'evm', address: owner.address },
          { network: 'solana', address: solAddress },
        ],
        grants: { demo: ['reader', 'admin'], other: ['reader', 'admin'] },
      },
    ],
  });
  let now = Date.now();
  const app = buildApp(
    loadConfig({
      GOZNE_DATABASE: path,
      GOZNE_LOG_LEVEL: 'silent',
      GOZNE_SURFACE: 'admin',
    }),
    storage,
    () => now,
  );
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function login(wallet = owner, application = 'demo', solana = false) {
    const issue = await app.inject({
      method: 'POST',
      url: '/v1/auth/nonce',
      headers: { origin },
      payload: {
        application,
        network: solana ? 'solana' : 'evm',
        address: solana ? solAddress : wallet.address,
        chainId: solana ? 'solana:devnet' : '1',
      },
    });
    assert.equal(issue.statusCode, 200, issue.body);
    const proof = issue.json<{ nonce: string; message: string }>();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      headers: {
        origin,
        cookie: issue.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      },
      payload: {
        ...proof,
        expiresAt: undefined,
        signature: solana
          ? Buffer.from(
              ed25519.sign(new TextEncoder().encode(proof.message), solKey),
            ).toString('base64')
          : await wallet.signMessage(proof.message),
        signInInput: undefined,
      },
    });
    return {
      response,
      raw:
        response.cookies.find((c) => c.name === '__Host-gozne-session')
          ?.value ?? '',
      csrf: response.json<{ csrfToken?: string }>().csrfToken ?? '',
    };
  }
  type Browser = Awaited<ReturnType<typeof login>>;
  async function post(
    browser: Browser,
    path: string,
    body: unknown = {},
    headers = {},
  ) {
    return app.inject({
      method: 'POST',
      url: `/v1/auth/control/${path}`,
      headers: {
        origin,
        cookie: `__Host-gozne-session=${browser.raw}`,
        'x-csrf-token': browser.csrf,
        ...headers,
      },
      payload: body as Record<string, unknown>,
    });
  }
  async function invite(browser: Browser, minutes = 30) {
    const result = await post(browser, 'invitations', {
      network: 'evm',
      address: guest.address,
      minutes,
    });
    assert.equal(result.statusCode, 200, result.body);
    return result.json<{ id: string; expiresAt: number }>();
  }
  async function request(browser: Browser) {
    const result = await post(browser, 'actions', {
      project: 'website',
      version: 'v1.2.3',
      environment: 'staging',
    });
    assert.equal(result.statusCode, 200, result.body);
    return result.json<{ id: string; payloadHash: string }>();
  }
  async function approve(browser: Browser, id: string, solana = false) {
    const issue = await post(browser, `actions/${id}/challenge`, {
      chainId: solana ? 'solana:devnet' : '1',
    });
    assert.equal(issue.statusCode, 200, issue.body);
    const { nonce, message } = issue.json<{ nonce: string; message: string }>();
    const body = {
      nonce,
      message,
      signature: solana
        ? Buffer.from(
            ed25519.sign(new TextEncoder().encode(message), solKey),
          ).toString('base64')
        : await owner.signMessage(message),
    };
    const response = await post(browser, `actions/${id}/approve`, body);
    assert.equal(response.statusCode, 200, response.body);
    return body;
  }
  return {
    directory,
    path,
    storage,
    app,
    owner,
    guest,
    other,
    login,
    post,
    invite,
    request,
    approve,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

test('wallet-bound invitation, signed exact action and concurrent one-time execution', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  const invitation = await f.invite(owner);
  assert.equal((await f.login(f.other)).response.statusCode, 401);
  const guest = await f.login(f.guest);
  assert.equal(guest.response.statusCode, 200, guest.response.body);
  assert.equal(
    guest.response.json<{ expiresAt: number }>().expiresAt,
    invitation.expiresAt,
  );
  const action = await f.request(guest);
  assert.equal(
    (await f.post(guest, `actions/${action.id}/execute`)).statusCode,
    409,
  );
  const proof = await f.approve(owner, action.id);
  assert.match(proof.message, /website version v1.2.3 to staging/);
  assert.ok(proof.message.includes(action.payloadHash));
  assert.ok(proof.message.includes(action.id));
  assert.equal(
    (await f.post(owner, `actions/${action.id}/approve`, proof)).statusCode,
    409,
  );
  assert.equal(
    (await f.post(owner, `actions/${action.id}/execute`)).statusCode,
    403,
  );
  const results = await Promise.all([
    f.post(guest, `actions/${action.id}/execute`),
    f.post(guest, `actions/${action.id}/execute`),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  const overview = f.storage.control.overview(owner.raw, Date.now());
  assert.equal(overview.deployments.length, 1);
  assert.equal(overview.actions[0]?.status, 'executed');
});

test('guests cannot invite or approve; CSRF, foreign origins and cross-application IDs are rejected', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  await f.invite(owner);
  const guest = await f.login(f.guest);
  const action = await f.request(guest);
  assert.equal(
    (
      await f.post(guest, 'invitations', {
        network: 'evm',
        address: f.other.address,
        minutes: 30,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.post(guest, `actions/${action.id}/challenge`, { chainId: '1' }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await f.post(
        owner,
        `actions/${action.id}/cancel`,
        {},
        { 'x-csrf-token': 'bad' },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.post(
        owner,
        `actions/${action.id}/cancel`,
        {},
        { origin: 'https://evil.test' },
      )
    ).statusCode,
    403,
  );
  const otherApp = await f.login(f.owner, 'other');
  assert.equal(
    (await f.post(otherApp, `actions/${action.id}/challenge`, { chainId: '1' }))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await f.post(owner, 'invitations', {
        network: 'evm',
        address: f.owner.address,
        minutes: 30,
      })
    ).statusCode,
    409,
  );
});

test('revoking an invitation invalidates existing sessions and outstanding approvals immediately', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  const invitation = await f.invite(owner);
  const guest = await f.login(f.guest);
  const action = await f.request(guest);
  await f.approve(owner, action.id);
  assert.equal(
    (await f.post(owner, `invitations/${invitation.id}/revoke`)).statusCode,
    200,
  );
  assert.equal(
    (await f.post(guest, `actions/${action.id}/execute`)).statusCode,
    401,
  );
  assert.equal((await f.login(f.guest)).response.statusCode, 401);
});

test('invalid or substituted signatures consume their proof and never approve', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  const action = await f.request(owner);
  const issue = await f.post(owner, `actions/${action.id}/challenge`, {
    chainId: '1',
  });
  const { nonce, message } = issue.json<{ nonce: string; message: string }>();
  const altered = message.replace('staging', 'production');
  assert.equal(
    (
      await f.post(owner, `actions/${action.id}/approve`, {
        nonce,
        message: altered,
        signature: await f.owner.signMessage(altered),
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.post(owner, `actions/${action.id}/approve`, {
        nonce,
        message,
        signature: await f.owner.signMessage(message),
      })
    ).statusCode,
    409,
  );
  const another = await f.request(owner);
  const second = await f.post(owner, `actions/${another.id}/challenge`, {
    chainId: '1',
  });
  const proof = second.json<{ nonce: string; message: string }>();
  assert.equal(
    (
      await f.post(owner, `actions/${another.id}/approve`, {
        nonce: proof.nonce,
        message: proof.message,
        signature: await f.other.signMessage(proof.message),
      })
    ).statusCode,
    401,
  );
});

test('Solana administrator can approve the exact SIWS action', async (t) => {
  const f = fixture(t);
  const owner = await f.login(f.owner, 'demo', true);
  const action = await f.request(owner);
  await f.approve(owner, action.id, true);
  assert.equal(
    (await f.post(owner, `actions/${action.id}/execute`)).statusCode,
    200,
  );
});

test('expiry and approver logout invalidate approval, while policy changes cancel pending work', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  await f.invite(owner);
  const guest = await f.login(f.guest);
  const action = await f.request(guest);
  await f.approve(owner, action.id);
  f.advance(300_001);
  assert.equal(
    (await f.post(guest, `actions/${action.id}/execute`)).statusCode,
    409,
  );
  const next = await f.request(guest);
  await f.approve(owner, next.id);
  f.storage.auth.revoke(owner.response.json<{ id: string }>().id);
  assert.equal(
    (await f.post(guest, `actions/${next.id}/execute`)).statusCode,
    409,
  );
  const policy = structuredClone(f.storage.auth.policy()!.policy);
  policy.identities[0]!.grants.demo!.push('editor');
  f.storage.auth.applyPolicy(policy);
  const db = new DatabaseSync(f.path, { readOnly: true });
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM actions WHERE status = 'canceled'",
      )
      .get()?.count,
    2,
  );
  db.close();
  assert.equal((await f.login(f.guest)).response.statusCode, 401);
});

test('execution audit failure rolls back the effect and remains safely retryable', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  const action = await f.request(owner);
  await f.approve(owner, action.id);
  const db = new DatabaseSync(f.path);
  db.exec(
    "CREATE TRIGGER fail_action_audit BEFORE INSERT ON audit WHEN NEW.event = 'action.executed' BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
  );
  assert.equal(
    (await f.post(owner, `actions/${action.id}/execute`)).statusCode,
    503,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM demo_deployments').get()?.count,
    0,
  );
  assert.equal(
    db.prepare('SELECT status FROM actions WHERE id = ?').get(action.id)
      ?.status,
    'approved',
  );
  db.exec('DROP TRIGGER fail_action_audit');
  db.close();
  assert.equal(
    (await f.post(owner, `actions/${action.id}/execute`)).statusCode,
    200,
  );
});

test('restoring a pre-execution backup cannot resurrect an approval or invitation', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  await f.invite(owner);
  const guest = await f.login(f.guest);
  const action = await f.request(guest);
  await f.approve(owner, action.id);
  const backup = join(f.directory, 'backup.sqlite');
  const restored = join(f.directory, 'restored.sqlite');
  await backupDatabase(f.path, backup);
  assert.equal(
    (await f.post(guest, `actions/${action.id}/execute`)).statusCode,
    200,
  );
  await restoreDatabase(backup, restored);
  const state = openStorage(restored);
  assert.equal(state.auth.session(guest.raw, Date.now()), null);
  assert.equal(
    state.auth.access('demo', 'evm', f.guest.address, Date.now()),
    null,
  );
  state.close();
  const db = new DatabaseSync(restored, { readOnly: true });
  assert.equal(
    db.prepare('SELECT status FROM actions WHERE id = ?').get(action.id)
      ?.status,
    'canceled',
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM action_challenges').get()?.count,
    0,
  );
  db.close();
});

test('invitation expiry denies the old session and renewal never revives it', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  await f.invite(owner, 5);
  const guest = await f.login(f.guest);
  const identity = guest.response.json<{ identity: string }>().identity;
  f.advance(300_001);
  assert.equal(
    (
      await f.post(guest, 'actions', {
        project: 'site',
        version: 'v1',
        environment: 'preview',
      })
    ).statusCode,
    401,
  );
  await f.invite(owner, 5);
  const renewed = await f.login(f.guest);
  assert.equal(renewed.response.statusCode, 200);
  assert.notEqual(
    renewed.response.json<{ identity: string }>().identity,
    identity,
  );
  assert.equal(
    (
      await f.post(guest, 'actions', {
        project: 'site',
        version: 'v1',
        environment: 'preview',
      })
    ).statusCode,
    401,
  );
});

test('administrators revoke sessions within their application, with CSRF and atomic audit', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  await f.invite(owner);
  const guest = await f.login(f.guest);
  const guestId = guest.response.json<{ id: string }>().id;
  const ownerId = owner.response.json<{ id: string }>().id;
  const other = await f.login(f.owner, 'other');
  const otherId = other.response.json<{ id: string }>().id;
  assert.equal(
    (await f.post(guest, `sessions/${ownerId}/revoke`)).statusCode,
    403,
  );
  assert.equal(
    (
      await f.post(
        owner,
        `sessions/${guestId}/revoke`,
        {},
        { 'x-csrf-token': 'invalid' },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.post(owner, `sessions/${otherId}/revoke`)).statusCode,
    404,
  );
  assert.equal(
    (await f.post(owner, `sessions/${ownerId}/revoke`)).statusCode,
    409,
  );
  const db = new DatabaseSync(f.path);
  db.exec(
    "CREATE TRIGGER deny_session_audit BEFORE INSERT ON audit WHEN NEW.event = 'session.revoked-by-admin' BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
  );
  assert.equal(
    (await f.post(owner, `sessions/${guestId}/revoke`)).statusCode,
    503,
  );
  assert.ok(f.storage.auth.session(guest.raw, Date.now()));
  db.exec('DROP TRIGGER deny_session_audit');
  db.close();
  assert.equal(
    (await f.post(owner, `sessions/${guestId}/revoke`)).statusCode,
    200,
  );
  assert.equal(f.storage.auth.session(guest.raw, Date.now()), null);
  assert.ok(f.storage.auth.session(other.raw, Date.now()));
  assert.equal(
    (await f.post(owner, `sessions/${guestId}/revoke`)).statusCode,
    404,
  );
});

test('action controls distinguish two live sessions of the same identity', async (t) => {
  const f = fixture(t);
  const first = await f.login();
  const second = await f.login();
  const action = await f.request(first);
  await f.approve(second, action.id);
  const firstView = f.storage.control
    .overview(first.raw, Date.now())
    .actions.find((row) => row.id === action.id)!;
  const secondView = f.storage.control
    .overview(second.raw, Date.now())
    .actions.find((row) => row.id === action.id)!;
  assert.equal(firstView.permissions.execute, true);
  assert.equal(secondView.permissions.execute, false);
  assert.equal(secondView.permissions.cancel, true);
  const id = second.response.json<{ id: string }>().id;
  assert.equal((await f.post(first, `sessions/${id}/revoke`)).statusCode, 200);
  assert.equal(
    (await f.post(first, `actions/${action.id}/execute`)).statusCode,
    409,
  );
});

async function directory(
  f: ReturnType<typeof fixture>,
  owner: Awaited<ReturnType<ReturnType<typeof fixture>['login']>>,
) {
  const result = await f.app.inject({
    method: 'GET',
    url: '/v1/auth/control/users',
    headers: { origin, cookie: `__Host-gozne-session=${owner.raw}` },
  });
  assert.equal(result.statusCode, 200, result.body);
  return result.json<{
    revision: string;
    users: {
      id: string;
      wallets: {
        network: 'evm' | 'solana';
        address: string;
        enabled: boolean;
      }[];
      roles: string[];
      walletsEditable: boolean;
    }[];
  }>();
}

test('panel creates a permanent user and applies wallet/role edits with session invalidation', async (t) => {
  const f = fixture(t);
  let owner = await f.login();
  let view = await directory(f, owner);
  let result = await f.post(owner, 'users', {
    revision: view.revision,
    create: true,
    id: 'collaborator',
    wallets: [{ network: 'evm', address: f.guest.address, enabled: true }],
    roles: ['reader'],
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json(), {
    changed: true,
    reauthenticationRequired: true,
  });
  assert.equal(f.storage.auth.session(owner.raw, Date.now()), null);
  const guest = await f.login(f.guest);
  assert.equal(guest.response.statusCode, 200);
  assert.equal(
    (
      await f.post(guest, 'users', {
        revision: view.revision,
        create: true,
        id: 'unauthorized',
        wallets: [],
        roles: ['admin', 'reader'],
      })
    ).statusCode,
    403,
  );
  owner = await f.login();
  view = await directory(f, owner);
  result = await f.post(owner, 'users', {
    revision: view.revision,
    create: false,
    id: 'collaborator',
    wallets: [{ network: 'evm', address: f.guest.address, enabled: false }],
    roles: ['reader'],
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal((await f.login(f.guest)).response.statusCode, 401);
  owner = await f.login();
  view = await directory(f, owner);
  result = await f.post(owner, 'users', {
    revision: view.revision,
    create: false,
    id: 'collaborator',
    wallets: [{ network: 'evm', address: f.other.address, enabled: true }],
    roles: ['reader', 'admin'],
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal((await f.login(f.other)).response.statusCode, 200);
  owner = await f.login();
  view = await directory(f, owner);
  result = await f.post(owner, 'users', {
    revision: view.revision,
    create: false,
    id: 'collaborator',
    wallets: [{ network: 'evm', address: f.other.address, enabled: true }],
    roles: [],
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal((await f.login(f.other)).response.statusCode, 401);
});

test('panel rejects stale, duplicate, cross-application and self-lockout edits', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  const view = await directory(f, owner);
  const self = view.users.find((user) => user.id === 'owner')!;
  assert.equal(self.walletsEditable, false);
  const base = {
    revision: view.revision,
    create: false,
    id: 'owner',
    wallets: self.wallets,
    roles: self.roles,
  };
  assert.equal(
    (await f.post(owner, 'users', { ...base, revision: '0'.repeat(64) }))
      .statusCode,
    409,
  );
  assert.equal(
    (await f.post(owner, 'users', { ...base, roles: ['reader'] })).statusCode,
    409,
  );
  assert.equal(
    (await f.post(owner, 'users', { ...base, wallets: [] })).statusCode,
    409,
  );
  assert.equal(
    (await f.post(owner, 'users', { ...base, id: 'missing' })).statusCode,
    409,
  );
  assert.equal(
    (await f.post(owner, 'users', { ...base, create: true, id: 'duplicate' }))
      .statusCode,
    400,
  );
  assert.equal(
    (await f.post(owner, 'users', { ...base, grants: { other: ['admin'] } }))
      .statusCode,
    400,
  );
  assert.equal(
    (await f.post(owner, 'users', base, { origin: 'https://evil.test' }))
      .statusCode,
    403,
  );
  assert.equal(
    (await f.post(owner, 'users', base, { 'x-csrf-token': 'bad' })).statusCode,
    403,
  );
  const unchanged = await f.post(owner, 'users', base);
  assert.equal(unchanged.statusCode, 200, unchanged.body);
  assert.equal(unchanged.json<{ changed: boolean }>().changed, false);
  assert.ok(f.storage.auth.session(owner.raw, Date.now()));
  assert.equal(f.storage.auth.policy()!.digest, view.revision);
});

test('policy writes from the panel roll back on audit failure and recheck a revoked operator', async (t) => {
  const f = fixture(t);
  const owner = await f.login();
  const view = await directory(f, owner);
  const input = {
    revision: view.revision,
    create: true,
    id: 'collaborator',
    wallets: [],
    roles: ['reader'],
  };
  const db = new DatabaseSync(f.path);
  db.exec(
    "CREATE TRIGGER fail_panel_policy BEFORE INSERT ON audit WHEN NEW.event = 'policy.applied' BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
  );
  assert.equal((await f.post(owner, 'users', input)).statusCode, 503);
  assert.equal(f.storage.auth.policy()!.digest, view.revision);
  assert.ok(f.storage.auth.session(owner.raw, Date.now()));
  db.exec('DROP TRIGGER fail_panel_policy');
  db.close();
  f.storage.auth.revoke(owner.response.json<{ id: string }>().id);
  assert.throws(
    () =>
      f.storage.auth.applyPolicy(
        f.storage.auth.policy()!.policy,
        view.revision,
        { token: owner.raw, now: Date.now() },
      ),
    /administrator/,
  );
});

test('unrelated application identities stay hidden and an unshared operator wallet cannot be removed', async (t) => {
  const f = fixture(t);
  const policy = structuredClone(f.storage.auth.policy()!.policy);
  delete policy.identities[0]!.grants.other;
  policy.identities.push({
    id: 'private-other-user',
    wallets: [{ network: 'evm', address: f.other.address, enabled: true }],
    grants: { other: ['reader'] },
  });
  f.storage.auth.applyPolicy(policy);
  const owner = await f.login();
  const view = await directory(f, owner);
  assert.equal(
    view.users.some((user) => user.id === 'private-other-user'),
    false,
  );
  const input = {
    revision: view.revision,
    create: false,
    id: 'private-other-user',
    wallets: [],
    roles: ['reader', 'admin'],
  };
  assert.equal((await f.post(owner, 'users', input)).statusCode, 409);
  assert.equal(
    (await f.post(owner, 'users', { ...input, create: true })).statusCode,
    409,
  );
  const self = view.users.find((user) => user.id === 'owner')!;
  assert.equal(self.walletsEditable, true);
  const denied = await f.post(owner, 'users', {
    ...input,
    id: 'owner',
    wallets: self.wallets.filter((wallet) => wallet.network !== 'evm'),
  });
  assert.equal(denied.statusCode, 409);
  assert.equal(
    denied.json<{ error: { code: string } }>().error.code,
    'SELF_LOCKOUT',
  );
  assert.equal(f.storage.auth.policy()!.digest, view.revision);
});
