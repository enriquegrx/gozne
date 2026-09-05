import { ConfigError } from '../src/config.js';
import { identifier, readPolicyFile } from '../src/policy/policy.js';
import { canonicalAddress } from '../src/wallets/proofs.js';
import type { AuthStore } from '../src/auth/store.js';

export function administration(store: AuthStore, args: string[]): unknown {
  const [area, action, ...rest] = args;
  if (area === 'policy' && action === 'apply' && rest.length === 1)
    return { status: 'ok', ...store.applyPolicy(readPolicyFile(rest[0]!)) };
  if (area === 'session' && action === 'list' && !rest.length)
    return { sessions: store.listSessions() };
  if (
    area === 'session' &&
    action === 'revoke' &&
    rest.length === 1 &&
    /^[0-9a-f-]{36}$/.test(rest[0]!)
  )
    return { revoked: store.revoke(rest[0]!) };
  if (area === 'audit' && action === 'export' && !rest.length)
    return { events: store.exportAudit() };
  const current = store.policy();
  if (!current) throw new ConfigError('Apply a policy first');
  const policy = structuredClone(current.policy);
  if (area === 'policy' && action === 'export' && !rest.length) return policy;
  if (area === 'identity' && action === 'list' && !rest.length)
    return { identities: policy.identities };
  if (area === 'identity' && action === 'add' && rest.length === 1) {
    policy.identities.push({
      id: identifier(rest[0]),
      wallets: [],
      grants: {},
    });
  } else if (area === 'wallet' && action === 'attach' && rest.length === 3) {
    const [id, network, address] = rest;
    const identity = policy.identities.find((entry) => entry.id === id);
    if (!identity || (network !== 'evm' && network !== 'solana') || !address)
      throw new ConfigError('Invalid identity or network');
    let canonical: string;
    try {
      canonical = canonicalAddress(network, address);
    } catch {
      throw new ConfigError('Invalid wallet address');
    }
    identity.wallets.push({ network, address: canonical, enabled: true });
  } else if (area === 'wallet' && action === 'disable' && rest.length === 2) {
    const [network, address] = rest;
    if ((network !== 'evm' && network !== 'solana') || !address)
      throw new ConfigError('Invalid network');
    let canonical: string;
    try {
      canonical = canonicalAddress(network, address);
    } catch {
      throw new ConfigError('Invalid wallet address');
    }
    const wallet = policy.identities
      .flatMap((entry) => entry.wallets)
      .find(
        (entry) => entry.network === network && entry.address === canonical,
      );
    if (!wallet) throw new ConfigError('Wallet not found');
    wallet.enabled = false;
  } else {
    throw new ConfigError('Unknown administrative command or arguments');
  }
  return { status: 'ok', ...store.applyPolicy(policy, current.digest) };
}
