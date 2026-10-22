// Ticket 02-a: a cycle's state survives a process restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { apply, defaultWorkflow, newCycle, type Cycle, type Event } from '../src/lifecycle.ts';
import { EventStore, ReplayDiverged, SETTLED, StaleLoad, UnclassifiableEvent, workflowHash } from '../src/store.ts';
import type { Workflow } from '../src/lifecycle.ts';
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
  // An append applies the cycle's own table too: under the default's, the result would reach VERIFYING.
  assert.equal(b.append('c1', { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] }).stage, 'CHECK');
  b.close();
  const c = new EventStore(path);
  assert.equal(c.load('c1')!.stage, 'CHECK');
  c.close();
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

// G9 (engine.md): a rule added to checkWorkflow later must not make an old cycle unloadable.
// A line break in role text stands in for such a rule: checkWorkflow refuses it, apply never reads it.
const tightened: Workflow = { ...ownerCheck, name: 'tightened', stages: { ...ownerCheck.stages, DEV: { ...ownerCheck.stages.DEV!, roleText: 'two\nlines' } as Workflow['stages'][string] } };

test('a recorded definition that checkWorkflow now refuses still loads, and no new store runs it', () => {
  const path = dbPath('tightened');
  new EventStore(path).close();
  const raw = new DatabaseSync(path);
  raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos) VALUES ('c1', 0, 'open', NULL, ?, 1)")
    .run(JSON.stringify({ type: 'open', workId: 'w1', workflow: { name: 'tightened', hash: workflowHash(tightened) }, definition: tightened }));
  raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos) VALUES ('c1', 1, 'claim', NULL, ?, 2)")
    .run(JSON.stringify({ type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' }));
  raw.close();
  const store = new EventStore(path);
  assert.equal(store.load('c1')!.stage, 'DEV');
  store.close();
  assert.throws(() => new EventStore(path, tightened), /workflow refused: stage DEV role text must be one line/);
});

test('a recorded definition apply could not run is refused on load', () => {
  const path = dbPath('broken-definition');
  new EventStore(path).close();
  const broken = { ...ownerCheck, name: 'broken', stages: { ...ownerCheck.stages, CHECK: { kind: 'command', transitions: { PASS: 'NOWHERE' } } } } as Workflow;
  const raw = new DatabaseSync(path);
  raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos) VALUES ('c1', 0, 'open', NULL, ?, 1)")
    .run(JSON.stringify({ type: 'open', workId: 'w1', workflow: { name: 'broken', hash: workflowHash(broken) }, definition: broken }));
  raw.close();
  const store = new EventStore(path);
  assert.throws(() => store.load('c1'), /c1 was opened under workflow broken/);
  store.close();
});

// A-123 item 2: each row keeps the stage apply gave it, so an engine change that would move an
// old cycle is refused, not replayed silently (engine.md G8).
test('a row whose stored stage the replay no longer gives refuses the cycle, naming the row, both stages and the engine', () => {
  const path = dbPath('diverged');
  const store = new EventStore(path);
  store.open('c1', 'w1');
  store.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  store.append('c1', { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] });
  // What a changed apply looks like from here: the log says one thing, the replay another.
  const raw = new DatabaseSync(path);
  raw.prepare("UPDATE events SET stage = 'ACCEPTED' WHERE cycle_id = 'c1' AND seq = 1").run();
  raw.close();
  assert.throws(() => store.load('c1'), (e: Error) => e instanceof ReplayDiverged && /^cycle c1 row 1 \(claim\) was recorded at ACCEPTED, but replays to DEVELOPING under engine 1 \(opened under engine 1\)/.test(e.message));
  assert.throws(() => store.append('c1', { type: 'cancel' }), ReplayDiverged);
  store.close();
});

test('open records the engine version that opened the cycle', () => {
  const path = dbPath('engine');
  const store = new EventStore(path);
  store.open('c1', 'w1');
  store.close();
  assert.equal(openRow(path, 'c1').engine, 1);
  const raw = new DatabaseSync(path, { readOnly: true });
  assert.equal(raw.prepare("SELECT stage FROM events WHERE cycle_id = 'c1' AND seq = 0").get()!.stage, 'QUEUED');
  raw.close();
});

