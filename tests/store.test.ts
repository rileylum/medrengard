// Ticket 02-a: a cycle's state survives a process restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { apply, defaultWorkflow, newCycle, type Cycle, type Event } from '../src/lifecycle.ts';
import { EventStore, UnclassifiableEvent, workflowHash } from '../src/store.ts';
import { PASS_CHECKS, scenarios, toStandardReview } from './scenarios.ts';
import { counters, noHuman, ownerCheck } from './workflows.ts';

const dir = mkdtempSync(join(tmpdir(), 'sf-store-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const dbPath = (name: string) => join(dir, `${name}.sqlite`);

const stage = (c: Cycle) => [c.stage, ...counters(c)];
const replay = (events: Event[], c: Cycle) => events.reduce((acc, e) => apply(acc, e), c);
// Everything but history: the store drops redelivered events at the door, while apply records
// them as "ignored", so the two histories differ by exactly those entries. Stage and counters are
// what the ticket requires to match.
const state = ({ history: _, ...rest }: Cycle) => rest;

test('events append to one SQLite table keyed by cycle', () => {
  const path = dbPath('append');
  const a = new EventStore(path);
  a.open('c1', 'w1');
  a.open('c2', 'w2');
  a.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  a.append('c2', { type: 'reject_dispatch', reason: 'nope' });
  a.append('c1', { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] });
  a.close();

  const b = new EventStore(path);
  assert.deepEqual(b.events('c1').map((e) => e.type), ['claim', 'developer_result']);
  assert.deepEqual(b.events('c2').map((e) => e.type), ['reject_dispatch']);
  assert.deepEqual(b.events('missing'), []);
  assert.equal(b.load('missing'), undefined);
  assert.throws(() => b.append('missing', { type: 'cancel' }), /not open/);
  b.close();
});

test('opening a cycle twice throws and leaves its log intact', () => {
  const store = new EventStore(dbPath('reopen'));
  store.open('c1', 'w1');
  store.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  assert.throws(() => store.open('c1', 'w1'), /already open/);
  assert.equal(store.events('c1').length, 1);
  assert.deepEqual(stage(store.load('c1')!), ['DEVELOPING', 0, 0]);
  store.close();
});

test('loading a cycle replays every SC scenario (minus the five todo ones) to the same state as the in-memory run', () => {
  const store = new EventStore(dbPath('replay'));
  for (const s of scenarios) {
    // One work item per scenario: open refuses a second open cycle for the same work (05-a).
    const expected = replay(s.events, newCycle(s.name, s.name));
    assert.equal(expected.stage, s.stage, `${s.name} scenario data matches lifecycle tests`);
    store.open(s.name, s.name);
    for (const e of s.events) store.append(s.name, e);
    assert.deepEqual(state(store.load(s.name)!), state(expected), s.name);
  }
  store.close();
  const reopened = new EventStore(dbPath('replay'));
  for (const s of scenarios) assert.deepEqual(state(reopened.load(s.name)!), state(replay(s.events, newCycle(s.name, s.name))), s.name);
  const child = reopened.open('child', 'SC-04', 'SC-04');
  assert.equal(child.parentCycleId, 'SC-04');
  assert.deepEqual(reopened.load('child'), child);
  reopened.close();
});

test('a process killed between two events reopens and continues from the last committed event', async () => {
  const path = dbPath('killed');
  const child = spawn(process.execPath, [join(import.meta.dirname, 'fixtures', 'writer.ts'), path], { stdio: ['ignore', 'pipe', 'inherit'] });
  const written = await new Promise<number>((resolve) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      // The writer prints one line per committed event; after the second one it would write a third, so kill it first.
      if (out.includes('2\n')) {
        child.kill('SIGKILL');
        resolve(2);
      }
    });
  });
  await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(written, 2);

  const store = new EventStore(path);
  assert.equal(store.events('c1').length, 2);
  assert.deepEqual(stage(store.load('c1')!), ['VERIFYING', 0, 0]);
  store.append('c1', { type: 'verification', head: 'H1', checks: [{ name: 'tests', result: 'PASS' }] });
  assert.deepEqual(stage(store.load('c1')!), ['STANDARD_REVIEW', 0, 0]);
  store.close();
});

