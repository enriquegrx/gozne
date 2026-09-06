import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AuthStore } from '../auth/store.js';
import { AuthError } from '../auth/errors.js';
import { decide } from './decision.js';
import type { AuthorizationCheck } from './decision.js';

const checkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['permission', 'resource'],
  properties: {
    permission: {
      type: 'string',
      maxLength: 64,
      pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$',
    },
    resource: {
      type: 'string',
      maxLength: 97,
      pattern: '^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$',
    },
  },
} as const;

const digest = (value: string) => createHash('sha256').update(value).digest();

export async function authorizationRoutes(
  app: FastifyInstance,
  store: AuthStore,
  tokens: Record<string, string>,
  now = Date.now,
): Promise<void> {
  const authenticate = (header: unknown): string => {
    if (typeof header !== 'string' || !header.startsWith('Bearer '))
      throw new AuthError(
        401,
        'SERVICE_AUTH_REQUIRED',
        'Application service authentication is required',
      );
    const supplied = digest(header.slice(7));
    const application = Object.entries(tokens).find(([, token]) =>
      timingSafeEqual(supplied, digest(token)),
    )?.[0];
    if (!application)
      throw new AuthError(
        401,
        'SERVICE_AUTH_INVALID',
        'Application service authentication is invalid',
      );
    return application;
  };

  const run = (
    application: string,
    sessionId: string,
    check: AuthorizationCheck,
  ) => {
    const time = now();
    const session = store.sessionById(sessionId, time);
    if (!session || session.application !== application)
      throw new AuthError(
        401,
        'SESSION_INVALID',
        'A valid application session is required',
      );
    const current = store.policy()!;
    const result = decide(
      current.policy,
      application,
      session.identity,
      check,
      time,
      session.roles,
    );
    store.recordAuthorizationDecision(
      session,
      result.allowed,
      check.permission,
      time,
    );
    return {
      ...result,
      decisionId: randomUUID(),
      policyRevision: current.digest,
    };
  };

  app.post<{
    Body: { sessionId: string; permission: string; resource: string };
  }>(
    '/v1/internal/authorize',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['sessionId', 'permission', 'resource'],
          properties: {
            sessionId: { type: 'string', format: 'uuid' },
            ...checkSchema.properties,
          },
        },
      },
      config: { rateLimit: { max: 600, timeWindow: 60_000 } },
    },
    async (request) =>
      run(authenticate(request.headers.authorization), request.body.sessionId, {
        permission: request.body.permission,
        resource: request.body.resource,
      }),
  );

  app.post<{
    Body: { sessionId: string; checks: AuthorizationCheck[] };
  }>(
    '/v1/internal/authorize/batch',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['sessionId', 'checks'],
          properties: {
            sessionId: { type: 'string', format: 'uuid' },
            checks: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              items: checkSchema,
            },
          },
        },
      },
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request) => {
      const application = authenticate(request.headers.authorization);
      return {
        decisions: request.body.checks.map((check) =>
          run(application, request.body.sessionId, check),
        ),
      };
    },
  );
}
