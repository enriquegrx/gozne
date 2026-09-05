import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { authorization, validatePolicy } from '../policy/policy.js';
import type { Policy } from '../policy/policy.js';
import type { ChallengeFields, Network } from '../wallets/proofs.js';
import { AuthError } from './errors.js';

export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const validToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const csrfFor = (sessionToken: string) =>
  digest(`gozne-csrf:${sessionToken}`);
export interface Nonce extends ChallengeFields {
  contextHash: string;
  policyDigest: string;
  message: string;
  consumedAt: number | null;
}
export interface Session {
  id: string;
  identity: string;
  application: string;
  network: Network;
  address: string;
  origin: string;
  expiresAt: number;
  createdAt: number;
  revokedAt: number | null;
}
const nonceColumns = `nonce, context_hash AS contextHash, application, network, address, chain, origin,
  policy_digest AS policyDigest, message, issued_at AS issuedAt, expires_at AS expiresAt, consumed_at AS consumedAt`;
const sessionColumns = `id, identity, application, network, address, origin, created_at AS createdAt,
  expires_at AS expiresAt, revoked_at AS revokedAt`;

export class AuthStore {
  private cache: { policy: Policy; digest: string } | null = null;
  constructor(private readonly db: DatabaseSync) {}

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

  policy(): { policy: Policy; digest: string } | null {
    const row = this.db
      .prepare(
        'SELECT document, digest FROM effective_policy WHERE singleton = 1',
      )
      .get();
    if (!row) return null;
    if (
      typeof row.document !== 'string' ||
      typeof row.digest !== 'string' ||
      digest(row.document) !== row.digest
    )
      throw new Error('Policy integrity check failed');
    if (this.cache?.digest !== row.digest)
      this.cache = {
        policy: validatePolicy(JSON.parse(row.document)),
        digest: row.digest,
      };
    return this.cache;
  }

  applyPolicy(
    value: unknown,
    expectedDigest?: string,
    administrator?: { token: string; now: number },
  ): { changed: boolean } {
    const policy = validatePolicy(value);
    const document = JSON.stringify(policy);
    const hash = digest(document);
    return this.transaction(() => {
      const operator = administrator
        ? this.session(administrator.token, administrator.now)
        : null;
      if (administrator && !operator?.roles.includes('admin'))
        throw new AuthError(
          403,
          'ADMIN_REQUIRED',
          'A live administrator session is required',
        );
      const current = this.policy();
      if (expectedDigest !== undefined && current?.digest !== expectedDigest)
        throw new AuthError(
          409,
          'POLICY_CONFLICT',
          'Policy changed; reload before editing',
        );
      if (current?.digest === hash) return { changed: false };
      const now = Date.now();
      this.db
        .prepare(
          'INSERT INTO effective_policy VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET document=excluded.document, digest=excluded.digest, applied_at=excluded.applied_at',
        )
        .run(document, hash, now);
      this.db
        .prepare('UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL')
        .run(now);
      this.db.exec(
        "DELETE FROM nonces; DELETE FROM action_challenges; UPDATE actions SET status = 'canceled' WHERE status IN ('pending', 'approved');",
      );
      this.db
        .prepare(
          'UPDATE invitations SET revoked_at = ? WHERE revoked_at IS NULL',
        )
        .run(now);
      this.audit(
        'policy.applied',
        now,
        operator?.identity ?? null,
        operator?.id ?? null,
      );
      return { changed: true };
    });
  }

