import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { validatePolicy } from '../policy/policy.js';
import type { Identity } from '../policy/policy.js';
import { AuthError } from '../auth/errors.js';
import { AuthStore, digest } from '../auth/store.js';
import {
  canonicalAddress,
  createMessage,
  signInInput,
} from '../wallets/proofs.js';
import type { ChallengeFields, Network } from '../wallets/proofs.js';

export interface DeploymentPayload {
  project: string;
  version: string;
  environment: 'preview' | 'staging' | 'production';
}
interface Action {
  id: string;
  application: string;
  requester: string;
  requester_token_hash: string;
  payload: string;
  payload_hash: string;
  created_at: number;
  expires_at: number;
  status: 'pending' | 'approved' | 'executed' | 'canceled';
  approver_token_hash: string | null;
  approved_by: string | null;
  approved_at: number | null;
  approval_expires_at: number | null;
  executed_at: number | null;
}
const deny = (code = 'ACTION_UNAVAILABLE') =>
  new AuthError(409, code, 'This operation is no longer available');

export class ControlStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly auth: AuthStore,
  ) {}
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private actor(raw: string, now: number, admin = false) {
    const session = this.auth.session(raw, now);
    if (!session)
      throw new AuthError(
        401,
        'SESSION_INVALID',
        'A valid session is required',
      );
    if (admin && !session.roles.includes('admin'))
      throw new AuthError(
        403,
        'ADMIN_REQUIRED',
        'An administrator session is required',
      );
    return session;
  }
  private audit(event: string, identity: string, session: string, now: number) {
    this.db
      .prepare(
        'INSERT INTO audit(at,event,identity,session_id) VALUES (?,?,?,?)',
      )
      .run(now, event, identity, session);
    this.db
      .prepare(
        'DELETE FROM audit WHERE at < ? OR sequence <= (SELECT MAX(sequence) - 50000 FROM audit)',
      )
      .run(now - 30 * 86400_000);
  }
  private action(id: string, application: string): Action {
    const row = this.db
      .prepare('SELECT * FROM actions WHERE id = ? AND application = ?')
      .get(id, application);
    if (!row) throw new AuthError(404, 'ACTION_NOT_FOUND', 'Action not found');
    return row as unknown as Action;
  }
  private requester(action: Action, now: number) {
    const requester = this.auth.sessionByHash(action.requester_token_hash, now);
    if (
      !requester ||
      requester.application !== action.application ||
      requester.identity !== action.requester ||
      action.expires_at <= now
    )
      throw deny();
  }
  private publicAction(action: Action, now: number) {
    let available =
      action.expires_at > now &&
      !!this.auth.sessionByHash(action.requester_token_hash, now);
    if (action.status === 'approved')
      available =
        available &&
        (action.approval_expires_at ?? 0) > now &&
        !!this.auth
          .sessionByHash(action.approver_token_hash ?? '', now)
          ?.roles.includes('admin');
    return {
      id: action.id,
      application: action.application,
      requester: action.requester,
      payload: JSON.parse(action.payload) as DeploymentPayload,
      payloadHash: action.payload_hash,
      createdAt: action.created_at,
      expiresAt: action.expires_at,
      status:
        (action.status === 'pending' || action.status === 'approved') &&
        !available
          ? 'expired'
          : action.status,
      approvedBy: action.approved_by,
      approvedAt: action.approved_at,
      approvalExpiresAt: action.approval_expires_at,
      executedAt: action.executed_at,
    };
  }
  overview(raw: string, now: number) {
    const actor = this.actor(raw, now);
    const admin = actor.roles.includes('admin');
    const rows = this.db
      .prepare(
        `SELECT * FROM actions WHERE application = ? ${admin ? '' : 'AND requester_token_hash = ?'} ORDER BY created_at DESC LIMIT 100`,
      )
      .all(...(admin ? [actor.application] : [actor.application, digest(raw)]));
    return {
      actions: rows.map((row) => {
        const action = row as unknown as Action;
        const result = this.publicAction(action, now);
        const own = action.requester_token_hash === digest(raw);
        return {
          ...result,
          permissions: {
            approve: admin && result.status === 'pending',
            execute: own && result.status === 'approved',
            cancel:
              (own || admin) && ['pending', 'approved'].includes(result.status),
          },
        };
      }),
      invitations: admin
        ? this.db
            .prepare(
              'SELECT id, network, address, created_by AS createdBy, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt, accepted_at AS acceptedAt FROM invitations WHERE application = ? ORDER BY created_at DESC LIMIT 100',
            )
            .all(actor.application)
        : [],
      sessions: admin
        ? this.db
            .prepare(
              'SELECT id, identity, network, address, created_at AS createdAt, expires_at AS expiresAt FROM sessions WHERE application = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 100',
            )
            .all(actor.application, now)
            .filter((row) => {
              const session = this.db
                .prepare('SELECT token_hash FROM sessions WHERE id = ?')
                .get(String(row.id));
              return (
                !!session &&
                !!this.auth.sessionByHash(String(session.token_hash), now)
              );
            })
        : [],
      deployments: this.db
        .prepare(
          'SELECT action_id AS actionId, project, version, environment, executed_at AS executedAt FROM demo_deployments WHERE application = ? ORDER BY executed_at DESC LIMIT 20',
        )
        .all(actor.application),
    };
  }
  directory(raw: string, now: number) {
    const actor = this.actor(raw, now, true);
    const current = this.auth.policy()!;
    const app = current.policy.applications.find(
      (app) => app.id === actor.application,
    )!;
    return {
      revision: current.digest,
      application: actor.application,
      requiredRoles: app.requiredRoles,
      users: current.policy.identities
        .filter((identity) => Object.hasOwn(identity.grants, actor.application))
        .map((identity) => ({
          id: identity.id,
          wallets: identity.wallets,
          roles: identity.grants[actor.application]!,
          walletsEditable: !Object.keys(identity.grants).some(
            (app) => app !== actor.application,
          ),
        })),
    };
  }

  saveUser(
    raw: string,
    input: {
      revision: string;
      create: boolean;
      id: string;
      wallets: Identity['wallets'];
      roles: string[];
    },
    now: number,
  ) {
    const actor = this.actor(raw, now, true);
    const current = this.auth.policy()!;
    if (current.digest !== input.revision)
      throw new AuthError(
        409,
        'POLICY_CONFLICT',
        'Policy changed. Reload users before saving',
      );
    const policy = structuredClone(current.policy);
    let identity = policy.identities.find(
      (identity) => identity.id === input.id,
    );
    if (
      input.create
        ? !!identity
        : !identity || !Object.hasOwn(identity.grants, actor.application)
    )
      throw new AuthError(
        409,
        'USER_CONFLICT',
        'This user cannot be created or edited here',
      );
    if (!identity) {
      identity = { id: input.id, wallets: [], grants: {} };
      policy.identities.push(identity);
    }
    let wallets: Identity['wallets'];
    try {
      wallets = input.wallets.map((wallet) => ({
        network: wallet.network,
        address: canonicalAddress(wallet.network, wallet.address),
        enabled: wallet.enabled,
      }));
    } catch {
      throw new AuthError(400, 'ADDRESS_INVALID', 'Invalid wallet address');
    }
    if (
      Object.keys(identity.grants).some((app) => app !== actor.application) &&
      JSON.stringify(identity.wallets) !== JSON.stringify(wallets)
    )
      throw new AuthError(
        409,
        'SHARED_IDENTITY',
        'Wallets shared with another application must be managed through the operator CLI',
      );
    identity.wallets = wallets;
    identity.grants[actor.application] = input.roles;
    if (
      actor.identity === identity.id &&
      (!input.roles.includes('admin') ||
        !wallets.some(
          (wallet) =>
            wallet.enabled &&
            wallet.network === actor.network &&
            wallet.address === actor.address,
        ))
    )
      throw new AuthError(
        409,
        'SELF_LOCKOUT',
        'Keep your current administrator wallet and role enabled',
      );
    const app = policy.applications.find(
      (app) => app.id === actor.application,
    )!;
    if (
      input.roles.length &&
      !app.requiredRoles.every((role) => input.roles.includes(role))
    )
      throw new AuthError(
        400,
        'REQUIRED_ROLES',
        'Include all application-required roles, or clear all roles to revoke access',
      );
    let validated;
    try {
      validated = validatePolicy(policy);
    } catch {
      throw new AuthError(
        400,
        'USER_INVALID',
        'Invalid roles, duplicate wallet or policy limit exceeded',
      );
    }
    const result = this.auth.applyPolicy(validated, input.revision, {
      token: raw,
      now,
    });
    return { ...result, reauthenticationRequired: result.changed };
  }

  revokeSession(raw: string, id: string, now: number) {
    return this.transaction(() => {
      const actor = this.actor(raw, now, true);
      if (id === actor.id)
        throw new AuthError(
          409,
          'USE_LOGOUT',
          'Use sign out to close your current session',
        );
      const target = this.db
        .prepare(
          'SELECT token_hash, identity FROM sessions WHERE id = ? AND application = ?',
        )
        .get(id, actor.application);
      if (!target || !this.auth.sessionByHash(String(target.token_hash), now))
        throw new AuthError(
          404,
          'SESSION_NOT_FOUND',
          'Active session not found',
        );
      this.db
        .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')
        .run(now, id);
      this.audit('session.revoked-by-admin', actor.identity, actor.id, now);
      return { ok: true };
    });
  }

  invite(
    raw: string,
    network: Network,
    value: string,
    minutes: number,
    now: number,
  ) {
    return this.transaction(() => {
      const actor = this.actor(raw, now, true);
      let address: string;
      try {
        address = canonicalAddress(network, value);
      } catch {
        throw new AuthError(400, 'ADDRESS_INVALID', 'Invalid wallet address');
      }
      const policy = this.auth.policy()!.policy;
      const app = policy.applications.find(
        (app) => app.id === actor.application,
      )!;
      if (
        !app.requiredRoles.every((role) => role === 'reader') ||
        !actor.roles.includes('reader')
      )
        throw new AuthError(
          403,
          'INVITATION_ROLE_DENIED',
          'Invitations grant reader access only',
        );
      if (
        policy.identities.some((identity) =>
          identity.wallets.some(
            (wallet) =>
              wallet.network === network && wallet.address === address,
          ),
        )
      )
        throw new AuthError(
          409,
          'WALLET_CONFIGURED',
          'Manage this wallet through the access policy',
        );
      this.db
        .prepare(
          'UPDATE invitations SET revoked_at = ? WHERE expires_at <= ? AND revoked_at IS NULL',
        )
        .run(now, now);
      if (
        Number(
          this.db
            .prepare(
              'SELECT COUNT(*) AS count FROM invitations WHERE revoked_at IS NULL',
            )
            .get()?.count,
        ) >= 1000
      )
        throw new AuthError(
          429,
          'INVITATION_LIMIT',
          'Too many active invitations',
        );
      if (
        this.db
          .prepare(
            'SELECT id FROM invitations WHERE application = ? AND network = ? AND address = ? AND revoked_at IS NULL',
          )
          .get(actor.application, network, address)
      )
        throw new AuthError(
          409,
          'INVITATION_EXISTS',
          'An active invitation already exists for this wallet',
        );
      const id = randomUUID();
      const expiresAt = now + minutes * 60_000;
      this.db
        .prepare(
          'INSERT INTO invitations VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)',
        )
        .run(
          id,
          actor.application,
          network,
          address,
          actor.identity,
          now,
          expiresAt,
        );
      this.audit('invitation.created', actor.identity, actor.id, now);
      return {
        id,
        network,
        address,
        expiresAt,
        roles: ['reader'],
        url: actor.origin + '/',
      };
    });
  }
  revokeInvitation(raw: string, id: string, now: number) {
    return this.transaction(() => {
      const actor = this.actor(raw, now, true);
      const result = this.db
        .prepare(
          'UPDATE invitations SET revoked_at = ? WHERE id = ? AND application = ? AND revoked_at IS NULL',
        )
        .run(now, id, actor.application);
      if (!result.changes)
        throw new AuthError(
          404,
          'INVITATION_NOT_FOUND',
          'Active invitation not found',
        );
      this.audit('invitation.revoked', actor.identity, actor.id, now);
      return { ok: true };
    });
  }
  request(raw: string, input: DeploymentPayload, now: number) {
    return this.transaction(() => {
      const actor = this.actor(raw, now);
      const count = Number(
        this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM actions WHERE requester = ? AND application = ? AND status IN ('pending','approved') AND expires_at > ?",
          )
          .get(actor.identity, actor.application, now)?.count,
      );
      const total = Number(
        this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM actions WHERE status IN ('pending','approved') AND expires_at > ?",
          )
          .get(now)?.count,
      );
      if (count >= 20 || total >= 1000)
        throw new AuthError(429, 'ACTION_LIMIT', 'Too many pending actions');
      const payload = JSON.stringify({
        project: input.project,
        version: input.version,
        environment: input.environment,
      });
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO actions(id, application, requester, requester_token_hash, payload, payload_hash, created_at, expires_at, status) VALUES (?,?,?,?,?,?,?,?,'pending')",
        )
        .run(
          id,
          actor.application,
          actor.identity,
          digest(raw),
          payload,
          digest(payload),
          now,
          Math.min(now + 1800_000, actor.expiresAt),
        );
      this.audit('action.requested', actor.identity, actor.id, now);
      return this.publicAction(this.action(id, actor.application), now);
    });
  }
  challenge(raw: string, id: string, chain: string, now: number) {
    return this.transaction(() => {
      const actor = this.actor(raw, now, true);
      const action = this.action(id, actor.application);
      this.requester(action, now);
      if (action.status !== 'pending') throw deny();
      const app = this.auth
        .policy()!
        .policy.applications.find((app) => app.id === actor.application)!;
      const allowed =
        actor.network === 'evm'
          ? app.evmChainIds.map(String)
          : app.solanaChains;
      if (!allowed.includes(chain))
        throw new AuthError(400, 'CHAIN_DENIED', 'Chain is not available');
      this.db
        .prepare(
          'DELETE FROM action_challenges WHERE session_id = ? AND action_id = ?',
        )
        .run(actor.id, id);
      // Retain at most one challenge per administrator and action; expire all others.
      this.db
        .prepare(
          "DELETE FROM action_challenges WHERE json_extract(fields, '$.expiresAt') <= ?",
        )
        .run(now);
      if (
        Number(
          this.db
            .prepare('SELECT COUNT(*) AS count FROM action_challenges')
            .get()?.count,
        ) >= 1000
      )
        throw new AuthError(
          429,
          'CHALLENGE_LIMIT',
          'Too many pending challenges',
        );
      const payload = JSON.parse(action.payload) as DeploymentPayload;
      const fields: ChallengeFields = {
        nonce: randomBytes(16).toString('hex'),
        application: actor.application,
        network: actor.network,
        address: actor.address,
        origin: actor.origin,
        chain,
        issuedAt: now,
        expiresAt: Math.min(now + 300_000, action.expires_at, actor.expiresAt),
        statement: `Approve simulated deployment: ${payload.project} version ${payload.version} to ${payload.environment}. No infrastructure or funds will be changed.`,
        resources: [
          `urn:gozne:action:${action.id}`,
          `urn:gozne:sha256:${action.payload_hash}`,
        ],
      };
      this.db
        .prepare('INSERT INTO action_challenges VALUES (?, ?, ?, ?, NULL)')
        .run(fields.nonce, id, actor.id, JSON.stringify(fields));
      return {
        nonce: fields.nonce,
        message: createMessage(fields),
        expiresAt: fields.expiresAt,
        ...(actor.network === 'solana'
          ? { signInInput: signInInput(fields) }
          : {}),
      };
    });
  }
  proof(raw: string, id: string, nonce: string, now: number): ChallengeFields {
    const actor = this.actor(raw, now, true);
    const action = this.action(id, actor.application);
    this.requester(action, now);
    const row = this.db
      .prepare(
        'SELECT fields FROM action_challenges WHERE nonce = ? AND action_id = ? AND session_id = ? AND consumed_at IS NULL',
      )
      .get(nonce, id, actor.id);
    if (!row || action.status !== 'pending') throw deny();
    const fields = JSON.parse(String(row.fields)) as ChallengeFields;
    if (
      fields.expiresAt <= now ||
      fields.issuedAt > now ||
      fields.address !== actor.address ||
      fields.network !== actor.network ||
      fields.origin !== actor.origin
    )
      throw deny();
    return fields;
  }
  approve(
    raw: string,
    id: string,
    nonce: string,
    verified: boolean,
    now: number,
  ) {
    return this.transaction(() => {
      const fields = this.proof(raw, id, nonce, now);
      const actor = this.actor(raw, now, true);
      this.db
        .prepare('UPDATE action_challenges SET consumed_at = ? WHERE nonce = ?')
        .run(now, nonce);
      if (!verified) {
        this.audit('action.proof-denied', actor.identity, actor.id, now);
        return null;
      }
      this.db
        .prepare(
          "UPDATE actions SET status = 'approved', approver_token_hash = ?, approved_by = ?, approved_at = ?, approval_expires_at = ? WHERE id = ?",
        )
        .run(digest(raw), actor.identity, now, fields.expiresAt, id);
      this.audit('action.approved', actor.identity, actor.id, now);
      return this.publicAction(this.action(id, actor.application), now);
    });
  }
  execute(raw: string, id: string, now: number) {
    return this.transaction(() => {
      const actor = this.actor(raw, now);
      const action = this.action(id, actor.application);
      this.requester(action, now);
      if (action.requester_token_hash !== digest(raw))
        throw new AuthError(
          403,
          'REQUESTER_REQUIRED',
          'Only the requesting session can execute this action',
        );
      const approver = this.auth.sessionByHash(
        action.approver_token_hash ?? '',
        now,
      );
      if (
        action.status !== 'approved' ||
        (action.approval_expires_at ?? 0) <= now ||
        !approver?.roles.includes('admin') ||
        approver.application !== actor.application
      )
        throw deny();
      const payload = JSON.parse(action.payload) as DeploymentPayload;
      // The simulated effect and consumption share one SQLite commit. No external deployment runs here.
      this.db
        .prepare('INSERT INTO demo_deployments VALUES (?,?,?,?,?,?)')
        .run(
          id,
          actor.application,
          payload.project,
          payload.version,
          payload.environment,
          now,
        );
      this.db
        .prepare(
          "UPDATE actions SET status = 'executed', executed_at = ? WHERE id = ?",
        )
        .run(now, id);
      this.audit('action.executed', actor.identity, actor.id, now);
      return {
        action: this.publicAction(this.action(id, actor.application), now),
        receipt: { actionId: id, ...payload, executedAt: now, simulated: true },
      };
    });
  }
  cancel(raw: string, id: string, now: number) {
    return this.transaction(() => {
      const actor = this.actor(raw, now);
      const action = this.action(id, actor.application);
      if (
        !actor.roles.includes('admin') &&
        action.requester_token_hash !== digest(raw)
      )
        throw new AuthError(
          403,
          'REQUESTER_REQUIRED',
          'Only the requester or an administrator can cancel',
        );
      if (action.status !== 'pending' && action.status !== 'approved')
        throw deny();
      this.db
        .prepare("UPDATE actions SET status = 'canceled' WHERE id = ?")
        .run(id);
      this.audit('action.canceled', actor.identity, actor.id, now);
      return { ok: true };
    });
  }
}
