import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { ConfigError } from '../config.js';

export interface AuditEvent {
  sequence: number;
  at: number;
  event: string;
  identity: string | null;
  sessionId: string | null;
  application: string | null;
}

interface SealedAuditEvent extends AuditEvent {
  hash: string;
}

export interface AuditExport {
  format: 'gozne-audit-v1';
  algorithm: 'sha256';
  count: number;
  firstSequence: number | null;
  lastSequence: number | null;
  finalDigest: string;
  events: SealedAuditEvent[];
}

const hex = /^[a-f0-9]{64}$/;
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const genesis = digest('gozne-audit-v1\n');
const eventHash = (previous: string, event: AuditEvent) =>
  digest(`gozne-audit-v1\n${previous}\n${JSON.stringify(event)}`);

export function sealAudit(events: AuditEvent[]): AuditExport {
  let previous = genesis;
  const sealed = events.map((event) => {
    const hash = eventHash(previous, event);
    previous = hash;
    return { ...event, hash };
  });
  return {
    format: 'gozne-audit-v1',
    algorithm: 'sha256',
    count: sealed.length,
    firstSequence: sealed.at(0)?.sequence ?? null,
    lastSequence: sealed.at(-1)?.sequence ?? null,
    finalDigest: previous,
    events: sealed,
  };
}

const record = (value: unknown): AuditEvent & { hash: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigError('Invalid audit event');
  const entry = value as Record<string, unknown>;
  if (
    Object.keys(entry).sort().join(',') !==
      'application,at,event,hash,identity,sequence,sessionId' ||
    !Number.isSafeInteger(entry.sequence) ||
    Number(entry.sequence) < 1 ||
    !Number.isSafeInteger(entry.at) ||
    Number(entry.at) < 0 ||
    typeof entry.event !== 'string' ||
    !entry.event ||
    (entry.identity !== null && typeof entry.identity !== 'string') ||
    (entry.sessionId !== null && typeof entry.sessionId !== 'string') ||
    (entry.application !== null && typeof entry.application !== 'string') ||
    typeof entry.hash !== 'string' ||
    !hex.test(entry.hash)
  )
    throw new ConfigError('Invalid audit event');
  return entry as unknown as AuditEvent & { hash: string };
};

export function verifyAuditExport(
  value: unknown,
  expectedDigest?: string,
): { status: 'ok'; count: number; finalDigest: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigError('Invalid audit export');
  const exportValue = value as Record<string, unknown>;
  if (
    Object.keys(exportValue).sort().join(',') !==
      'algorithm,count,events,finalDigest,firstSequence,format,lastSequence' ||
    exportValue.format !== 'gozne-audit-v1' ||
    exportValue.algorithm !== 'sha256' ||
    !Number.isSafeInteger(exportValue.count) ||
    Number(exportValue.count) < 0 ||
    !Array.isArray(exportValue.events) ||
    exportValue.events.length !== exportValue.count ||
    typeof exportValue.finalDigest !== 'string' ||
    !hex.test(exportValue.finalDigest) ||
    (exportValue.firstSequence !== null &&
      !Number.isSafeInteger(exportValue.firstSequence)) ||
    (exportValue.lastSequence !== null &&
      !Number.isSafeInteger(exportValue.lastSequence)) ||
    (expectedDigest !== undefined && !hex.test(expectedDigest))
  )
    throw new ConfigError('Invalid audit export');
  let previous = genesis;
  let priorSequence = 0;
  const events = exportValue.events.map(record);
  for (const { hash, ...event } of events) {
    if (event.sequence <= priorSequence || eventHash(previous, event) !== hash)
      throw new ConfigError('Audit chain verification failed');
    priorSequence = event.sequence;
    previous = hash;
  }
  if (
    exportValue.firstSequence !== (events.at(0)?.sequence ?? null) ||
    exportValue.lastSequence !== (events.at(-1)?.sequence ?? null) ||
    exportValue.finalDigest !== previous ||
    (expectedDigest !== undefined && expectedDigest !== previous)
  )
    throw new ConfigError('Audit digest verification failed');
  return { status: 'ok', count: events.length, finalDigest: previous };
}

export function verifyAuditFile(path: string, expectedDigest?: string) {
  if (statSync(path).size > 32 * 1024 * 1024)
    throw new ConfigError('Audit export is too large');
  try {
    return verifyAuditExport(
      JSON.parse(readFileSync(path, 'utf8')),
      expectedDigest,
    );
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError('Audit export is not valid JSON');
  }
}
