import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Wallet } from 'ethers';
import { buildApp } from '../src/api/app.js';
import { decide } from '../src/authorization/decision.js';
import { loadConfig } from '../src/config.js';
import { validatePolicy } from '../src/policy/policy.js';
import { digest } from '../src/auth/store.js';
import { openStorage } from '../src/storage/database.js';

const applicationToken = 'application-service-token.'.repeat(2);

function policy(address: string) {
  return validatePolicy({
    version: 1,
    applications: [
      {
        id: 'docs',
        origin: 'https://docs.example.test',
        adminOrigin: 'https://admin.example.test',
        evmChainIds: [1],
        solanaChains: [],
        requiredRoles: ['reader'],
        authorization: {
          permissions: ['documents.read', 'documents.edit', 'workflow.approve'],
          roles: {
            reader: ['documents.read'],
            editor: ['documents.read', 'documents.edit'],
            approver: ['workflow.approve'],
            admin: ['*'],
          },
          resources: [
            { type: 'project', id: 'alpha' },
            { type: 'document', id: '42', parent: 'project:alpha' },
            { type: 'project', id: 'beta' },
            { type: 'workflow', id: 'invoices' },
          ],
        },
      },
    ],
    identities: [
      {
        id: 'alice',
        wallets: [{ network: 'evm', address }],
        grants: { docs: ['reader'] },
        resourceGrants: {
          docs: [
            { role: 'editor', resource: 'project:alpha' },
            {
              role: 'approver',
              resource: 'workflow:invoices',
              expiresAt: 2_000,
            },
          ],
        },
      },
    ],
  });
}

test('roles and resource relationships produce deny-by-default decisions', () => {
  const current = policy(Wallet.createRandom().address);
  assert.deepEqual(
    decide(
      current,
      'docs',
      'alice',
      {
        permission: 'documents.read',
        resource: 'project:beta',
      },
      1_000,
    ),
    { allowed: true, reason: 'application-role:reader' },
  );
  assert.deepEqual(
    decide(
      current,
      'docs',
      'alice',
      {
        permission: 'documents.edit',
        resource: 'document:42',
      },
      1_000,
    ),
    { allowed: true, reason: 'resource-role:editor@project:alpha' },
  );
  assert.equal(
    decide(
      current,
      'docs',
      'alice',
      {
        permission: 'documents.edit',
        resource: 'project:beta',
      },
      1_000,
    ).allowed,
    false,
  );
  assert.equal(
    decide(
      current,
      'docs',
      'alice',
      {
        permission: 'workflow.approve',
        resource: 'workflow:invoices',
      },
      2_000,
    ).allowed,
    false,
  );
  assert.deepEqual(
    decide(
      current,
      'docs',
      'guest-invitation',
      { permission: 'documents.read', resource: 'project:beta' },
      1_000,
      ['reader'],
    ),
    { allowed: true, reason: 'application-role:reader' },
  );
});

test('policy rejects missing resource parents and unknown scoped roles', () => {
  const current = policy(Wallet.createRandom().address);
  const missingParent = structuredClone(current);
  missingParent.applications[0]!.authorization!.resources[1]!.parent =
    'project:missing';
  assert.throws(() => validatePolicy(missingParent));
  const unknownRole = structuredClone(current);
  unknownRole.identities[0]!.resourceGrants!.docs![0]!.role = 'owner';
  assert.throws(() => validatePolicy(unknownRole));
});

test('private decision API authenticates the application and resolves a live session', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'gozne-authorization-'));
  const path = join(directory, 'gozne.sqlite');
  const wallet = Wallet.createRandom();
  const storage = openStorage(path);
  storage.auth.applyPolicy(policy(wallet.address));
  const now = 1_000;
  const rawToken = 's'.repeat(43);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const db = new DatabaseSync(path);
  db.prepare(
    'INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
  ).run(
    digest(rawToken),
    sessionId,
    'alice',
    'docs',
    'evm',
    wallet.address,
    'https://docs.example.test',
    now,
    now + 60_000,
  );
  db.close();
  const config = loadConfig({
    GOZNE_DATABASE: path,
    GOZNE_LOG_LEVEL: 'silent',
    GOZNE_AUTHORIZATION_TOKENS: JSON.stringify({ docs: applicationToken }),
  });
  const app = buildApp(config, storage, () => now);
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const call = (token: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: '/v1/internal/authorize',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  assert.equal(
    (
      await call('wrong'.repeat(10), {
        sessionId,
        permission: 'documents.edit',
        resource: 'document:42',
      })
    ).statusCode,
    401,
  );
  const allowed = await call(applicationToken, {
    sessionId,
    permission: 'documents.edit',
    resource: 'document:42',
  });
  assert.equal(allowed.statusCode, 200, allowed.body);
  assert.equal(allowed.json().allowed, true);
  assert.match(allowed.json().decisionId, /^[0-9a-f-]{36}$/);
  const denied = await call(applicationToken, {
    sessionId,
    permission: 'documents.edit',
    resource: 'project:beta',
  });
  assert.equal(denied.statusCode, 200, denied.body);
  assert.deepEqual(
    {
      allowed: denied.json().allowed,
      reason: denied.json().reason,
    },
    { allowed: false, reason: 'no-matching-grant' },
  );
});
