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

export const authenticationCapabilities = [
  'auth.evm.siwe.v1',
  'auth.solana.siws.v1',
  'forward-auth.session.v1',
  'forward-auth.request.v1',
] as const;
export const authorizationCapability = 'authorization.resource.v1' as const;
export const authorizationContextCapability =
  'authorization.context.v1' as const;
export const authorizationLookupCapability =
  'authorization.lookup-resources.v1' as const;

export const administrationCapability = 'control.admin.v1' as const;
export const approvalThresholdCapability =
  'control.approval-threshold.v1' as const;
export const auditChainCapability = 'audit.export-chain.v1' as const;
export const webhookActionCapability = 'action.delivery-webhook.v1' as const;
