import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import type { Config } from '../config.js';
import { version } from '../metadata.js';
import type { Storage } from '../storage/database.js';
import { AuthError } from '../auth/errors.js';
import { controlRoutes } from '../control/routes.js';
import { authRoutes } from '../auth/routes.js';

export function buildApp(config: Config, storage: Storage, now = Date.now) {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 16 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    requestTimeout: 10_000,
    connectionTimeout: 10_000,
    exposeHeadRoutes: false,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    reply.header('X-Request-Id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    // Deliberately omit URLs, headers, IPs and bodies from request logs.
    request.log.info(
      { method: request.method, statusCode: reply.statusCode },
      'request completed',
    );
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthError)
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          request_id: request.id,
        },
      });
    const statusCode =
      error !== null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : request.routeOptions.url?.startsWith('/v1/auth/')
          ? 503
          : 500;
    const code =
      statusCode === 413
        ? 'PAYLOAD_TOO_LARGE'
        : statusCode < 500
          ? 'INVALID_REQUEST'
          : statusCode === 503
            ? 'STORAGE_UNAVAILABLE'
            : 'INTERNAL_ERROR';
    request.log.error({ code }, 'request failed');
    return reply.code(statusCode).send({
      error: {
        code,
        message: 'Request could not be completed',
        request_id: request.id,
      },
    });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        request_id: request.id,
      },
    }),
  );
  app.get('/healthz', async (request, reply) => {
    try {
      storage.check();
    } catch {
      return reply.code(503).send({
        error: {
          code: 'STORAGE_UNAVAILABLE',
          message: 'Service unavailable',
          request_id: request.id,
        },
      });
    }
    return { status: 'ok' };
  });
  app.get('/version', async () => ({
    name: 'gozne',
    version,
    stage: 'alpha',
    authentication: true,
  }));
  void app.register(async (scope) => {
    await authRoutes(scope, storage.auth, now);
    await scope.register(async (control) =>
      controlRoutes(control, storage.auth, storage.control, now),
    );
  });
  app.addHook('onClose', async () => {
    storage.close();
  });
  return app;
}
