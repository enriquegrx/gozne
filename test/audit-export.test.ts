import assert from 'node:assert/strict';
import test from 'node:test';
import { sealAudit, verifyAuditExport } from '../src/audit/export.js';
import type { AuditEvent } from '../src/audit/export.js';

const events: AuditEvent[] = [
  {
    sequence: 4,
    at: 1000,
    event: 'login.succeeded',
    identity: 'owner',
    sessionId: 'session-1',
    application: 'demo',
  },
  {
    sequence: 7,
    at: 2000,
    event: 'action.approved',
    identity: 'reviewer',
    sessionId: 'session-2',
    application: 'demo',
  },
];

test('audit exports have a deterministic chain and externally comparable digest', () => {
  const first = sealAudit(events);
  const second = sealAudit(structuredClone(events));
  assert.deepEqual(first, second);
  assert.equal(first.count, 2);
  assert.equal(first.firstSequence, 4);
  assert.equal(first.lastSequence, 7);
  assert.equal(first.events.at(-1)?.hash, first.finalDigest);
  assert.deepEqual(verifyAuditExport(first, first.finalDigest), {
    status: 'ok',
    count: 2,
    finalDigest: first.finalDigest,
  });
});

test('audit verification rejects edits, deletion, reordering and a foreign digest', () => {
  const original = sealAudit(events);
  for (const changed of [
    { ...structuredClone(original), count: 1 },
    { ...structuredClone(original), events: [original.events[1]] },
    {
      ...structuredClone(original),
      events: [...original.events].reverse(),
    },
    {
      ...structuredClone(original),
      events: original.events.map((event, index) =>
        index === 0 ? { ...event, identity: 'attacker' } : event,
      ),
    },
  ])
    assert.throws(() => verifyAuditExport(changed));
  assert.throws(() => verifyAuditExport(original, '0'.repeat(64)));
});

test('an empty audit export is still sealed and verifiable', () => {
  const empty = sealAudit([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.firstSequence, null);
  assert.equal(empty.lastSequence, null);
  assert.equal(verifyAuditExport(empty).finalDigest, empty.finalDigest);
});
