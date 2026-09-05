#!/usr/bin/env node
import { ConfigError, loadConfig } from '../src/config.js';
import { version } from '../src/metadata.js';
import { serve } from '../src/server.js';
import { inspectStorage, openStorage } from '../src/storage/database.js';
import { readPolicyFile } from '../src/policy/policy.js';
import { administration } from './admin.js';
import { backupDatabase, restoreDatabase } from '../src/storage/recovery.js';

process.umask(0o077);
const args = process.argv.slice(2);
const json = args.includes('--json');
const positional = args.filter((arg) => arg !== '--json');
const command = positional.join(' ');
const output = (value: unknown, text: string) => {
  console.log(json ? JSON.stringify(value) : text);
};

try {
  if (command === '--version' || command === 'version') {
    output({ version }, `Gozne ${version}`);
  } else if (command === '' || command === '--help' || command === 'help') {
    output(
      {
        commands: [
          'serve',
          'config check',
          'doctor',
          'version',
          'policy check <file>',
          'policy apply <file>',
          'policy export',
          'identity list',
          'identity add <id>',
          'wallet attach <id> <evm|solana> <address>',
          'wallet disable <evm|solana> <address>',
          'session list',
          'session revoke <id>',
          'audit export',
          'database backup <new-file>',
          'database restore <backup-file> <new-file>',
        ],
      },
      'Gozne — Firma. Gira. Entra.\n\n  serve | config check | doctor | version\n  policy check <file> | policy apply <file> | policy export\n  identity list | identity add <id>\n  wallet attach <id> <evm|solana> <address>\n  wallet disable <evm|solana> <address>\n  session list | session revoke <id> | audit export\n  database backup <new-file>\n  database restore <backup-file> <new-file>\n\nUse --json for machine-readable output. Alpha: review before production use.',
    );
  } else if (command === 'config check') {
    loadConfig();
    output({ status: 'ok' }, 'Configuration is valid.');
  } else if (command === 'doctor') {
    const { schemaVersion } = inspectStorage(loadConfig().databasePath);
    output(
      { status: 'ok', schemaVersion },
      `Storage is readable and consistent (schema ${schemaVersion}).`,
    );
  } else if (
    positional[0] === 'database' &&
    positional[1] === 'backup' &&
    positional.length === 3
  ) {
    const result = await backupDatabase(
      loadConfig().databasePath,
      positional[2]!,
    );
    output(result, 'Backup verified and saved.');
  } else if (
    positional[0] === 'database' &&
    positional[1] === 'restore' &&
    positional.length === 4
  ) {
    const result = await restoreDatabase(positional[2]!, positional[3]!);
    output(
      result,
      'Restored to a new database. Sessions and challenges cleared; review policy before starting.',
    );
  } else if (command === 'serve' && !json) {
    await serve(loadConfig());
  } else if (
    args.filter((arg) => arg !== '--json')[0] === 'policy' &&
    args.filter((arg) => arg !== '--json')[1] === 'check' &&
    args.filter((arg) => arg !== '--json').length === 3
  ) {
    readPolicyFile(args.filter((arg) => arg !== '--json')[2]!);
    output({ status: 'ok' }, 'Policy is valid.');
  } else if (
    ['policy', 'identity', 'wallet', 'session', 'audit'].includes(args[0] ?? '')
  ) {
    const config = loadConfig();
    // Only applying a policy bootstraps a new database. Other commands require existing state.
    if (args[0] !== 'policy' || args[1] !== 'apply')
      inspectStorage(config.databasePath);
    const storage = openStorage(config.databasePath);
    try {
      const result = administration(
        storage.auth,
        args.filter((arg) => arg !== '--json'),
      );
      output(result, JSON.stringify(result, null, 2));
    } finally {
      storage.close();
    }
  } else {
    output(
      { error: { code: 'USAGE_ERROR', message: 'Unknown command or option' } },
      'Unknown command or option. Run gozne --help.',
    );
    process.exitCode = 64;
  }
} catch (error) {
  const configuration = error instanceof ConfigError;
  const code = configuration ? 'CONFIG_INVALID' : 'SERVICE_UNAVAILABLE';
  const message = configuration
    ? error.message
    : 'Operation failed. Check storage, permissions and listening port.';
  output({ error: { code, message } }, `${code}: ${message}`);
  process.exitCode = configuration ? 78 : 1;
}
