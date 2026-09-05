import { isIP } from 'node:net';
import { resolve } from 'node:path';

export interface Config {
  host: string;
  port: number;
  databasePath: string;
  logLevel: 'silent' | 'info' | 'warn' | 'error';
}

export class ConfigError extends Error {}

const keys = new Set([
  'GOZNE_HOST',
  'GOZNE_PORT',
  'GOZNE_DATABASE',
  'GOZNE_LOG_LEVEL',
]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (
    Object.keys(env).some((key) => key.startsWith('GOZNE_') && !keys.has(key))
  ) {
    throw new ConfigError('Unknown GOZNE configuration option');
  }
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
  return {
    host,
    port: Number(rawPort),
    databasePath: resolve(database),
    logLevel,
  };
}