test('a duplicate event with the same run ID written twice changes nothing', () => {
  const store = new EventStore(dbPath('dup'));
  store.open('c1', 'w1');
  const events: Event[] = [...toStandardReview, { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' }];
  let before: Cycle | undefined;
  for (const e of events) before = store.append('c1', e);
  assert.deepEqual(store.load('c1'), before);
  // A redelivery hands back the current Cycle, unchanged, so a caller cannot tell it from a no-op.
  assert.deepEqual(store.append('c1', { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' }), before);
  assert.deepEqual(store.append('c1', { type: 'developer_result', runId: 'dev1', head: 'H2', artifacts: ['r'] }), before);
  assert.deepEqual(store.load('c1'), before);
  assert.equal(store.events('c1').length, events.length);
  store.close();
});

test('append rejects an event apply cannot classify, before writing', () => {
  const store = new EventStore(dbPath('bogus'));
  store.open('c1', 'w1');
  store.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  const bad = [
    { type: 'bogus' },
    { type: 'open', workId: 'w9' },
    { type: 'claim', runId: 'dev2' },
    { type: 'developer_result', runId: 'dev1', head: 'H1' },
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'MAYBE' },
    { type: 'verification', head: 'H1' },
    { type: 'verification', head: 'H1', checks: [null] },
    { type: 'verification', head: 'H1', checks: [{ name: 'tests', result: 'OK' }] },
    { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: [null] },
    { type: 'toString' },
    { type: 'valueOf' },
    { type: 'hasOwnProperty' },
    { type: '__proto__' },
    'cancel',
    null,
    // Pass the in-memory shape but serialise to something else (02-b adversarial finding).
    (() => { const checks: unknown[] = []; checks[1] = { name: 't', result: 'PASS' }; return { type: 'verification', head: 'H1', checks }; })(),
    { type: 'cancel', toJSON: () => ({ type: 'bogus' }) },
    Object.assign([], { type: 'cancel' }),
    Object.assign(Object.create({ runId: 'x', base: 'B1' }), { type: 'claim' }),
  ];
  for (const e of bad) assert.throws(() => store.append('c1', e as unknown as Event), UnclassifiableEvent, JSON.stringify(e));
  assert.equal(store.events('c1').length, 1);
  assert.deepEqual(stage(store.load('c1')!), ['DEVELOPING', 0, 0]);
  store.append('c1', { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] });
  assert.deepEqual(stage(store.load('c1')!), ['VERIFYING', 0, 0]);
  store.close();
});

test('open and append reject empty or non-string IDs', () => {
  const store = new EventStore(dbPath('ids'));
  for (const id of ['', null, undefined, 1]) {
    assert.throws(() => store.open(id as unknown as string, 'w1'), /cycle ID/, String(id));
    assert.throws(() => store.open('c1', id as unknown as string), /work ID/, String(id));
    assert.throws(() => store.append(id as unknown as string, { type: 'cancel' }), /cycle ID/, String(id));
  }
  assert.equal(store.load(''), undefined);
  store.close();
});

test('store dedup matches apply: a redelivered claim reaches apply, results and verdicts do not', () => {
  // The 02-a adversarial reviewer's divergence sequence: claim dev2 is ignored while dev1 is active,
  // then legitimately accepted after the standard FAIL. Dropping it in the store escalated on replay.
  const events: Event[] = [
    { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' },
    { type: 'claim', runId: 'dev2', base: 'B1', runtime: 'fake' },
    { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] },
    { type: 'verification', head: 'H1', checks: PASS_CHECKS },
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'FAIL' },
    { type: 'claim', runId: 'dev2', base: 'B1', runtime: 'fake' },
    { type: 'developer_result', runId: 'dev2', head: 'H2', artifacts: ['r'] },
  ];
  const store = new EventStore(dbPath('dedup'));
  store.open('c1', 'w1');
  for (const e of events) store.append('c1', e);
  const expected = replay(events, newCycle('c1', 'w1'));
  assert.deepEqual(stage(expected), ['VERIFYING', 1, 0]);
  assert.deepEqual(stage(store.load('c1')!), stage(expected));
  // Redelivered claim after the second result: apply escalates (claim outside QUEUED); the store must not hide it.
  const redelivered: Event = { type: 'claim', runId: 'dev2', base: 'B1', runtime: 'fake' };
  assert.deepEqual(stage(store.append('c1', redelivered)), stage(apply(expected, redelivered)));
  store.close();
});

test('append returns the replayed Cycle, never one built from the caller\'s object (02-c parked)', () => {
  // new String('PASS') serialises to "PASS" but fails `=== 'PASS'` live: applying the object in
  // memory would count the verdict as a FAIL while replay counts it as a PASS.
  const store = new EventStore(dbPath('canonical'));
  store.open('c1', 'w1');
  for (const e of toStandardReview) store.append('c1', e);
  const wrapped = { type: 'verdict', runId: 'sr1', head: 'H1', verdict: new String('PASS') } as unknown as Event;
  const returned = store.append('c1', wrapped);
  assert.equal(returned.stage, 'ADVERSARIAL_REVIEW');
  assert.deepEqual(returned, store.load('c1'));
  // The divergence the finding describes: the live object reads as a FAIL.
  assert.equal(apply(replay(toStandardReview, newCycle('c1', 'w1')), wrapped).stage, 'DEVELOPING');
  store.close();
});

test('run IDs that differ only by a lone surrogate are two runs, not a duplicate (02-c parked)', () => {
  // SQLite stores an ill-formed string as U+FFFD, so two such IDs collide in the unique index
  // unless the index is keyed on the escaped JSON form.
  const store = new EventStore(dbPath('surrogate'));
  store.open('c1', 'w1');
  for (const e of toStandardReview) store.append('c1', e);
  store.append('c1', { type: 'verdict', runId: 'sr\uD800', head: 'H1', verdict: 'PASS' });
  const c = store.append('c1', { type: 'verdict', runId: 'sr\uDC00', head: 'H1', verdict: 'PASS' });
  assert.equal(c.stage, 'AWAITING_ACCEPTANCE');
  assert.equal(store.events('c1').length, toStandardReview.length + 2);
  for (const id of ['\uD800', 'c\uDC00']) {
    assert.throws(() => store.open(id, 'w1'), /well-formed/, JSON.stringify(id));
    assert.throws(() => store.open('c2', id), /well-formed/, JSON.stringify(id));
  }
  store.close();
});

test('one outcome per run: a run_failed after a consumed verdict or result is not written (04-b)', () => {
  const store = new EventStore(dbPath('one-outcome'));
  store.open('c1', 'w1');
  for (const e of toStandardReview) store.append('c1', e);
  const n = store.events('c1').length;
  // Result already consumed for dev1.
  assert.deepEqual(store.append('c1', { type: 'run_failed', runId: 'dev1', reason: 'cancelled' }), store.load('c1'));
  assert.equal(store.events('c1').length, n);
  const reviewed = store.append('c1', { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' });
  assert.equal(reviewed.stage, 'ADVERSARIAL_REVIEW');
  assert.deepEqual(store.append('c1', { type: 'run_failed', runId: 'sr1', reason: 'crash' }), reviewed);
  assert.equal(store.events('c1').length, n + 1);
  // And the other way round: a result after a run_failed for the same run is dropped too.
  const other = new EventStore(dbPath('one-outcome-2'));
  other.open('c1', 'w1');
  other.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  const failed = other.append('c1', { type: 'run_failed', runId: 'dev1', reason: 'timeout' });
  assert.deepEqual(other.append('c1', { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] }), failed);
  assert.equal(other.events('c1').length, 2);
  store.close();
  other.close();
});

test('open enforces one open cycle per work item and an ESCALATED parent (05-a, 02-b parked)', () => {
  const store = new EventStore(dbPath('guards'));
  store.open('c1', 'w1');
  assert.throws(() => store.open('c2', 'w1'), /w1 already has an open cycle c1/);
  assert.throws(() => store.open('c2', 'w2', 'nope'), /parent cycle nope not found/);
  assert.throws(() => store.open('c2', 'w2', 'c1'), /parent cycle c1 is QUEUED, not ESCALATED/);
  assert.equal(store.load('c2'), undefined);
  // ESCALATED is not open (spec: the parent stays ESCALATED beside its child): a child opens,
  // a sibling does not while the child is open.
  store.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  store.append('c1', { type: 'run_failed', runId: 'dev1', reason: 'timeout' });
  assert.throws(() => store.open('c2', 'w2', 'c1'), /parent cycle c1 belongs to work w1, not w2/);
  const child = store.open('c2', 'w1', 'c1');
  assert.equal(child.parentCycleId, 'c1');
  assert.throws(() => store.open('c3', 'w1', 'c1'), /already has an open cycle c2/);
  // Escalated and terminal cycles do not count as open, but an ESCALATED one must be named as the
  // parent (05-b): the spec's new cycle for the same work is a child.
  store.append('c2', { type: 'cancel' });
  assert.throws(() => store.open('c3', 'w1'), /work w1 has an ESCALATED cycle c1; name it as the parent/);
  store.open('c3', 'w1', 'c1');
  store.append('c3', { type: 'cancel' });
  store.open('c4', 'w3');
  store.close();
});

test('open enforces one open cycle per work item when two processes race (sweep-open-race)', async () => {
  const path = dbPath('race-open');
  new EventStore(path).close();
  const src = JSON.stringify(join(import.meta.dirname, '..', 'src', 'store.ts'));
  // Hold the write lock so both children run open's checks before either can write; node's
  // startup alone spaces two children too far apart to race.
  const lock = new DatabaseSync(path);
  lock.exec('BEGIN IMMEDIATE');
  const open = (cycleId: string) => new Promise<string>((done) => {
    const script = `import { EventStore } from ${src}; const s = new EventStore(${JSON.stringify(path)});
      try { s.open('${cycleId}', 'w1'); console.log('opened'); } catch (e) { console.log(e.message); }`;
    const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => done(out.trim()));
  });
  const both = Promise.all([open('c-a'), open('c-b')]);
  await new Promise((r) => setTimeout(r, 1500));
  lock.exec('COMMIT');
  lock.close();
  const results = await both;
  assert.equal(results.filter((r) => r === 'opened').length, 1, results.join(' | '));
  assert.equal(results.filter((r) => /w1 already has an open cycle c-[ab]/.test(r)).length, 1, results.join(' | '));
  const store = new EventStore(path);
  assert.equal(store.cycles('w1').length, 1);
  store.close();
});

test('a cycle whose row 0 is not the open marker fails to load, naming the cycle (07-d, parked 02-a)', async () => {
  const path = dbPath('row0');
  new EventStore(path).close();
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(path);
  raw.prepare('INSERT INTO events (cycle_id, seq, type, run_id, body) VALUES (?, 0, ?, NULL, ?)')
    .run('bad', 'cancel', JSON.stringify({ type: 'cancel' }));
  raw.close();
  const store = new EventStore(path);
  assert.throws(() => store.load('bad'), /cycle bad: row 0 is cancel, not the open marker/);
  store.close();
});

// Ticket 09-a: stores outlive the stage table they were written under.

test('a store written before the workflow engine still loads every cycle to its stage and counters', () => {
  // Written by src/store.ts and src/lifecycle.ts at dfaf0c9; copied so the committed file is never opened for writing.
  const path = dbPath('v1-fixture');
  copyFileSync(join(import.meta.dirname, 'fixtures', 'v1-store.sqlite'), path);
  const store = new EventStore(path);
  for (const s of scenarios) assert.deepEqual(stage(store.load(s.name)!), [s.stage, ...s.counters], s.name);
  store.close();
});

test('the store refuses a workflow checkWorkflow refuses, before creating anything', () => {
  const path = dbPath('refused-workflow');
  assert.throws(() => new EventStore(path, { ...noHuman, start: 'NOWHERE' }), /NOWHERE/);
  assert.equal(existsSync(path), false);
});

test('a store given another workflow replays its cycles under it', () => {
  const path = dbPath('no-human');
  const store = new EventStore(path, noHuman);
  store.open('c1', 'w1');
  for (const e of toStandardReview) store.append('c1', e);
  store.append('c1', { type: 'verdict', runId: 'rv1', head: 'H1', verdict: 'PASS' });
  store.close();
  const reopened = new EventStore(path, noHuman);
  assert.equal(reopened.load('c1')!.stage, 'ACCEPTED');
  reopened.close();
});

// Ticket 09-b: a cycle replays only under the workflow it was opened with (A-059).
const openRow = (path: string, cycleId: string) => {
  const db = new DatabaseSync(path);
  try { return JSON.parse((db.prepare('SELECT body FROM events WHERE cycle_id = ? AND seq = 0').get(cycleId) as { body: string }).body); } finally { db.close(); }
};

test('open records the workflow name and hash, and the cycle reloads under the same workflow', () => {
  const path = dbPath('record');
  const store = new EventStore(path, ownerCheck);
  store.open('c1', 'w1');
  store.close();
  assert.deepEqual(openRow(path, 'c1').workflow, { name: 'owner-check', hash: workflowHash(ownerCheck) });
  assert.match(workflowHash(ownerCheck), /^[0-9a-f]{64}$/);
  assert.notEqual(workflowHash(ownerCheck), workflowHash(defaultWorkflow));
  const reopened = new EventStore(path, ownerCheck);
  assert.equal(reopened.load('c1')!.stage, 'QUEUED');
  reopened.close();
});

// A-136 changed these two from A-059's refusal on load: the cycle loads under its own workflow,
// and only driving it with this store's stage table is refused.
test('a cycle opened under one workflow loads in a store running another, which refuses to drive it, naming both', () => {
  const path = dbPath('mismatch');
  const store = new EventStore(path);
  store.open('c1', 'w1');
  store.close();
  const other = new EventStore(path, ownerCheck);
  assert.equal(other.load('c1')!.stage, 'QUEUED');
  assert.throws(() => other.drivable('c1'), /c1 was opened under workflow default \([0-9a-f]{12}\).*owner-check \([0-9a-f]{12}\)/);
  // open's one-open-cycle guard now counts c1 as open, under its own workflow.
  assert.throws(() => other.open('c2', 'w1'), /w1 already has an open cycle c1/);
  other.close();
});

test('a store written before 09-b loads under the default workflow, and a store running another refuses to drive it', () => {
  const path = dbPath('v1-other');
  copyFileSync(join(import.meta.dirname, 'fixtures', 'v1-store.sqlite'), path);
  const [first] = scenarios;
  assert.equal(openRow(path, first!.name).workflow, undefined);
  const store = new EventStore(path, ownerCheck);
  assert.deepEqual(stage(store.load(first!.name)!), [first!.stage, ...first!.counters]);
  assert.throws(() => store.drivable(first!.name), /opened under workflow default/);
  store.close();
});

// Ticket 10-c: every store records this hash on open, so a change to defaultWorkflow refuses every
// cycle already opened under it. The literal was computed on main at c04b4b8; never update it to
// make this pass.
test('the default workflow hash is the one recorded before 10-c', () => {
  assert.equal(workflowHash(defaultWorkflow), '9ea6cdafca9addd7db5e8eec4bac8226b307546a4d88900d08775858f6de06c7');
});

// Ticket 11-c: a cycle replays under the workflow it was opened with (A-112 item 6, A-136).

test('a store running another workflow loads a cycle under its recorded definition', () => {
  const path = dbPath('recorded');
  const a = new EventStore(path, ownerCheck);
  a.open('c1', 'w1');
  a.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  a.close();
  const b = new EventStore(path);
  // DEV is a stage only ownerCheck has; the default workflow would read the claim as DEVELOPING.
  assert.equal(b.load('c1')!.stage, 'DEV');
  assert.deepEqual(b.cycles('w1'), [{ cycleId: 'c1', stage: 'DEV' }]);
  b.close();
});

test('a cycle whose recorded workflow neither its definition, the default nor the store matches is refused, naming both', () => {
  const path = dbPath('nothing-matches');
  new EventStore(path).close();
  const raw = new DatabaseSync(path);
  // A store written between 09-b and 10-d records the hash but not the definition.
  raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos) VALUES ('c1', 0, 'open', NULL, ?, 1)")
    .run(JSON.stringify({ type: 'open', workId: 'w1', workflow: { name: 'gone', hash: 'ab'.repeat(32) } }));
  raw.close();
  const store = new EventStore(path, ownerCheck);
  assert.throws(() => store.load('c1'), /c1 was opened under workflow gone \(abababababab\), this store runs owner-check/);
  assert.throws(() => store.drivable('c1'), /opened under workflow gone/);
  store.close();
});
