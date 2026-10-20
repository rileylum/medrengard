// Ticket 11-a: the owner's accept and cancel rules as functions, called in-process. main.test.ts
// still checks the commands end to end; these check the rules without spawning a process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Event } from '../src/lifecycle.ts';
import { EventStore } from '../src/store.ts';
import { acceptCycle, cancelWork } from '../src/decide.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-decide-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const H = 'a'.repeat(40);
const TO_ACCEPTANCE: Event[] = [
  { type: 'claim', runId: 'dev1', base: 'b'.repeat(40), runtime: 'fake' },
  { type: 'developer_result', runId: 'dev1', head: H, artifacts: ['x'] },
  { type: 'verification', head: H, checks: [{ name: 'ok', result: 'PASS' }] },
  { type: 'verdict', runId: 'std1', head: H, verdict: 'PASS', findings: [] },
  { type: 'verdict', runId: 'adv1', head: H, verdict: 'PASS', findings: [] },
];
const ESCALATE: Event[] = [
  { type: 'claim', runId: 'dev1', base: 'b'.repeat(40), runtime: 'fake' },
  { type: 'run_failed', runId: 'dev1', reason: 'timeout' },
];

let n = 0;
const where = { runsDir: '/runs', file: '/job.json' };
function fresh(): EventStore {
  return new EventStore(join(dir, `${n++}.sqlite`));
}
function seed(store: EventStore, cycleId: string, events: Event[], parent?: string) {
  store.open(cycleId, 'w', parent);
  for (const e of events) store.append(cycleId, e);
}

test('acceptCycle refuses with no store or no open cycle, naming the runs directory', () => {
  assert.throws(() => acceptCycle(undefined, 'w', H, 'owner', where), /^Error: no open cycle for work w in \/runs$/);
  const store = fresh();
  try {
    assert.throws(() => acceptCycle(store, 'w', H, 'owner', where), /^Error: no open cycle for work w in \/runs$/);
    // An ESCALATED cycle is not open: accept does not reach it.
    seed(store, 'c0', ESCALATE);
    assert.throws(() => acceptCycle(store, 'w', H, 'owner', where), /no open cycle/);
    assert.equal(store.events('c0').length, 2);
  } finally {
    store.close();
  }
});

test('acceptCycle refuses a cycle not at a human stage, and a SHA that is not the full candidate head', () => {
  const store = fresh();
  try {
    seed(store, 'c1', TO_ACCEPTANCE.slice(0, 3));
    assert.throws(() => acceptCycle(store, 'w', H, 'owner', where), /^Error: cycle c1 is STANDARD_REVIEW, not AWAITING_ACCEPTANCE$/);
    for (const e of TO_ACCEPTANCE.slice(3)) store.append('c1', e);
    const wrong = new RegExp(`^Error: \\S+ is not the candidate head ${H} of cycle c1 \\(/job\\.json\\)$`);
    assert.throws(() => acceptCycle(store, 'w', 'c'.repeat(40), 'owner', where), wrong);
    assert.throws(() => acceptCycle(store, 'w', H.slice(0, 7), 'owner', where), wrong);
    assert.equal(store.events('c1').length, 5);
  } finally {
    store.close();
  }
});

test('acceptCycle records accept with its source and returns the cycle after it', () => {
  const store = fresh();
  try {
    seed(store, 'c1', TO_ACCEPTANCE);
    const after = acceptCycle(store, 'w', H, 'tracker', where);
    assert.equal(after.cycleId, 'c1');
    assert.equal(after.stage, 'ACCEPTED');
    assert.deepEqual(store.events('c1').at(-1), { type: 'accept', head: H, source: 'tracker' });
  } finally {
    store.close();
  }
});

test('cancelWork refuses with no store or nothing to cancel, naming the runs directory', () => {
  assert.throws(() => cancelWork(undefined, 'w', 'owner', where), /^Error: nothing to cancel for work w in \/runs$/);
  const store = fresh();
  try {
    assert.throws(() => cancelWork(store, 'w', 'owner', where), /^Error: nothing to cancel for work w in \/runs$/);
  } finally {
    store.close();
  }
});

test('cancelWork takes the open cycle, leaving ESCALATED ones, else every ESCALATED cycle', () => {
  const store = fresh();
  try {
    seed(store, 'c1', ESCALATE);
    seed(store, 'c2', TO_ACCEPTANCE.slice(0, 3), 'c1');
    const open = cancelWork(store, 'w', 'owner', where);
    assert.deepEqual(open.map((c) => [c.cycleId, c.stage]), [['c2', 'CANCELLED']]);
    assert.equal(store.load('c1')!.stage, 'ESCALATED');

    seed(store, 'c3', ESCALATE, 'c1');
    const escalated = cancelWork(store, 'w', 'bot', where);
    assert.deepEqual(escalated.map((c) => [c.cycleId, c.stage]).sort(), [['c1', 'CANCELLED'], ['c3', 'CANCELLED']]);
    assert.deepEqual(store.events('c3').at(-1), { type: 'cancel', source: 'bot' });
  } finally {
    store.close();
  }
});
