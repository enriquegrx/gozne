#!/usr/bin/env node
import { ConfigError, loadConfig } from '../src/config.js';
import { version } from '../src/metadata.js';
import { serve } from '../src/server.js';
import { inspectStorage } from '../src/storage/database.js';

process.umask(0o077);
const args = process.argv.slice(2);
const json = args.includes('--json');
const command = args.filter((arg) => arg !== '--json').join(' ');
const output = (value: Record<string, unknown>, text: string) => {
  console.log(json ? JSON.stringify(value) : text);
};

try {
  if (command === '--version' || command === 'version') {
    output({ version }, `Gozne ${version}`);
  } else if (command === '' || command === '--help' || command === 'help') {
    output(
      { commands: ['serve', 'config check', 'doctor', 'version'] },
      'Gozne — Firma. Gira. Entra.\n\n  gozne serve\n  gozne config check [--json]\n  gozne doctor [--json]\n  gozne version [--json]\n\nPhase 1: wallet authentication is not implemented yet.',
    );
  } else if (command === 'config check') {
    loadConfig();
    output({ status: 'ok' }, 'Configuration is valid.');
  } else if (command === 'doctor') {
    const { schemaVersion } = inspectStorage(loadConfig().databasePath);
    output(
      { status: 'ok', schemaVersion },
      `Storage is readable and consistent (schema ${schemaVersion}). Authentication is not implemented yet.`,
    );
  } else if (command === 'serve' && !json) {
    await serve(loadConfig());
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
