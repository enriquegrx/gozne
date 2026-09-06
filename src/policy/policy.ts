import { readFileSync, statSync } from 'node:fs';
import { ConfigError } from '../config.js';
import { canonicalAddress } from '../wallets/proofs.js';
import type { Network } from '../wallets/proofs.js';

export interface Application {
  id: string;
  origin: string;
  adminOrigin?: string;
  evmChainIds: number[];
  solanaChains: string[];
  requiredRoles: string[];
  approvalThreshold?: number;
}
export interface Identity {
  id: string;
  wallets: { network: Network; address: string; enabled: boolean }[];
  grants: Record<string, string[]>;
}
export interface Policy {
  applicationManagers?: string[];
  version: 1;
  applications: Application[];
  identities: Identity[];
}

export function object(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new ConfigError('Invalid object or unknown field');
  }
  return value as Record<string, unknown>;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new ConfigError('Invalid or oversized list');
  return value;
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value))
    throw new ConfigError(
      'Identifiers must use lowercase letters, digits and hyphens',
    );
  return value;
}
function unique<T>(values: T[]): T[] {
  if (new Set(values).size !== values.length)
    throw new ConfigError('Duplicate policy entry');
  return values;
}
function roles(value: unknown): string[] {
  return unique(list(value, 20).map(identifier));
}

export function validatePolicy(value: unknown): Policy {
  const root = object(value, [
    'version',
    'applications',
    'identities',
    'applicationManagers',
  ]);
  if (root.version !== 1) throw new ConfigError('Unsupported policy version');
  const applications = list(root.applications, 100).map(
    (value): Application => {
      const app = object(value, [
        'id',
        'origin',
        'adminOrigin',
        'evmChainIds',
        'solanaChains',
        'requiredRoles',
        'approvalThreshold',
      ]);
      if (typeof app.origin !== 'string')
        throw new ConfigError('Application origin is required');
      let url: URL;
      try {
        url = new URL(app.origin);
      } catch {
        throw new ConfigError('Invalid application origin');
      }
      if (
        url.protocol !== 'https:' ||
        url.origin !== app.origin ||
        url.username ||
        url.password
      )
        throw new ConfigError(
          'Application origin must be a canonical HTTPS origin without a path',
        );
      if (app.adminOrigin !== undefined) {
        if (typeof app.adminOrigin !== 'string')
          throw new ConfigError('Invalid admin origin');
        let admin: URL;
        try {
          admin = new URL(app.adminOrigin);
        } catch {
          throw new ConfigError('Invalid admin origin');
        }
        if (
          admin.protocol !== 'https:' ||
          admin.origin !== app.adminOrigin ||
          admin.username ||
          admin.password ||
          admin.hostname === url.hostname
        )
          throw new ConfigError(
            'Admin origin must be canonical HTTPS on a different hostname',
          );
      }
      const evmChainIds = unique(
        list(app.evmChainIds, 20).map((chain) => {
          if (
            typeof chain !== 'number' ||
            !Number.isSafeInteger(chain) ||
            chain < 1
          )
            throw new ConfigError('Invalid EVM chain ID');
          return chain;
        }),
      );
      const solanaChains = unique(
        list(app.solanaChains, 3).map((chain) => {
          if (
            chain !== 'solana:mainnet' &&
            chain !== 'solana:devnet' &&
            chain !== 'solana:testnet'
          )
            throw new ConfigError('Invalid Solana chain');
          return chain;
        }),
      );
      if (!evmChainIds.length && !solanaChains.length)
        throw new ConfigError('Application must allow at least one chain');
      const approvalThreshold = app.approvalThreshold ?? 1;
      if (
        typeof approvalThreshold !== 'number' ||
        !Number.isSafeInteger(approvalThreshold) ||
        approvalThreshold < 1 ||
        approvalThreshold > 10
      )
        throw new ConfigError('Approval threshold must be between 1 and 10');
      return {
        id: identifier(app.id),
        origin: app.origin,
        ...(app.adminOrigin === undefined
          ? {}
          : { adminOrigin: app.adminOrigin as string }),
        evmChainIds,
        solanaChains,
        requiredRoles: roles(app.requiredRoles),
        approvalThreshold,
      };
    },
  );
  const publicHosts = new Set(
    applications.map((app) => new URL(app.origin).hostname),
  );
  if (
    applications.some(
      (app) =>
        app.adminOrigin && publicHosts.has(new URL(app.adminOrigin).hostname),
    )
  )
    throw new ConfigError(
      'Admin hostnames must be separate from all public application hostnames',
    );
  const appIds = unique(applications.map((app) => app.id));
  const walletKeys = new Set<string>();
  const identities = list(root.identities, 1000).map((value): Identity => {
    const identity = object(value, ['id', 'wallets', 'grants']);
    const wallets = list(identity.wallets, 20).map(
      (value): Identity['wallets'][number] => {
        const wallet = object(value, ['network', 'address', 'enabled']);
        if (
          (wallet.network !== 'evm' && wallet.network !== 'solana') ||
          typeof wallet.address !== 'string'
        )
          throw new ConfigError('Invalid wallet');
        if (wallet.enabled !== undefined && typeof wallet.enabled !== 'boolean')
          throw new ConfigError('Invalid wallet status');
        let address: string;
        try {
          address = canonicalAddress(wallet.network, wallet.address);
        } catch {
          throw new ConfigError('Invalid wallet address');
        }
        const key = `${wallet.network}:${address}`;
        if (walletKeys.has(key))
          throw new ConfigError('Wallet cannot belong to multiple entries');
        walletKeys.add(key);
        return {
          network: wallet.network,
          address,
          enabled: wallet.enabled !== false,
        };
      },
    );
    const grants = object(identity.grants, appIds);
    return {
      id: identifier(identity.id),
      wallets,
      grants: Object.fromEntries(
        Object.entries(grants).map(([app, value]) => [app, roles(value)]),
      ),
    };
  });
  unique(identities.map((identity) => identity.id));
  const managers =
    root.applicationManagers === undefined
      ? undefined
      : unique(list(root.applicationManagers, 100).map(identifier));
  if (
    managers?.some((id) => !identities.some((identity) => identity.id === id))
  )
    throw new ConfigError(
      'Application managers must reference existing identities',
    );
  const policy: Policy = {
    version: 1,
    applications,
    identities,
    ...(managers === undefined ? {} : { applicationManagers: managers }),
  };
  if (JSON.stringify(policy).length > 128 * 1024)
    throw new ConfigError('Policy is too large');
  return policy;
}

export function readPolicyFile(path: string): Policy {
  if (statSync(path).size > 128 * 1024)
    throw new ConfigError('Policy is too large');
  try {
    return validatePolicy(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError('Policy is not valid JSON');
  }
}

export function authorization(
  policy: Policy,
  application: string,
  network: Network,
  address: string,
) {
  const app = policy.applications.find((entry) => entry.id === application);
  const identity = policy.identities.find((entry) =>
    entry.wallets.some(
      (wallet) =>
        wallet.enabled &&
        wallet.network === network &&
        wallet.address === address,
    ),
  );
  const granted =
    identity && Object.hasOwn(identity.grants, application)
      ? identity.grants[application]
      : undefined;
  if (
    !app ||
    !identity ||
    !granted?.length ||
    !app.requiredRoles.every((role) => granted.includes(role))
  )
    return null;
  return { identity: identity.id, roles: granted };
}