test('an open row whose stored stage is not QUEUED refuses the cycle, naming row 0', () => {
  const path = dbPath('diverged-open');
  const store = new EventStore(path);
  store.open('c1', 'w1');
  const raw = new DatabaseSync(path);
  raw.prepare("UPDATE events SET stage = 'ACCEPTED' WHERE cycle_id = 'c1' AND seq = 0").run();
  raw.close();
  assert.throws(() => store.load('c1'), (e: Error) => e instanceof ReplayDiverged && /^cycle c1 row 0 \(open\) was recorded at ACCEPTED, but replays to QUEUED/.test(e.message));
  store.close();
});

test('two processes appending to one cycle at once store the stages the final log replays to', async () => {
  const src = JSON.stringify(join(import.meta.dirname, '..', 'src', 'store.ts'));
  for (let round = 0; round < 3; round++) {
    const path = dbPath(`race-append-${round}`);
    const store = new EventStore(path);
    store.open('c1', 'w1');
    store.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
    store.close();
    // The result moves the cycle to VERIFYING; the head change is ignored while the developer
    // writes, and escalates once the cycle verifies. Whichever lands second must be stored with
    // the stage it gives after the first.
    const events = [
      { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] },
      { type: 'head_changed', head: 'H2' },
    ];
    // Holding the write lock lets both children load before either writes, as in the open race.
    const lock = new DatabaseSync(path);
    lock.exec('BEGIN IMMEDIATE');
    const append = (event: object) => new Promise<string>((done) => {
      const script = `import { EventStore } from ${src}; const s = new EventStore(${JSON.stringify(path)});
        try { s.append('c1', ${JSON.stringify(event)}); console.log('appended'); } catch (e) { console.log(e.message); }`;
      const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', () => done(out.trim()));
    });
    const both = Promise.all(events.map(append));
    await new Promise((r) => setTimeout(r, 1500));
    lock.exec('COMMIT');
    lock.close();
    assert.deepEqual(await both, ['appended', 'appended']);
    const after = new EventStore(path);
    assert.equal(after.events('c1').length, 3);
    assert.ok(['VERIFYING', 'ESCALATED'].includes(after.load('c1')!.stage), after.load('c1')!.stage);
    after.close();
  }
});

test('a store written before 11-c gains the stage column and still loads and appends every cycle', () => {
  const path = dbPath('v2-stages');
  copyFileSync(join(import.meta.dirname, 'fixtures', 'v2-store.sqlite'), path);
  const before = new DatabaseSync(path, { readOnly: true });
  const ids = before.prepare('SELECT cycle_id FROM events WHERE seq = 0').all().map((r) => r.cycle_id as string);
  assert.equal(before.prepare("SELECT 1 FROM pragma_table_info('events') WHERE name = 'stage'").get(), undefined);
  before.close();
  // Written before 10-d, its owner-check cycles carry no definition: only a store running owner-check reads them.
  const stores = [new EventStore(path), new EventStore(path, ownerCheck)];
  // The old rows stay unchecked: a backfill from today's apply would vouch for whatever it says.
  const check = new DatabaseSync(path, { readOnly: true });
  assert.equal(check.prepare('SELECT COUNT(stage) AS staged FROM events').get()!.staged, 0);
  check.close();
  for (const id of ids) {
    const store = stores[id.startsWith('o') ? 1 : 0]!;
    const stage = store.load(id)!.stage;
    // cancel settles anything but a terminal cycle; ESCALATED is settled, not terminal.
    assert.equal(store.append(id, { type: 'cancel' }).stage, SETTLED.includes(stage) && stage !== 'ESCALATED' ? stage : 'CANCELLED', id);
    store.load(id);
  }
  for (const s of stores) s.close();
});

