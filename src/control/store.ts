import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { validatePolicy } from '../policy/policy.js';
import type {
  Identity,
  Application,
  AuthorizationModel,
  ResourceGrant,
} from '../policy/policy.js';
import { decide } from '../authorization/decision.js';
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
  required_approvals: number;
  delivery_mode: 'simulation' | 'webhook';
}
interface Approval {
  approver_identity: string;
  approver_token_hash: string;
  approved_at: number;
  expires_at: number;
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
  private audit(
    event: string,
    identity: string,
    session: string,
    application: string,
    now: number,
  ) {
    this.db
      .prepare(
        'INSERT INTO audit(at,event,identity,session_id,application) VALUES (?,?,?,?,?)',
      )
      .run(now, event, identity, session, application);
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
  private approvals(action: Action, now: number) {
    return (
      this.db
        .prepare(
          `SELECT approver_identity, approver_token_hash, approved_at, expires_at
           FROM action_approvals WHERE action_id = ? ORDER BY approved_at`,
        )
        .all(action.id) as unknown as Approval[]
    ).map((approval) => {
      const session = this.auth.sessionByHash(
        approval.approver_token_hash,
        now,
      );
      return {
        identity: approval.approver_identity,
        approvedAt: approval.approved_at,
        expiresAt: approval.expires_at,
        valid:
          approval.expires_at > now &&
          session?.application === action.application &&
          session.identity === approval.approver_identity &&
          session.roles.includes('admin'),
      };
    });
  }
  private publicAction(action: Action, now: number) {
    const approvals = this.approvals(action, now);
    const approvalCount = approvals.filter((approval) => approval.valid).length;
    let available =
      action.expires_at > now &&
      !!this.auth.sessionByHash(action.requester_token_hash, now);
    if (action.status === 'approved')
      available = available && approvalCount >= action.required_approvals;
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
      approvals,
      approvalCount,
      requiredApprovals: action.required_approvals,
      deliveryMode: action.delivery_mode,
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
            approve:
              admin &&
              result.status === 'pending' &&
              !result.approvals.some(
                (approval) =>
                  approval.identity === actor.identity && approval.valid,
              ),
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
          'SELECT action_id AS actionId, project, version, environment, executed_at AS executedAt, delivery_mode AS deliveryMode, delivery_status AS deliveryStatus, response_digest AS responseDigest FROM demo_deployments WHERE application = ? ORDER BY executed_at DESC LIMIT 20',
        )
        .all(actor.application),
    };
  }

  auditTrail(
    raw: string,
    input: { before?: number; limit?: number; event?: string },
    now: number,
  ) {
    const actor = this.actor(raw, now, true);
    const limit = input.limit ?? 50;
    const conditions = ['application = ?'];
    const values: Array<string | number> = [actor.application];
    if (input.before !== undefined) {
      conditions.push('sequence < ?');
      values.push(input.before);
    }
    if (input.event !== undefined) {
      conditions.push('event = ?');
      values.push(input.event);
    }
    values.push(limit + 1);
    const rows = this.db
      .prepare(
        `SELECT sequence, at, event, identity, session_id AS sessionId
         FROM audit
         WHERE ${conditions.join(' AND ')}
         ORDER BY sequence DESC
         LIMIT ?`,
      )
      .all(...values) as Array<{
      sequence: number;
      at: number;
      event: string;
      identity: string | null;
      sessionId: string | null;
    }>;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    return {
      application: actor.application,
      events: rows,
      nextBefore: hasMore ? rows.at(-1)?.sequence : null,
    };
  }

  applications(raw: string, now: number) {
    const actor = this.actor(raw, now);
    const current = this.auth.policy()!;
    const canManage =
      actor.roles.includes('admin') &&
      !!current.policy.applicationManagers?.includes(actor.identity);
    return {
      revision: current.digest,
      canManage,
      currentApplication: actor.application,
      applications: current.policy.applications.filter(
        (app) =>
          canManage ||
          this.auth.access(app.id, actor.network, actor.address, now)
            ?.identity === actor.identity,
      ),
    };
  }

  saveApplication(
    raw: string,
    input: { revision: string; create: boolean; application: Application },
    now: number,
  ) {
    const actor = this.actor(raw, now, true);
    const current = this.auth.policy()!;
    if (!current.policy.applicationManagers?.includes(actor.identity))
      throw new AuthError(
        403,
        'APPLICATION_MANAGER_REQUIRED',
        'Only an application manager can edit application definitions',
      );
    if (input.revision !== current.digest)
      throw new AuthError(
        409,
        'POLICY_CONFLICT',
        'Reload applications before saving',
      );
    const policy = structuredClone(current.policy);
    const index = policy.applications.findIndex(
      (app) => app.id === input.application.id,
    );
    if (input.create ? index !== -1 : index === -1)
      throw new AuthError(
        409,
        'APPLICATION_CONFLICT',
        'Application already exists or is unavailable',
      );
    if (!input.application.adminOrigin)
      throw new AuthError(
        400,
        'ADMIN_ORIGIN_REQUIRED',
        'Configure the private workspace origin',
      );
    if (
      input.application.id === actor.application &&
      input.application.adminOrigin !== actor.origin
    )
      throw new AuthError(
        409,
        'SELF_LOCKOUT',
        'Change your active administration origin through the operator CLI',
      );
    if (input.create) {
      policy.applications.push(input.application);
      policy.identities.find(
        (identity) => identity.id === actor.identity,
      )!.grants[input.application.id] = [
        ...new Set([...input.application.requiredRoles, 'admin']),
      ];
    } else policy.applications[index] = input.application;
    if (
      input.application.id === actor.application &&
      !input.application.requiredRoles.every((role) =>
        actor.roles.includes(role),
      )
    )
      throw new AuthError(
        409,
        'SELF_LOCKOUT',
        'Keep your current administrator authorized',
      );
    let validated;
    try {
      validated = validatePolicy(policy);
    } catch {
      throw new AuthError(
        400,
        'APPLICATION_INVALID',
        'Invalid application definition, origin or policy limit',
      );
    }
    const result = this.auth.applyPolicy(validated, input.revision, {
      token: raw,
      now,
      applicationManager: true,
    });
    return { ...result, reauthenticationRequired: result.changed };
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
          walletsEditable:
            !Object.keys(identity.grants).some(
              (app) => app !== actor.application,
            ) &&
            (!current.policy.applicationManagers?.includes(identity.id) ||
              !!current.policy.applicationManagers?.includes(actor.identity)),
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
    if (
      policy.applicationManagers?.includes(identity.id) &&
      !policy.applicationManagers.includes(actor.identity) &&
      JSON.stringify(identity.wallets) !== JSON.stringify(wallets)
    )
      throw new AuthError(
        403,
        'APPLICATION_MANAGER_REQUIRED',
        'Application manager wallets are operator-controlled',
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

  authorization(raw: string, now: number) {
    const actor = this.actor(raw, now, true);
    const current = this.auth.policy()!;
    const application = current.policy.applications.find(
      (entry) => entry.id === actor.application,
    )!;
    return {
      revision: current.digest,
      application: actor.application,
      model: application.authorization ?? {
        permissions: [],
        roles: {},
        resources: [],
      },
      grants: current.policy.identities.flatMap((identity) =>
        (identity.resourceGrants?.[actor.application] ?? []).map((grant) => ({
          identity: identity.id,
          ...grant,
        })),
      ),
      identities: current.policy.identities
        .filter((identity) => Object.hasOwn(identity.grants, actor.application))
        .map((identity) => identity.id),
    };
  }

  saveAuthorization(
    raw: string,
    input: {
      revision: string;
      model: AuthorizationModel;
      grants: Array<ResourceGrant & { identity: string }>;
    },
    now: number,
  ) {
    const actor = this.actor(raw, now, true);
    const current = this.auth.policy()!;
    if (current.digest !== input.revision)
      throw new AuthError(
        409,
        'POLICY_CONFLICT',
        'Policy changed. Reload authorization before saving',
      );
    const policy = structuredClone(current.policy);
    const application = policy.applications.find(
      (entry) => entry.id === actor.application,
    )!;
    application.authorization = input.model;
    const byIdentity = new Map<string, ResourceGrant[]>();
    for (const grant of input.grants) {
      const identity = policy.identities.find(
        (entry) => entry.id === grant.identity,
      );
      if (!identity || !Object.hasOwn(identity.grants, actor.application))
        throw new AuthError(
          400,
          'AUTHORIZATION_IDENTITY_INVALID',
          'Resource grants must reference an application identity',
        );
      const entries = byIdentity.get(grant.identity) ?? [];
      entries.push({
        role: grant.role,
        resource: grant.resource,
        ...(grant.expiresAt === undefined
          ? {}
          : { expiresAt: grant.expiresAt }),
      });
      byIdentity.set(grant.identity, entries);
    }
    for (const identity of policy.identities) {
      if (!Object.hasOwn(identity.grants, actor.application)) continue;
      const grants = byIdentity.get(identity.id) ?? [];
      identity.resourceGrants ??= {};
      if (grants.length) identity.resourceGrants[actor.application] = grants;
      else delete identity.resourceGrants[actor.application];
      if (!Object.keys(identity.resourceGrants).length)
        delete identity.resourceGrants;
    }
    let validated;
    try {
      validated = validatePolicy(policy);
    } catch {
      throw new AuthError(
        400,
        'AUTHORIZATION_INVALID',
        'Invalid permissions, roles, resources or grants',
      );
    }
    const result = this.auth.applyPolicy(validated, input.revision, {
      token: raw,
      now,
    });
    return { ...result, reauthenticationRequired: result.changed };
  }

  inspectAuthorization(
    raw: string,
    input: { identity: string; permission: string; resource: string },
    now: number,
  ) {
    const actor = this.actor(raw, now, true);
    const current = this.auth.policy()!;
    return {
      ...decide(current.policy, actor.application, input.identity, input, now),
      policyRevision: current.digest,
    };
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
      this.audit(
        'session.revoked-by-admin',
        actor.identity,
        actor.id,
        actor.application,
        now,
      );
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
      this.audit(
        'invitation.created',
        actor.identity,
        actor.id,
        actor.application,
        now,
      );
      return {
        id,
        network,
        address,
        expiresAt,
        roles: ['reader'],
        url: app.origin + '/',
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
      this.audit(
        'invitation.revoked',
        actor.identity,
        actor.id,
        actor.application,
        now,
      );
      return { ok: true };
    });
  }
  request(
    raw: string,
    input: DeploymentPayload,
    deliveryMode: 'simulation' | 'webhook',
    now: number,
  ) {
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
      const requiredApprovals =
        this.auth
          .policy()!
          .policy.applications.find((app) => app.id === actor.application)
          ?.approvalThreshold ?? 1;
      this.db
        .prepare(
          "INSERT INTO actions(id, application, requester, requester_token_hash, payload, payload_hash, created_at, expires_at, status, required_approvals, delivery_mode) VALUES (?,?,?,?,?,?,?,?,'pending',?,?)",
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
          requiredApprovals,
          deliveryMode,
        );
      this.audit(
        'action.requested',
        actor.identity,
        actor.id,
        actor.application,
        now,
      );
      return this.publicAction(this.action(id, actor.application), now);
    });
  }
  challenge(raw: string, id: string, chain: string, now: number) {
    return this.transaction(() => {
      const actor = this.actor(raw, now, true);
      const action = this.action(id, actor.application);
      this.requester(action, now);
      if (action.status !== 'pending') throw deny();
      if (
        this.approvals(action, now).some(
          (approval) => approval.identity === actor.identity && approval.valid,
        )
      )
        throw new AuthError(
          409,
          'APPROVAL_EXISTS',
          'This identity already approved the action',
        );
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
        statement:
          action.delivery_mode === 'webhook'
            ? `Approve action delivery: ${payload.project} version ${payload.version} to ${payload.environment}. Gozne will send this exact payload to the configured application adapter.`
            : `Approve simulated deployment: ${payload.project} version ${payload.version} to ${payload.environment}. No infrastructure or funds will be changed.`,
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
        this.audit(
          'action.proof-denied',
          actor.identity,
          actor.id,
          actor.application,
          now,
        );
        return null;
      }
      this.db
        .prepare(
          `INSERT INTO action_approvals(action_id, approver_identity, approver_token_hash, approved_at, expires_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(action_id, approver_identity) DO UPDATE SET
             approver_token_hash = excluded.approver_token_hash,
             approved_at = excluded.approved_at,
             expires_at = excluded.expires_at`,
        )
        .run(id, actor.identity, digest(raw), now, fields.expiresAt);
      const action = this.action(id, actor.application);
      const liveApprovals = this.approvals(action, now).filter(
        (approval) => approval.valid,
      );
      if (liveApprovals.length >= action.required_approvals)
        this.db
          .prepare(
            "UPDATE actions SET status = 'approved', approver_token_hash = ?, approved_by = ?, approved_at = ?, approval_expires_at = ? WHERE id = ?",
          )
          .run(
            digest(raw),
            actor.identity,
            now,
            Math.min(...liveApprovals.map((approval) => approval.expiresAt)),
            id,
          );
      this.audit(
        'action.approved',
        actor.identity,
        actor.id,
        actor.application,
        now,
      );
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
      if (
        action.status !== 'approved' ||
        this.approvals(action, now).filter((approval) => approval.valid)
          .length < action.required_approvals
      )
        throw deny();
      const payload = JSON.parse(action.payload) as DeploymentPayload;
      if (action.delivery_mode !== 'simulation')
        throw new AuthError(
          503,
          'ACTION_ADAPTER_UNAVAILABLE',
          'The action requires the configured webhook adapter',
        );
      // The simulated effect and consumption share one SQLite commit. No external deployment runs here.
      this.db
        .prepare(
          'INSERT INTO demo_deployments(action_id, application, project, version, environment, executed_at, delivery_mode) VALUES (?,?,?,?,?,?,?)',
        )
        .run(
          id,
          actor.application,
          payload.project,
          payload.version,
          payload.environment,
          now,
          'simulation',
        );
      this.db
        .prepare(
          "UPDATE actions SET status = 'executed', executed_at = ? WHERE id = ?",
        )
        .run(now, id);
      this.audit(
        'action.executed',
        actor.identity,
        actor.id,
        actor.application,
        now,
      );
      return {
        action: this.publicAction(this.action(id, actor.application), now),
        receipt: { actionId: id, ...payload, executedAt: now, simulated: true },
      };
    });
  }

  executionMode(raw: string, id: string, now: number) {
    const actor = this.actor(raw, now);
    const action = this.action(id, actor.application);
    if (action.requester_token_hash !== digest(raw))
      throw new AuthError(
        403,
        'REQUESTER_REQUIRED',
        'Only the requesting session can execute this action',
      );
    return action.delivery_mode;
  }

  beginWebhook(raw: string, id: string, now: number) {
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
      if (
        action.delivery_mode !== 'webhook' ||
        action.status !== 'approved' ||
        this.approvals(action, now).filter((approval) => approval.valid)
          .length < action.required_approvals
      )
        throw deny();
      const existing = this.db
        .prepare(
          'SELECT state, attempts, lease_expires_at FROM action_deliveries WHERE action_id = ?',
        )
        .get(id) as
        | {
            state: 'delivering' | 'failed' | 'delivered';
            attempts: number;
            lease_expires_at: number;
          }
        | undefined;
      if (existing?.state === 'delivered') throw deny();
      if (existing?.state === 'delivering' && existing.lease_expires_at > now)
        throw new AuthError(
          409,
          'ACTION_DELIVERY_BUSY',
          'Action delivery is already in progress',
        );
      const attempts = (existing?.attempts ?? 0) + 1;
      if (attempts > 5)
        throw new AuthError(
          409,
          'ACTION_DELIVERY_LIMIT',
          'Action delivery retry limit reached',
        );
      const leaseToken = randomBytes(32).toString('hex');
      this.db
        .prepare(
          `INSERT INTO action_deliveries(action_id,state,attempts,lease_token_hash,session_id,lease_expires_at,last_attempt_at)
           VALUES (?,'delivering',?,?,?,?,?)
           ON CONFLICT(action_id) DO UPDATE SET state='delivering', attempts=excluded.attempts,
             lease_token_hash=excluded.lease_token_hash, session_id=excluded.session_id,
             lease_expires_at=excluded.lease_expires_at, last_attempt_at=excluded.last_attempt_at,
             error_code=NULL`,
        )
        .run(id, attempts, digest(leaseToken), actor.id, now + 15_000, now);
      const approvals = this.approvals(action, now)
        .filter((approval) => approval.valid)
        .map((approval) => approval.identity)
        .sort();
      return {
        leaseToken,
        action: {
          format: 'gozne-action-v1' as const,
          actionId: id,
          application: action.application,
          requester: action.requester,
          payload: JSON.parse(action.payload) as DeploymentPayload,
          payloadHash: action.payload_hash,
          approvals,
          requestedAt: action.created_at,
          expiresAt: action.expires_at,
        },
      };
    });
  }

  failWebhook(id: string, leaseToken: string, errorCode: string, now: number) {
    return this.transaction(() => {
      const action = this.db
        .prepare('SELECT * FROM actions WHERE id=?')
        .get(id) as unknown as Action | undefined;
      const delivery = this.db
        .prepare(
          "SELECT session_id FROM action_deliveries WHERE action_id=? AND state='delivering' AND lease_token_hash=?",
        )
        .get(id, digest(leaseToken));
      if (!action || !delivery) throw deny();
      const result = this.db
        .prepare(
          "UPDATE action_deliveries SET state='failed', lease_expires_at=?, error_code=? WHERE action_id=? AND state='delivering' AND lease_token_hash=?",
        )
        .run(now, errorCode.slice(0, 64), id, digest(leaseToken));
      if (result.changes)
        this.audit(
          'action.delivery-failed',
          action.requester,
          String(delivery.session_id),
          action.application,
          now,
        );
    });
  }

  finishWebhook(
    id: string,
    leaseToken: string,
    result: { statusCode: number; responseDigest: string },
    now: number,
  ) {
    return this.transaction(() => {
      const delivery = this.db
        .prepare(
          'SELECT state, session_id FROM action_deliveries WHERE action_id=? AND lease_token_hash=?',
        )
        .get(id, digest(leaseToken));
      if (!delivery || delivery.state !== 'delivering') throw deny();
      const action = this.db
        .prepare('SELECT * FROM actions WHERE id=?')
        .get(id) as unknown as Action | undefined;
      if (!action || action.status !== 'approved') throw deny();
      const payload = JSON.parse(action.payload) as DeploymentPayload;
      this.db
        .prepare(
          'INSERT INTO demo_deployments(action_id,application,project,version,environment,executed_at,delivery_mode,delivery_status,response_digest) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          action.application,
          payload.project,
          payload.version,
          payload.environment,
          now,
          'webhook',
          result.statusCode,
          result.responseDigest,
        );
      this.db
        .prepare(
          "UPDATE action_deliveries SET state='delivered', lease_expires_at=?, delivered_at=?, status_code=?, response_digest=? WHERE action_id=?",
        )
        .run(now, now, result.statusCode, result.responseDigest, id);
      this.db
        .prepare(
          "UPDATE actions SET status='executed', executed_at=? WHERE id=?",
        )
        .run(now, id);
      this.audit(
        'action.executed',
        action.requester,
        String(delivery.session_id),
        action.application,
        now,
      );
      return {
        action: this.publicAction(this.action(id, action.application), now),
        receipt: {
          actionId: id,
          ...payload,
          executedAt: now,
          simulated: false,
          deliveryStatus: result.statusCode,
          responseDigest: result.responseDigest,
        },
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
      if (
        this.db
          .prepare(
            "SELECT 1 FROM action_deliveries WHERE action_id=? AND state='delivering' AND lease_expires_at>?",
          )
          .get(id, now)
      )
        throw new AuthError(
          409,
          'ACTION_DELIVERY_BUSY',
          'Action delivery is already in progress',
        );
      this.db
        .prepare("UPDATE actions SET status = 'canceled' WHERE id = ?")
        .run(id);
      this.audit(
        'action.canceled',
        actor.identity,
        actor.id,
        actor.application,
        now,
      );
      return { ok: true };
    });
  }
}
