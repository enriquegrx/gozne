import { randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  canonicalAddress,
  createMessage,
  signInInput,
  verifyProof,
} from '../wallets/proofs.js';
import { AuthError, invalidProof } from './errors.js';
import { digest, token, validToken } from './store.js';
import type { AuthStore, Nonce } from './store.js';

export const SESSION_COOKIE = '__Host-gozne-session';
export const CONTEXT_COOKIE = '__Host-gozne-login';
const cookieOptions = {
  secure: true,
  httpOnly: true,
  sameSite: 'strict',
  path: '/',
} as const;

function originAllowed(request: FastifyRequest, expected: string): void {
  if (
    request.headers.origin !== expected ||
    (request.headers['sec-fetch-site'] &&
      request.headers['sec-fetch-site'] !== 'same-origin')
  ) {
    throw new AuthError(403, 'ORIGIN_DENIED', 'Request origin is not allowed');
  }
}

function sameSiteRead(request: FastifyRequest, expected: string): void {
  if (
    (request.headers.origin && request.headers.origin !== expected) ||
    (request.headers['sec-fetch-site'] &&
      request.headers['sec-fetch-site'] !== 'same-origin')
  ) {
    throw new AuthError(403, 'ORIGIN_DENIED', 'Request origin is not allowed');
  }
}

const string = (maxLength: number) => ({
  type: 'string',
  minLength: 1,
  maxLength,
});
const nonceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['application', 'network', 'address', 'chainId'],
  properties: {
    application: { ...string(64), pattern: '^[a-z][a-z0-9-]*$' },
    network: { enum: ['evm', 'solana'] },
    address: string(64),
    chainId: string(32),
  },
};
const verifySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['nonce', 'message', 'signature'],
  properties: {
    nonce: { type: 'string', pattern: '^[0-9a-f]{32}$' },
    message: string(4096),
    signature: string(256),
  },
};

export async function authRoutes(
  app: FastifyInstance,
  store: AuthStore,
  now = Date.now,
): Promise<void> {
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: 60_000,
    cache: 10000,
    errorResponseBuilder: () =>
      new AuthError(429, 'RATE_LIMITED', 'Too many requests'),
  });
  // Keep database failures distinct from malformed proofs, and never expose raw driver errors.
  app.addHook('preHandler', async () => {
    if (!store.policy())
      throw new AuthError(
        503,
        'POLICY_NOT_CONFIGURED',
        'Configure an access policy first',
      );
  });

  app.post<{
    Body: {
      application: string;
      network: 'evm' | 'solana';
      address: string;
      chainId: string;
    };
  }>(
    '/v1/auth/nonce',
    {
      schema: { body: nonceSchema },
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const current = store.policy();
      const application = current?.policy.applications.find(
        (entry) => entry.id === request.body.application,
      );
      if (!current || !application)
        throw new AuthError(
          403,
          'APPLICATION_DENIED',
          'Application is not available',
        );
      originAllowed(request, application.origin);
      const { network, chainId } = request.body;
      const allowed =
        network === 'evm'
          ? application.evmChainIds.map(String)
          : application.solanaChains;
      if (!allowed.includes(chainId))
        throw new AuthError(400, 'CHAIN_DENIED', 'Chain is not available');
      let address: string;
      try {
        address = canonicalAddress(network, request.body.address);
      } catch {
        throw new AuthError(400, 'ADDRESS_INVALID', 'Invalid wallet address');
      }
      const existing = request.cookies[CONTEXT_COOKIE];
      const context = validToken(existing) ? existing : token();
      const time = now();
      const fields = {
        nonce: randomBytes(16).toString('hex'),
        application: application.id,
        network,
        address,
        chain: chainId,
        origin: application.origin,
        issuedAt: time,
        expiresAt: time + 300_000,
      };
      const challenge: Nonce = {
        ...fields,
        contextHash: digest(context),
        policyDigest: current.digest,
        message: createMessage(fields),
        consumedAt: null,
      };
      store.issue(challenge);
      reply.setCookie(CONTEXT_COOKIE, context, {
        ...cookieOptions,
        maxAge: 300,
      });
      return {
        nonce: challenge.nonce,
        message: challenge.message,
        expiresAt: challenge.expiresAt,
        ...(network === 'solana' ? { signInInput: signInInput(fields) } : {}),
      };
    },
  );

  app.post<{ Body: { nonce: string; message: string; signature: string } }>(
    '/v1/auth/verify',
    {
      schema: { body: verifySchema },
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const started = performance.now();
      const deny = async () => {
        await setTimeout(
          Math.max(
            0,
            100 + (randomBytes(1)[0]! % 21) - (performance.now() - started),
          ),
        );
        throw invalidProof();
      };
      const context = request.cookies[CONTEXT_COOKIE];
      if (!validToken(context)) return deny();
      const challenge = store.nonce(request.body.nonce, context);
      if (!challenge) return deny();
      originAllowed(request, challenge.origin);
      const verified =
        request.body.message === challenge.message &&
        (await verifyProof(
          challenge,
          request.body.message,
          request.body.signature,
          now(),
        ));
      const session = store.finish(
        challenge.nonce,
        context,
        verified,
        now(),
        request.cookies[SESSION_COOKIE],
      );
      if (!session) return deny();
      const { sessionToken, ...publicSession } = session;
      reply.setCookie(SESSION_COOKIE, sessionToken, {
        ...cookieOptions,
        maxAge: 3600,
      });
      return publicSession;
    },
  );

  const requireSession = (request: FastifyRequest) => {
    const session = store.session(request.cookies[SESSION_COOKIE] ?? '', now());
    if (!session)
      throw new AuthError(
        401,
        'SESSION_INVALID',
        'A valid session is required',
      );
    return session;
  };
  app.get('/v1/auth/me', async (request) => {
    const session = requireSession(request);
    sameSiteRead(request, session.origin);
    return {
      id: session.id,
      identity: session.identity,
      application: session.application,
      roles: session.roles,
      expiresAt: session.expiresAt,
      csrfToken: session.csrfToken,
    };
  });
  app.get<{ Querystring: { application: string } }>(
    '/v1/auth/validate',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['application'],
          additionalProperties: false,
          properties: {
            application: { ...string(64), pattern: '^[a-z][a-z0-9-]*$' },
          },
        },
      },
    },
    async (request, reply) => {
      const session = requireSession(request);
      if (session.application !== request.query.application)
        throw new AuthError(
          403,
          'APPLICATION_DENIED',
          'Session is not authorized for this application',
        );
      return reply
        .header('X-Gozne-Identity', session.identity)
        .header('X-Gozne-Role', session.roles.join(','))
        .header('X-Gozne-Application', session.application)
        .header('X-Gozne-Session', session.id)
        .code(200)
        .send();
    },
  );
  app.post('/v1/auth/logout', async (request, reply) => {
    const session = requireSession(request);
    originAllowed(request, session.origin);
    const actual = request.headers['x-csrf-token'];
    if (
      typeof actual !== 'string' ||
      !/^[0-9a-f]{64}$/.test(actual) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(session.csrfToken))
    )
      throw new AuthError(
        403,
        'CSRF_INVALID',
        'A valid CSRF token is required',
      );
    store.revoke(session.id, now());
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    reply.clearCookie(CONTEXT_COOKIE, cookieOptions);
    return { ok: true };
  });
}