// For recover (11-f): every cycle that may still move, whichever work or workflow it belongs to.
test('unsettled lists every cycle not settled across work IDs, and a cycle it cannot replay with the reason', () => {
  const path = dbPath('unsettled');
  const a = new EventStore(path, ownerCheck);
  a.open('c1', 'w1');
  a.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  a.close();
  const store = new EventStore(path);
  store.open('c2', 'w2');
  store.append('c2', { type: 'cancel' });
  store.open('c3', 'w3');
  store.append('c3', { type: 'reject_dispatch', reason: 'no' });
  store.open('c4', 'w4');
  store.open('c5', 'w5');
  store.append('c5', { type: 'claim', runId: 'dev5', base: 'B1', runtime: 'fake' });
  const raw = new DatabaseSync(path);
  raw.prepare("UPDATE events SET stage = 'ACCEPTED' WHERE cycle_id = 'c5' AND seq = 1").run();
  raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos) VALUES ('c6', 0, 'open', NULL, ?, 100)")
    .run(JSON.stringify({ type: 'open', workId: 'w6', workflow: { name: 'gone', hash: 'ab'.repeat(32) } }));
  raw.close();
  assert.deepEqual(store.unsettled(), [
    { cycleId: 'c1', workId: 'w1', stage: 'DEV' },
    { cycleId: 'c3', workId: 'w3', stage: 'ESCALATED' },
    { cycleId: 'c4', workId: 'w4', stage: 'QUEUED' },
    { cycleId: 'c5', workId: 'w5', refused: 'cycle c5 row 1 (claim) was recorded at ACCEPTED, but replays to DEVELOPING under engine 1 (opened under engine 1); the cycle is not driven' },
    { cycleId: 'c6', workId: 'w6', refused: `cycle c6 was opened under workflow gone (abababababab), this store runs default (${workflowHash(defaultWorkflow).slice(0, 12)})` },
  ]);
  store.close();
});

test('unsettled lists a cycle whose row 0 cannot be read, and still lists the rest', () => {
  const path = dbPath('unsettled-raw');
  const store = new EventStore(path);
  store.open('c2', 'w2');
  const raw = new DatabaseSync(path);
  raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos) VALUES ('c1', 0, 'open', NULL, 'null', 10)").run();
  raw.prepare("INSERT INTO events (cycle_id, seq, type, run_id, body, pos) VALUES ('c3', 0, 'open', NULL, 'not json', 11)").run();
  raw.close();
  const listed = store.unsettled();
  assert.deepEqual(listed.map((u) => [u.cycleId, u.stage ?? 'refused']), [['c1', 'refused'], ['c2', 'QUEUED'], ['c3', 'refused']]);
  assert.match(listed[0]!.refused!, /^cycle c1: row 0 is /);
  assert.match(listed[2]!.refused!, /^cycle c3: row 0 is not JSON/);
  store.close();
});

// A-137: a workflow keeps its name across edits, so only the hash tells an old cycle's table from today's.
test('drivable refuses a cycle opened under an earlier edit of a workflow with the same name', () => {
  const path = dbPath('same-name');
  const before = new EventStore(path, ownerCheck);
  before.open('c1', 'w1');
  before.close();
  const edited: Workflow = { ...ownerCheck, stages: { ...ownerCheck.stages, REVIEW: { ...ownerCheck.stages.REVIEW!, budget: 2 } as Workflow['stages'][string] } };
  assert.equal(edited.name, ownerCheck.name);
  const after = new EventStore(path, edited);
  assert.equal(after.load('c1')!.stage, 'QUEUED');
  assert.throws(() => after.drivable('c1'), new RegExp(`opened under workflow owner-check \\(${workflowHash(ownerCheck).slice(0, 12)}\\), this store runs owner-check \\(${workflowHash(edited).slice(0, 12)}\\)`));
  after.close();
});

test('several processes opening one store written before 11-c at once all succeed (A-137)', async () => {
  const path = dbPath('race-stages');
  new EventStore(path).close();
  // A store written between 10-d and 11-c: positions, no stage column.
  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE events DROP COLUMN stage');
  old.close();
  const src = JSON.stringify(join(import.meta.dirname, '..', 'src', 'store.ts'));
  // Hold the write lock so every child sees no stage column, then queues on the lock with the rest.
  const lock = new DatabaseSync(path);
  lock.exec('BEGIN IMMEDIATE');
  const openOne = () => new Promise<string>((done) => {
    const script = `import { EventStore } from ${src};
      try { new EventStore(${JSON.stringify(path)}).close(); console.log('opened'); } catch (e) { console.log(e.message); }`;
    const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => done(out.trim()));
  });
  const all = Promise.all([openOne(), openOne(), openOne(), openOne()]);
  await new Promise((r) => setTimeout(r, 1500));
  lock.exec('COMMIT');
  lock.close();
  assert.deepEqual(await all, ['opened', 'opened', 'opened', 'opened']);
});

