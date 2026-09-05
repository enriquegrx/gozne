import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { AuthStore } from '../auth/store.js';
import { AuthError, invalidProof } from '../auth/errors.js';
import { SESSION_COOKIE, originAllowed, sameSiteRead } from '../auth/routes.js';
import { verifyProof } from '../wallets/proofs.js';
import type { ControlStore, DeploymentPayload } from './store.js';

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const id = { type: 'string', format: 'uuid' };
const empty = object({});
const text = {
  type: 'string',
  minLength: 1,
  maxLength: 64,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
};
const params = object({ id });

export async function controlRoutes(
  app: FastifyInstance,
  auth: AuthStore,
  store: ControlStore,
  now: () => number,
) {
  app.addHook('preHandler', async (request) => {
    const session = auth.session(request.cookies[SESSION_COOKIE] ?? '', now());
    if (!session)
      throw new AuthError(
        401,
        'SESSION_INVALID',
        'A valid session is required',
      );
    if (request.method === 'GET') {
      sameSiteRead(request, session.origin);
      return;
    }
    originAllowed(request, session.origin);
    const csrf = request.headers['x-csrf-token'];
    if (
      typeof csrf !== 'string' ||
      !/^[a-f0-9]{64}$/.test(csrf) ||
      !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrfToken))
    )
      throw new AuthError(
        403,
        'CSRF_INVALID',
        'A valid CSRF token is required',
      );
  });
  app.get('/v1/auth/control', async (request) =>
    store.overview(request.cookies[SESSION_COOKIE]!, now()),
  );
  app.post<{
    Body: { network: 'evm' | 'solana'; address: string; minutes: number };
  }>(
    '/v1/auth/control/invitations',
    {
      schema: {
        body: object({
          network: { enum: ['evm', 'solana'] },
          address: { type: 'string', minLength: 32, maxLength: 64 },
          minutes: { type: 'integer', minimum: 5, maximum: 1440 },
        }),
      },
    },
    async (request) =>
      store.invite(
        request.cookies[SESSION_COOKIE]!,
        request.body.network,
        request.body.address,
        request.body.minutes,
        now(),
      ),
  );
  app.post<{ Params: { id: string } }>(
    '/v1/auth/control/invitations/:id/revoke',
    { schema: { params, body: empty } },
    async (request) =>
      store.revokeInvitation(
        request.cookies[SESSION_COOKIE]!,
        request.params.id,
        now(),
      ),
  );
  app.post<{ Body: DeploymentPayload }>(
    '/v1/auth/control/actions',
    {
      schema: {
        body: object({
          project: text,
          version: text,
          environment: { enum: ['preview', 'staging', 'production'] },
        }),
      },
    },
    async (request) =>
      store.request(request.cookies[SESSION_COOKIE]!, request.body, now()),
  );
  app.post<{ Params: { id: string }; Body: { chainId: string } }>(
    '/v1/auth/control/actions/:id/challenge',
    {
      schema: {
        params,
        body: object({
          chainId: { type: 'string', minLength: 1, maxLength: 32 },
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
    },
    async (request) =>
      store.challenge(
        request.cookies[SESSION_COOKIE]!,
        request.params.id,
        request.body.chainId,
        now(),
      ),
  );
  app.post<{
    Params: { id: string };
    Body: { nonce: string; message: string; signature: string };
  }>(
    '/v1/auth/control/actions/:id/approve',
    {
      schema: {
        params,
        body: object({
          nonce: { type: 'string', pattern: '^[a-f0-9]{32}$' },
          message: { type: 'string', minLength: 1, maxLength: 4096 },
          signature: { type: 'string', minLength: 1, maxLength: 256 },
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
    },
    async (request) => {
      const raw = request.cookies[SESSION_COOKIE]!;
      const fields = store.proof(
        raw,
        request.params.id,
        request.body.nonce,
        now(),
      );
      const verified = await verifyProof(
        fields,
        request.body.message,
        request.body.signature,
        now(),
      );
      const result = store.approve(
        raw,
        request.params.id,
        request.body.nonce,
        verified,
        now(),
      );
      if (!result) throw invalidProof();
      return result;
    },
  );
  app.post<{ Params: { id: string } }>(
    '/v1/auth/control/actions/:id/execute',
    { schema: { params, body: empty } },
    async (request) =>
      store.execute(request.cookies[SESSION_COOKIE]!, request.params.id, now()),
  );
  app.post<{ Params: { id: string } }>(
    '/v1/auth/control/actions/:id/cancel',
    { schema: { params, body: empty } },
    async (request) =>
      store.cancel(request.cookies[SESSION_COOKIE]!, request.params.id, now()),
  );
}
