import { isIP } from 'node:net';
import { resolve } from 'node:path';

export interface Config {
  surface: 'public' | 'admin';
  host: string;
  port: number;
  databasePath: string;
  logLevel: 'silent' | 'info' | 'warn' | 'error';
  actionDelivery:
    | { mode: 'simulation' }
    | {
        mode: 'webhook';
        url: string;
        secret: string;
        timeoutMs: number;
      };
}

export class ConfigError extends Error {}

const keys = new Set([
  'GOZNE_SURFACE',
  'GOZNE_HOST',
  'GOZNE_PORT',
  'GOZNE_DATABASE',
  'GOZNE_LOG_LEVEL',
  'GOZNE_ACTION_MODE',
  'GOZNE_ACTION_WEBHOOK_URL',
  'GOZNE_ACTION_WEBHOOK_SECRET',
  'GOZNE_ACTION_WEBHOOK_TIMEOUT_MS',
  'GOZNE_ACTION_WEBHOOK_ALLOW_HTTP',
]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (
    Object.keys(env).some((key) => key.startsWith('GOZNE_') && !keys.has(key))
  ) {
    throw new ConfigError('Unknown GOZNE configuration option');
  }
  const surface = env.GOZNE_SURFACE ?? 'public';
  if (surface !== 'public' && surface !== 'admin')
    throw new ConfigError('GOZNE_SURFACE must be public or admin');
  const host = env.GOZNE_HOST ?? '127.0.0.1';
  if (!isIP(host)) throw new ConfigError('GOZNE_HOST must be an IP address');
  const rawPort = env.GOZNE_PORT ?? '3001';
  if (!/^[1-9]\d{0,4}$/.test(rawPort) || Number(rawPort) > 65535) {
    throw new ConfigError('GOZNE_PORT must be an integer from 1 to 65535');
  }
  const database = env.GOZNE_DATABASE ?? './state/gozne.sqlite';
  if (
    !database.trim() ||
    database !== database.trim() ||
    database.includes('\0') ||
    database === ':memory:'
  ) {
    throw new ConfigError('GOZNE_DATABASE must be a persistent file path');
  }
  const logLevel = env.GOZNE_LOG_LEVEL ?? 'info';
  if (
    logLevel !== 'silent' &&
    logLevel !== 'info' &&
    logLevel !== 'warn' &&
    logLevel !== 'error'
  ) {
    throw new ConfigError(
      'GOZNE_LOG_LEVEL must be silent, info, warn or error',
    );
  }
  const actionMode = env.GOZNE_ACTION_MODE ?? 'simulation';
  if (actionMode !== 'simulation' && actionMode !== 'webhook')
    throw new ConfigError('GOZNE_ACTION_MODE must be simulation or webhook');
  const actionOptions = [
    env.GOZNE_ACTION_WEBHOOK_URL,
    env.GOZNE_ACTION_WEBHOOK_SECRET,
    env.GOZNE_ACTION_WEBHOOK_TIMEOUT_MS,
    env.GOZNE_ACTION_WEBHOOK_ALLOW_HTTP,
  ];
  if (
    actionMode === 'simulation' &&
    actionOptions.some((value) => value !== undefined)
  )
    throw new ConfigError('Webhook options require GOZNE_ACTION_MODE=webhook');
  let actionDelivery: Config['actionDelivery'] = { mode: 'simulation' };
  if (actionMode === 'webhook') {
    if (surface !== 'admin')
      throw new ConfigError(
        'Webhook delivery is only available on the admin surface',
      );
    if (!env.GOZNE_ACTION_WEBHOOK_URL || !env.GOZNE_ACTION_WEBHOOK_SECRET)
      throw new ConfigError('Webhook URL and secret are required');
    let url: URL;
    try {
      url = new URL(env.GOZNE_ACTION_WEBHOOK_URL);
    } catch {
      throw new ConfigError('Invalid webhook URL');
    }
    if (
      env.GOZNE_ACTION_WEBHOOK_ALLOW_HTTP !== undefined &&
      !['true', 'false'].includes(env.GOZNE_ACTION_WEBHOOK_ALLOW_HTTP)
    )
      throw new ConfigError(
        'GOZNE_ACTION_WEBHOOK_ALLOW_HTTP must be true or false',
      );
    const allowHttp = env.GOZNE_ACTION_WEBHOOK_ALLOW_HTTP === 'true';
    if (
      (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) ||
      !!url.username ||
      !!url.password ||
      !!url.hash ||
      url.toString().length > 2048
    )
      throw new ConfigError(
        'Webhook URL must use HTTPS without credentials or fragments',
      );
    if (Buffer.byteLength(env.GOZNE_ACTION_WEBHOOK_SECRET) < 32)
      throw new ConfigError('Webhook secret must contain at least 32 bytes');
    const rawTimeout = env.GOZNE_ACTION_WEBHOOK_TIMEOUT_MS ?? '5000';
    if (!/^[1-9]\d*$/.test(rawTimeout))
      throw new ConfigError('Webhook timeout must be an integer');
    const timeoutMs = Number(rawTimeout);
    if (timeoutMs < 500 || timeoutMs > 10_000)
      throw new ConfigError(
        'Webhook timeout must be from 500 to 10000 milliseconds',
      );
    actionDelivery = {
      mode: 'webhook',
      url: url.toString(),
      secret: env.GOZNE_ACTION_WEBHOOK_SECRET,
      timeoutMs,
    };
  }
  return {
    surface,
    host,
    port: Number(rawPort),
    databasePath: resolve(database),
    logLevel,
    actionDelivery,
  };
}