// Ticket 11-d (A-123 item 1, A-132): events from outside a run are deduplicated by command ID,
// and a writer that decided on a loaded cycle is refused when the cycle has moved since.
test('a second event with the same command ID on one cycle writes nothing; on another cycle it is recorded (11-d)', () => {
  const store = new EventStore(dbPath('command-id'));
  store.open('c1', 'w1');
  store.open('c2', 'w2');
  for (const e of toStandardReview) store.append('c1', e);
  const before = store.append('c1', { type: 'head_changed', head: 'H1', commandId: 'obs:7' });
  assert.equal(store.events('c1').length, toStandardReview.length + 1);
  // A redelivery with another head would escalate the cycle; deduplicated, it returns the cycle as it was.
  assert.deepEqual(store.append('c1', { type: 'head_changed', head: 'H9', commandId: 'obs:7' }), before);
  assert.deepEqual(store.load('c1'), before);
  assert.equal(store.events('c1').length, toStandardReview.length + 1);
  // One command may cancel several cycles under one ID.
  assert.equal(store.append('c2', { type: 'cancel', commandId: 'obs:7' }).stage, 'CANCELLED');
  // Without an ID nothing is deduplicated.
  store.append('c1', { type: 'head_changed', head: 'H1' });
  store.append('c1', { type: 'head_changed', head: 'H1' });
  assert.equal(store.events('c1').length, toStandardReview.length + 3);
  store.close();
});