  private audit(
    event: string,
    now: number,
    identity: string | null = null,
    session: string | null = null,
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit(at, event, identity, session_id) VALUES (?, ?, ?, ?)',
      )
      .run(now, event, identity, session);
    this.db
      .prepare(
        'DELETE FROM audit WHERE at < ? OR sequence <= (SELECT MAX(sequence) - 50000 FROM audit)',
      )
      .run(now - 30 * 86400_000);
  }

  issue(challenge: Nonce): void {
    this.transaction(() => {
      if (this.policy()?.digest !== challenge.policyDigest)
        throw new AuthError(409, 'POLICY_CHANGED', 'Request a new challenge');
      this.db
        .prepare('DELETE FROM nonces WHERE expires_at <= ?')
        .run(challenge.issuedAt);
      this.db
        .prepare('DELETE FROM sessions WHERE expires_at <= ?')
        .run(challenge.issuedAt);
      const global = this.db
        .prepare('SELECT COUNT(*) AS count FROM nonces')
        .get();
      const browser = this.db
        .prepare('SELECT COUNT(*) AS count FROM nonces WHERE context_hash = ?')
        .get(challenge.contextHash);
      if (Number(global?.count) >= 1000 || Number(browser?.count) >= 5)
        throw new AuthError(
          429,
          'CHALLENGE_LIMIT',
          'Too many pending challenges',
        );
      this.db
        .prepare(
          'INSERT INTO nonces VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
        )
        .run(
          challenge.nonce,
          challenge.contextHash,
          challenge.application,
          challenge.network,
          challenge.address,
          challenge.chain,
          challenge.origin,
          challenge.policyDigest,
          challenge.message,
          challenge.issuedAt,
          challenge.expiresAt,
        );
    });
  }

  nonce(nonce: string, context: string): Nonce | null {
    const row = this.db
      .prepare(
        `SELECT ${nonceColumns} FROM nonces WHERE nonce = ? AND context_hash = ?`,
      )
      .get(nonce, digest(context));
    return row ? (row as unknown as Nonce) : null;
  }

  finish(
    nonce: string,
    context: string,
    verified: boolean,
    now: number,
    oldToken?: string,
  ) {
    return this.transaction(() => {
      // Re-read after asynchronous crypto verification. Exactly one request can consume this row.
      const challenge = this.nonce(nonce, context);
      if (
        !challenge ||
        challenge.consumedAt !== null ||
        challenge.expiresAt <= now ||
        challenge.issuedAt > now
      )
        return null;
      const current = this.policy();
      const consumed = this.db
        .prepare(
          'UPDATE nonces SET consumed_at = ? WHERE nonce = ? AND consumed_at IS NULL',
        )
        .run(now, nonce);
      if (consumed.changes !== 1) return null;
      const access =
        verified && current?.digest === challenge.policyDigest
          ? this.access(
              challenge.application,
              challenge.network,
              challenge.address,
              now,
            )
          : null;
      if (!access) {
        this.audit('login.denied', now);
        return null;
      }
      const count = Number(
        this.db
          .prepare(
            'SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?',
          )
          .get(now)?.count,
      );
      if (count >= 10000)
        throw new AuthError(503, 'SESSION_LIMIT', 'Service unavailable');
      const sessionToken = token();
      const sessionId = randomUUID();
      const expiresAt = Math.min(now + 3600_000, access.expiresAt);
      if (oldToken && validToken(oldToken))
        this.db
          .prepare(
            'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
          )
          .run(now, digest(oldToken));
      this.db
        .prepare(
          'INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
        )
        .run(
          digest(sessionToken),
          sessionId,
          access.identity,
          challenge.application,
          challenge.network,
          challenge.address,
          challenge.origin,
          now,
          expiresAt,
        );
      if (access.identity.startsWith('guest-'))
        this.db
          .prepare(
            'UPDATE invitations SET accepted_at = COALESCE(accepted_at, ?) WHERE id = ?',
          )
          .run(now, access.identity.slice(6));
      this.audit('login.succeeded', now, access.identity, sessionId);
      return {
        sessionToken,
        id: sessionId,
        identity: access.identity,
        network: challenge.network,
        address: challenge.address,
        roles: access.roles,
        application: challenge.application,
        expiresAt,
        csrfToken: csrfFor(sessionToken),
      };
    });
  }

  access(
    application: string,
    network: Network,
    address: string,
    now: number,
    expectedIdentity?: string,
  ) {
    const policy = this.policy()?.policy;
    if (!policy) return null;
    const access = authorization(policy, application, network, address);
    if (access) return { ...access, expiresAt: Number.MAX_SAFE_INTEGER };
    // A configured identity (including a disabled wallet) always takes precedence.
    if (
      policy.identities.some((identity) =>
        identity.wallets.some(
          (wallet) => wallet.network === network && wallet.address === address,
        ),
      )
    )
      return null;
    const app = policy.applications.find((app) => app.id === application);
    if (!app || !app.requiredRoles.every((role) => role === 'reader'))
      return null;
    const invite = this.db
      .prepare(
        'SELECT id, expires_at FROM invitations WHERE application = ? AND network = ? AND address = ? AND revoked_at IS NULL AND created_at <= ? AND expires_at > ?',
      )
      .get(application, network, address, now, now);
    if (!invite) return null;
    const identity = `guest-${String(invite.id)}`;
    if (expectedIdentity && expectedIdentity !== identity) return null;
    return {
      identity,
      roles: ['reader'],
      expiresAt: Number(invite.expires_at),
    };
  }

  sessionByHash(hash: string, now: number) {
    const row = this.db
      .prepare(`SELECT ${sessionColumns} FROM sessions WHERE token_hash = ?`)
      .get(hash) as unknown as Session | undefined;
    if (
      !row ||
      row.revokedAt !== null ||
      row.expiresAt <= now ||
      row.createdAt > now
    )
      return null;
    const access = this.access(
      row.application,
      row.network,
      row.address,
      now,
      row.identity,
    );
    const app = this.policy()?.policy.applications.find(
      (app) => app.id === row.application,
    );
    if (
      !access ||
      access.identity !== row.identity ||
      (app?.origin !== row.origin && app?.adminOrigin !== row.origin)
    )
      return null;
    return { ...row, roles: access.roles };
  }

  session(sessionToken: string, now: number) {
    if (!validToken(sessionToken)) return null;
    const row = this.db
      .prepare(`SELECT ${sessionColumns} FROM sessions WHERE token_hash = ?`)
      .get(digest(sessionToken)) as unknown as Session | undefined;
    if (
      !row ||
      row.revokedAt !== null ||
      row.expiresAt <= now ||
      row.createdAt > now
    )
      return null;
    const policy = this.policy();
    const app = policy?.policy.applications.find(
      (app) => app.id === row.application,
    );
    const access = policy
      ? this.access(
          row.application,
          row.network,
          row.address,
          now,
          row.identity,
        )
      : null;
    if (
      !access ||
      access.identity !== row.identity ||
      (app?.origin !== row.origin && app?.adminOrigin !== row.origin)
    )
      return null;
    return { ...row, roles: access.roles, csrfToken: csrfFor(sessionToken) };
  }

  revoke(id: string, now = Date.now()): boolean {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          'SELECT identity FROM sessions WHERE id = ? AND revoked_at IS NULL',
        )
        .get(id);
      if (!row) return false;
      this.db
        .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')
        .run(now, id);
      this.audit('session.revoked', now, String(row.identity), id);
      return true;
    });
  }

  listSessions() {
    return this.db
      .prepare(
        `SELECT id, identity, application, created_at AS createdAt, expires_at AS expiresAt,
      revoked_at AS revokedAt FROM sessions ORDER BY created_at DESC LIMIT 1000`,
      )
      .all();
  }
  exportAudit() {
    return this.db
      .prepare(
        'SELECT at, event, identity, session_id AS sessionId FROM audit ORDER BY sequence',
      )
      .all();
  }
}
