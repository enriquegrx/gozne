import { getAddress, verifyMessage } from 'ethers';
import { SiweMessage } from 'siwe';
import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  createSignInMessageText,
  verifySignIn,
} from '@solana/wallet-standard-util';

export type Network = 'evm' | 'solana';
export interface ChallengeFields {
  statement?: string;
  resources?: string[];
  nonce: string;
  application: string;
  network: Network;
  address: string;
  chain: string;
  origin: string;
  issuedAt: number;
  expiresAt: number;
}

export function canonicalAddress(network: Network, address: string): string {
  if (address !== address.trim()) throw new Error('Invalid address');
  if (network === 'evm') return getAddress(address);
  if (address.length < 32 || address.length > 44)
    throw new Error('Invalid address');
  const bytes = base58.decode(address);
  if (bytes.length !== 32 || base58.encode(bytes) !== address)
    throw new Error('Invalid address');
  const point = ed25519.Point.fromBytes(bytes, false);
  point.assertValidity();
  if (point.isSmallOrder() || !point.isTorsionFree())
    throw new Error('Invalid public key');
  return address;
}

export function signInInput(fields: ChallengeFields) {
  return {
    domain: new URL(fields.origin).host,
    address: fields.address,
    statement:
      fields.statement ??
      `Sign in to ${fields.application}. This does not request a transaction.`,
    uri: `${fields.origin}/`,
    version: '1',
    chainId: fields.chain,
    nonce: fields.nonce,
    issuedAt: new Date(fields.issuedAt).toISOString(),
    expirationTime: new Date(fields.expiresAt).toISOString(),
    notBefore: new Date(fields.issuedAt).toISOString(),
    resources: [
      `urn:gozne:application:${fields.application}`,
      ...(fields.resources ?? []),
    ],
  };
}

export function createMessage(fields: ChallengeFields): string {
  const input = signInInput(fields);
  return fields.network === 'evm'
    ? new SiweMessage({
        ...input,
        chainId: Number(fields.chain),
      }).prepareMessage()
    : createSignInMessageText(input);
}

export async function verifyProof(
  fields: ChallengeFields,
  message: string,
  signature: string,
  now: number,
): Promise<boolean> {
  try {
    if (
      now < fields.issuedAt ||
      now >= fields.expiresAt ||
      message !== createMessage(fields)
    )
      return false;
    if (fields.network === 'evm') {
      if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
      // Reject malformed EOA signatures before the SIWE library's recovery path, which logs recovery exceptions.
      if (verifyMessage(message, signature) !== fields.address) return false;
      const siwe = new SiweMessage(message);
      const result = await siwe.verify(
        {
          signature,
          domain: new URL(fields.origin).host,
          nonce: fields.nonce,
          time: new Date(now).toISOString(),
        },
        { suppressExceptions: true },
      );
      return (
        result.success &&
        siwe.address === fields.address &&
        siwe.chainId === Number(fields.chain) &&
        siwe.uri === `${fields.origin}/`
      );
    }
    if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
    const bytes = Buffer.from(signature, 'base64');
    if (bytes.length !== 64 || bytes.toString('base64') !== signature)
      return false;
    const publicKey = base58.decode(canonicalAddress('solana', fields.address));
    const signedMessage = new TextEncoder().encode(message);
    return (
      ed25519.verify(bytes, signedMessage, publicKey, { zip215: false }) &&
      verifySignIn(signInInput(fields), {
        account: {
          address: fields.address,
          publicKey,
          chains: [],
          features: [],
        },
        signature: bytes,
        signedMessage,
        signatureType: 'ed25519',
      })
    );
  } catch {
    return false;
  }
}