test('a command ID and a run ID with the same text are two keys, not a duplicate (11-d)', () => {
  const store = new EventStore(dbPath('command-run-keys'));
  store.open('c1', 'w1');
  for (const e of toStandardReview) store.append('c1', e);
  for (const id of ['sr1', '{"commandId":"sr1"}']) store.append('c1', { type: 'head_changed', head: 'H1', commandId: id });
  assert.equal(store.append('c1', { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' }).stage, 'ADVERSARIAL_REVIEW');
  assert.equal(store.append('c1', { type: 'verdict', runId: '{"commandId":"sr1"}', head: 'H1', verdict: 'PASS' }).stage, 'AWAITING_ACCEPTANCE');
  assert.equal(store.events('c1').length, toStandardReview.length + 4);
  store.close();
});

test('a redelivered rejection under its command ID never reaches a candidate nobody has read (11-d, engine.md G7)', () => {
  const backToDev = { ...ownerCheck, stages: { ...ownerCheck.stages, REVIEW: { ...ownerCheck.stages.REVIEW, budget: 2 }, OWNER: { kind: 'human', transitions: { PASS: 'ACCEPTED', FAIL: 'DEV' } } } } as Workflow;
  const store = new EventStore(dbPath('g7'), backToDev);
  store.open('c1', 'w1');
  const reach = (n: number, head: string): Event[] => [
    { type: 'claim', runId: `dev${n}`, base: 'B1', runtime: 'fake' },
    { type: 'developer_result', runId: `dev${n}`, head, artifacts: ['r'] },
    { type: 'verification', head, checks: PASS_CHECKS },
    { type: 'verdict', runId: `rev${n}`, head, verdict: 'PASS' },
  ];
  for (const e of reach(1, 'H1')) store.append('c1', e);
  assert.equal(store.append('c1', { type: 'request_changes', head: 'H1', commandId: 'tracker:1' }).stage, 'DEV');
  const second = reach(2, 'H2').slice(0, 3);
  for (const e of second) store.append('c1', e);
  const reviewing = store.load('c1')!;
  assert.equal(reviewing.stage, 'REVIEW');
  // The tracker redelivers its rejection of H1: the same ID writes nothing.
  assert.deepEqual(store.append('c1', { type: 'request_changes', head: 'H1', commandId: 'tracker:1' }), reviewing);
  store.close();
});

test('append refuses with StaleLoad, writing nothing, when the cycle has moved since the writer loaded it (11-d)', () => {
  const store = new EventStore(dbPath('stale'));
  store.open('c1', 'w1');
  const loaded = store.load('c1')!;
  store.append('c1', toStandardReview[0]!, { after: loaded.history.length });
  assert.throws(() => store.append('c1', toStandardReview[1]!, { after: loaded.history.length }), (err: Error) =>
    err instanceof StaleLoad && err.message === 'cycle c1 moved since it was loaded: 1 events, not 0; nothing was written');
  assert.equal(store.events('c1').length, 1);
  // Without `after`, as for run outcomes and cancel, nothing is compared.
  store.append('c1', toStandardReview[1]!);
  assert.equal(store.events('c1').length, 2);
  store.close();
});

test('two processes deciding on one load: one appends, the other gets StaleLoad and writes nothing (11-d, A-132)', async () => {
  const src = JSON.stringify(join(import.meta.dirname, '..', 'src', 'store.ts'));
  for (let round = 0; round < 3; round++) {
    const path = dbPath(`race-stale-${round}`);
    const store = new EventStore(path);
    store.open('c1', 'w1');
    for (const e of [...toStandardReview, { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' }, { type: 'verdict', runId: 'ar1', head: 'H1', verdict: 'PASS' }] as Event[]) store.append('c1', e);
    store.close();
    // Both load under the held lock and block at append's write; released together.
    const lock = new DatabaseSync(path);
    lock.exec('BEGIN IMMEDIATE');
    const accept = () => new Promise<string>((done) => {
      const script = `import { EventStore } from ${src}; const s = new EventStore(${JSON.stringify(path)});
        const after = s.drivable('c1').history.length;
        try { s.append('c1', { type: 'accept', head: 'H1' }, { after }); console.log('appended'); } catch (e) { console.log(e.constructor.name); }`;
      const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', () => done(out.trim()));
    });
    const both = Promise.all([accept(), accept()]);
    await new Promise((r) => setTimeout(r, 1500));
    lock.exec('COMMIT');
    lock.close();
    assert.deepEqual((await both).sort(), ['StaleLoad', 'appended']);
    const after = new EventStore(path);
    assert.equal(after.load('c1')!.stage, 'ACCEPTED');
    assert.equal(after.events('c1').filter((e) => e.type === 'accept').length, 1);
    after.close();
  }
});

test('every v1 and v2 fixture cycle replays to the stage it had before 11-d', () => {
  // Taken from the engine at f3f2a25 (main before 11-d). ENGINE_VERSION's rule: a change here needs a bump.
  const expected: Record<string, Record<string, string>> = {
    v1: { 'RF-01': 'ESCALATED', 'RF-02': 'ESCALATED', 'RT-01': 'ESCALATED', 'SC-01': 'ACCEPTED', 'SC-02': 'AWAITING_ACCEPTANCE', 'SC-03': 'ESCALATED', 'SC-04': 'ESCALATED', 'SC-05': 'ESCALATED', 'SC-06': 'ADVERSARIAL_REVIEW', 'SC-07': 'ESCALATED', 'SC-08': 'ESCALATED', 'SC-11': 'ESCALATED', 'SC-13': 'ESCALATED', 'SC-16': 'ESCALATED', 'SC-17': 'ESCALATED', 'SC-17b': 'ESCALATED', 'SC-18': 'ESCALATED', 'SC-19': 'ACCEPTED' },
    v2: { d1: 'DEVELOPING', o1: 'OWNER' },
  };
  for (const [name, stages] of Object.entries(expected)) {
    const path = dbPath(`${name}-engine`);
    copyFileSync(join(import.meta.dirname, 'fixtures', `${name}-store.sqlite`), path);
    const raw = new DatabaseSync(path, { readOnly: true });
    const ids = raw.prepare('SELECT cycle_id FROM events WHERE seq = 0 ORDER BY cycle_id').all().map((r) => r.cycle_id as string);
    raw.close();
    assert.deepEqual(ids, Object.keys(stages).sort(), name);
    const stores = [new EventStore(path), new EventStore(path, ownerCheck)];
    for (const id of ids) assert.equal(stores[name === 'v2' && id.startsWith('o') ? 1 : 0]!.load(id)!.stage, stages[id], `${name} ${id}`);
    for (const s of stores) s.close();
  }
});

test('only events from outside a run are deduplicated by command ID (11-d standard 1)', () => {
  const store = new EventStore(dbPath('command-id-types'));
  store.open('c1', 'w1');
  store.append('c1', { type: 'head_changed', head: 'H1', commandId: 'k' });
  // The controller's own events carry no command ID; one that does is not suppressed by it.
  const c = store.append('c1', { type: 'reject_dispatch', reason: 'x', commandId: 'k' } as Event);
  assert.equal(c.stage, 'ESCALATED');
  assert.equal(store.events('c1').length, 2);
  store.close();
});

test('a redelivered command is a no-op even when its load is stale (11-d standard 1)', () => {
  const store = new EventStore(dbPath('command-id-stale'));
  store.open('c1', 'w1');
  for (const e of toStandardReview) store.append('c1', e);
  const first = store.append('c1', { type: 'head_changed', head: 'H1', commandId: 'k' }, { after: toStandardReview.length });
  assert.deepEqual(store.append('c1', { type: 'head_changed', head: 'H1', commandId: 'k' }, { after: toStandardReview.length }), first);
  assert.equal(store.events('c1').length, toStandardReview.length + 1);
  store.close();
});

test('write reports whether the event was written: a duplicate outcome or command is not (11-d standard 2)', () => {
  const store = new EventStore(dbPath('record-written'));
  store.open('c1', 'w1');
  for (const e of toStandardReview) assert.equal(store.write('c1', e).written, true, e.type);
  const verdict: Event = { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' };
  const first = store.write('c1', verdict);
  assert.deepEqual([first.written, first.cycle.stage], [true, 'ADVERSARIAL_REVIEW']);
  assert.deepEqual(store.write('c1', verdict), { cycle: first.cycle, written: false });
  const command: Event = { type: 'head_changed', head: 'H1', commandId: 'k' };
  assert.equal(store.write('c1', command).written, true);
  assert.equal(store.write('c1', command, { after: 0 }).written, false);
  store.close();
});

// Ticket 11-d2 (A-114, A-139): an escalated cycle waits for the owner's move.
const ESCALATED_AT_VERIFYING: Event[] = [toStandardReview[0]!, toStandardReview[1]!, { type: 'verification', head: 'H1', checks: [{ name: 'tests', result: 'FAIL' }] }];
const RETRY: Event = { type: 'owner_decision', action: 'retry', head: 'H1', reason: 'flaky check' };

test('STOPPED is every stage no run acts on; SETTLED is the two nothing moves again, and unsettled lists an escalated cycle (11-d2)', async () => {
  const { STOPPED } = await import('../src/store.ts');
  assert.deepEqual([...STOPPED], ['ESCALATED', 'CANCELLED', 'ACCEPTED']);
  assert.deepEqual([...SETTLED].sort(), ['ACCEPTED', 'CANCELLED']);
  const store = new EventStore(dbPath('unsettled-escalated'));
  store.open('c1', 'w1');
  for (const e of ESCALATED_AT_VERIFYING) store.append('c1', e);
  assert.deepEqual(store.unsettled(), [{ cycleId: 'c1', workId: 'w1', stage: 'ESCALATED' }]);
  store.append('c1', { type: 'cancel' });
  assert.deepEqual(store.unsettled(), []);
  store.close();
});

test('a move is deduplicated by its command ID like any owner command (11-d2)', () => {
  const store = new EventStore(dbPath('move-command-id'));
  store.open('c1', 'w1');
  for (const e of ESCALATED_AT_VERIFYING) store.append('c1', e);
  const first = store.write('c1', { ...RETRY, commandId: 'k' } as Event);
  assert.deepEqual([first.written, first.cycle.stage], [true, 'VERIFYING']);
  assert.deepEqual(store.write('c1', { ...RETRY, commandId: 'k' } as Event), { cycle: first.cycle, written: false });
  store.close();
});

test('the store refuses a move on a cycle another cycle names as its parent, or while another cycle of the work is open, writing nothing (11-d2)', () => {
  const store = new EventStore(dbPath('move-family'));
  store.open('c1', 'w1');
  for (const e of ESCALATED_AT_VERIFYING) store.append('c1', e);
  store.open('c2', 'w1', 'c1');
  assert.throws(() => store.append('c1', RETRY), /^Error: cycle c1 is the parent of cycle c2; a move on it would give work w1 two live cycles; nothing was written$/);
  // Start over was chosen there: a settled child still holds the parent.
  store.append('c2', { type: 'cancel' });
  assert.throws(() => store.append('c1', RETRY), /cycle c1 is the parent of cycle c2/);
  assert.equal(store.events('c1').length, ESCALATED_AT_VERIFYING.length);
  // c3 escalates, c4 opens from c1: c3 has no child, but c4 is open.
  const other = new EventStore(dbPath('move-sibling'));
  other.open('c1', 'w1');
  other.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  other.append('c1', { type: 'run_failed', runId: 'dev1', reason: 'timeout' });
  other.open('c3', 'w1', 'c1');
  for (const e of ESCALATED_AT_VERIFYING) other.append('c3', e);
  other.open('c4', 'w1', 'c1');
  assert.throws(() => other.append('c3', RETRY), /^Error: work w1 has an open cycle c4; a move on cycle c3 would give it two live cycles; nothing was written$/);
  assert.equal(other.load('c3')!.stage, 'ESCALATED');
  other.append('c4', { type: 'cancel' });
  assert.equal(other.append('c3', RETRY).stage, 'VERIFYING');
  store.close();
  other.close();
});

test('a move on an open cycle reaches apply, which escalates it: the cycle is not its own sibling (11-d2, standard 1)', () => {
  const store = new EventStore(dbPath('move-open'));
  store.open('c1', 'w1');
  store.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  const moved = store.append('c1', RETRY);
  assert.deepEqual([moved.stage, moved.escalation], ['ESCALATED', 'owner_decision outside ESCALATED (in DEVELOPING)']);
  store.close();
});

test('a child open and a retry on its parent, from two processes at once: one lands, never both (11-d2)', async () => {
  const src = JSON.stringify(join(import.meta.dirname, '..', 'src', 'store.ts'));
  const seen = new Set<string>();
  for (let round = 0; round < 4; round++) {
    const path = dbPath(`race-move-${round}`);
    const store = new EventStore(path);
    store.open('c1', 'w1');
    for (const e of ESCALATED_AT_VERIFYING) store.append('c1', e);
    store.close();
    // Both load under the held lock and block at their write; released together.
    const lock = new DatabaseSync(path);
    lock.exec('BEGIN IMMEDIATE');
    const child = (body: string) => new Promise<string>((done) => {
      const script = `import { EventStore } from ${src}; const s = new EventStore(${JSON.stringify(path)});
        const after = s.drivable('c1').history.length;
        try { ${body} } catch (e) { console.log('refused'); }`;
      const p = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => done(out.trim()));
    });
    const both = Promise.all([
      child(`s.open('c2', 'w1', 'c1'); console.log('opened');`),
      child(`s.append('c1', ${JSON.stringify(RETRY)}, { after }); console.log('moved');`),
    ]);
    await new Promise((r) => setTimeout(r, 1500));
    lock.exec('COMMIT');
    lock.close();
    const results = await both;
    assert.deepEqual(results.filter((r) => r === 'refused').length, 1, results.join());
    const after = new EventStore(path);
    const c2 = after.load('c2');
    assert.equal(after.load('c1')!.stage, c2 ? 'ESCALATED' : 'VERIFYING', results.join());
    after.close();
    seen.add(results.join());
  }
  // Not asserted: which process wins is SQLite's choice; the log says which orders ran.
  console.log(`race orders seen: ${[...seen].join(' | ')}`);
});
