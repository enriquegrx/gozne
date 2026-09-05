import { readFileSync } from 'node:fs';

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
if (
  !manifest ||
  typeof manifest !== 'object' ||
  !('version' in manifest) ||
  typeof manifest.version !== 'string'
) {
  throw new Error('Invalid package metadata');
}
export const version = manifest.version;
