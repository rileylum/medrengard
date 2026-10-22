// Ticket 11-a: the owner's accept and cancel rules as functions, called in-process. main.test.ts
// still checks the commands end to end; these check the rules without spawning a process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apply, newCycle, type Event, type Workflow } from '../src/lifecycle.ts';
import { headGate } from '../src/verify.ts';
import type { Job } from '../src/developer.ts';
import { decideAndDrive, type Adapters } from '../src/run.ts';
import { ownerCheck } from './workflows.ts';
import { EventStore, StaleLoad } from '../src/store.ts';
import { acceptCycle, cancelWork, moveEvent, requestChangesEvent, type Move } from '../src/decide.ts';

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
function fresh(workflow?: Workflow): EventStore {
  return new EventStore(join(dir, `${n++}.sqlite`), workflow);
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

// Ticket 11-a2 (A-129, A-131): an owner's event, then the loop. Preflight and `ready` run only
// when the event leads to a stage the loop runs, and before the event is recorded.
const GRANT_AFTER_OWNER = {
  ...ownerCheck,
  stages: {
    ...ownerCheck.stages,
    OWNER: { kind: 'human', transitions: { PASS: 'MERGE', FAIL: 'ESCALATED' } },
    MERGE: { kind: 'command', run: [{ name: 'merge', command: ['true'] }], network: true, grants: ['github'], transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
  },
} as Workflow;
const AT_OWNER: Event[] = [
  { type: 'claim', runId: 'dev1', base: 'b'.repeat(40), runtime: 'fake' },
  { type: 'developer_result', runId: 'dev1', head: H, artifacts: ['x'] },
  { type: 'verification', head: H, checks: [{ name: 'ok', result: 'PASS' }] },
  { type: 'verdict', runId: 'rev1', head: H, verdict: 'PASS', findings: [] },
];
const ACCEPT: Event = { type: 'accept', head: H, source: 'owner' };
const none: Adapters = {};
const job: Job = { workId: 'w', ticket: 'x', repo: '/nowhere', checks: [] };

test('decideAndDrive records an event that leads to a stage no step runs, without calling ready', async () => {
  const store = fresh(ownerCheck);
  try {
    seed(store, 'c1', AT_OWNER);
    const r = await decideAndDrive(store, 'c1', ACCEPT, async () => { throw new Error('ready called'); });
    assert.equal(r.cycle.stage, 'ACCEPTED');
    assert.equal(r.driven, undefined);
    assert.deepEqual(store.events('c1').at(-1), ACCEPT);
  } finally {
    store.close();
  }
});

test('decideAndDrive records nothing when ready throws, or preflight refuses the stage the event leads to', async () => {
  const store = fresh(GRANT_AFTER_OWNER);
  try {
    seed(store, 'c1', AT_OWNER);
    await assert.rejects(decideAndDrive(store, 'c1', ACCEPT, async () => { throw new Error('no config'); }), /^Error: no config$/);
    // No grants given: the MERGE stage's grant is refused before the accept is written.
    const ready = async () => ({ adapters: none, job, opts: { deadlineMs: 1000, runsDir: dir } });
    await assert.rejects(decideAndDrive(store, 'c1', ACCEPT, ready), /^Error: stage MERGE asks for grant github, which no personal or job file gives$/);
    const unstartable = async () => ({ adapters: none, job, opts: { deadlineMs: 1000, runsDir: dir, sandbox: { backend: 'bwrap' as const, read: ['/nonexistent-sf-11a2'] } } });
    await assert.rejects(decideAndDrive(store, 'c1', ACCEPT, unstartable), /^Error: sandbox read path \/nonexistent-sf-11a2 does not exist$/);
    assert.equal(store.events('c1').length, AT_OWNER.length);
    assert.equal(store.load('c1')!.stage, 'OWNER');
  } finally {
    store.close();
  }
});

test('decideAndDrive records an event that escalates, without calling ready', async () => {
  // The refusals are acceptEvent's: given an event apply escalates on, the escalation is recorded.
  const store = fresh(GRANT_AFTER_OWNER);
  try {
    seed(store, 'c1', AT_OWNER);
    const r = await decideAndDrive(store, 'c1', { type: 'accept', head: 'c'.repeat(40), source: 'owner' }, async () => { throw new Error('ready called'); });
    assert.equal(r.cycle.stage, 'ESCALATED');
    assert.equal(r.driven, undefined);
  } finally {
    store.close();
  }
});

test('decideAndDrive prepares the loop for an agent stage after the human one, as for a command stage', async () => {
  const reviewAfterOwner = {
    ...ownerCheck,
    stages: {
      ...ownerCheck.stages,
      OWNER: { kind: 'human', transitions: { PASS: 'LAST', FAIL: 'ESCALATED' } },
      LAST: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 1, transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
    },
  } as Workflow;
  const store = fresh(reviewAfterOwner);
  try {
    seed(store, 'c1', AT_OWNER);
    let called = false;
    const ready = async () => { called = true; return { adapters: none, job, opts: { deadlineMs: 1000, runsDir: dir } }; };
    await assert.rejects(decideAndDrive(store, 'c1', ACCEPT, ready), /^Error: no adapter for role writer \(stage DEV\)$/);
    assert.ok(called);
    assert.equal(store.events('c1').length, AT_OWNER.length);
  } finally {
    store.close();
  }
});

// 11-a2 adversarial minor (A-132): what verify would refuse at the stage the event leads to is
// refused before the event is written, so a setup slip does not escalate an accepted cycle.
const roles = { writer: {}, reviewer: {} } as unknown as Adapters;
function grantFlow(run: unknown[], reviewed = true) {
  const stages: Record<string, unknown> = {
    ...ownerCheck.stages,
    REVIEW: { ...ownerCheck.stages.REVIEW },
    OWNER: { kind: 'human', transitions: { PASS: 'MERGE', FAIL: 'ESCALATED' } },
    MERGE: { kind: 'command', run, network: true, grants: ['github'], transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
  };
  if (!reviewed) {
    delete stages.REVIEW;
    stages.CHECK = { kind: 'command', transitions: { PASS: 'OWNER' } };
  }
  return { ...ownerCheck, stages } as Workflow;
}
/** grantFlow with a second review stage, SECURITY, between REVIEW and the owner. */
function twoReviewGrantFlow() {
  const w = grantFlow([{ name: 'merge', command: ['true'] }]);
  const stages = { ...w.stages, REVIEW: { ...w.stages.REVIEW, transitions: { PASS: 'SECURITY', FAIL: 'ESCALATED' } }, SECURITY: { ...w.stages.REVIEW, role: 'security' } } as Workflow['stages'];
  return { ...w, stages } as Workflow;
}

function grantFile(text: string) {
  const file = join(dir, `grant-${n++}`);
  writeFileSync(file, text);
  return { github: { variable: 'GH_TOKEN', file } };
}

test('a grant stage needs every review stage\'s last verdict to be a PASS; only an owner accept after a FAIL ships it (11-d2)', () => {
  const w = twoReviewGrantFlow();
  const store = fresh(w);
  try {
    seed(store, 'c1', [...AT_OWNER.slice(0, 4), { type: 'verdict', runId: 'sec1', head: H, verdict: 'FAIL', findings: ['f'] }]);
    assert.equal(store.load('c1')!.stage, 'ESCALATED');
    assert.throws(() => moveEvent(store, 'w', mv('route', { stage: 'MERGE' }), where), new RegExp(`^Error: stage MERGE holds a grant, but the last outcome of SECURITY is a FAIL for the candidate ${H}; an owner accept after it is the only way past$`));
    // Accept with risk: the owner routes to the human stage and accepts there, naming the head.
    const atOwner = store.append('c1', { type: 'owner_decision', action: 'route', head: H, reason: 'accepted with risk', stage: 'OWNER' });
    const merging = apply(atOwner, ACCEPT, w);
    assert.equal(merging.stage, 'MERGE');
    assert.doesNotThrow(() => headGate(merging, w));
    // Both reviews PASS: the usual way in.
    const passed = [...AT_OWNER.slice(0, 4), { type: 'verdict', runId: 'sec1', head: H, verdict: 'PASS', findings: [] }, ACCEPT] as Event[];
    const merged = passed.reduce((c, e) => apply(c, e, w), newCycle('c2', 'w'));
    assert.equal(merged.stage, 'MERGE');
    assert.doesNotThrow(() => headGate(merged, w));
  } finally {
    store.close();
  }
});

test('the grant rule reads each review stage\'s last verdict, and only an accept after the FAIL ships past it (11-d2)', () => {
  const merge = { kind: 'command', run: [{ name: 'merge', command: ['true'] }], network: true, grants: ['github'], transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } };
  const H2 = 'c'.repeat(40);
  // No human stage: a FAIL, a fix, then a PASS on the new head is the usual way into the grant stage.
  const direct = { ...ownerCheck, stages: { ...ownerCheck.stages, REVIEW: { ...ownerCheck.stages.REVIEW, budget: 2, transitions: { PASS: 'MERGE', FAIL: 'DEV' } }, MERGE: merge } } as Workflow;
  const fixed = ([...AT_OWNER.slice(0, 3), { type: 'verdict', runId: 'rev1', head: H, verdict: 'FAIL', findings: ['f'] },
    { type: 'claim', runId: 'dev2', base: 'b'.repeat(40), runtime: 'fake' }, { type: 'developer_result', runId: 'dev2', head: H2, artifacts: ['x'] },
    { type: 'verification', head: H2, checks: [{ name: 'ok', result: 'PASS' }] }, { type: 'verdict', runId: 'rev2', head: H2, verdict: 'PASS', findings: [] }] as Event[])
    .reduce((c, e) => apply(c, e, direct), newCycle('c1', 'w'));
  assert.equal(fixed.stage, 'MERGE');
  assert.doesNotThrow(() => headGate(fixed, direct));
  // The owner accepts, then a later review FAILs: that accept never saw the FAIL.
  const late = { ...ownerCheck, stages: { ...ownerCheck.stages, OWNER: { kind: 'human', transitions: { PASS: 'SECURITY', FAIL: 'ESCALATED' } },
    SECURITY: { ...ownerCheck.stages.REVIEW, role: 'security', transitions: { PASS: 'MERGE', FAIL: 'ESCALATED' } }, MERGE: merge } } as Workflow;
  const store = fresh(late);
  try {
    seed(store, 'c1', [...AT_OWNER, ACCEPT, { type: 'verdict', runId: 'sec1', head: H, verdict: 'FAIL', findings: ['f'] }]);
    assert.equal(store.load('c1')!.stage, 'ESCALATED');
    assert.throws(() => moveEvent(store, 'w', mv('route', { stage: 'MERGE' }), where), /the last outcome of SECURITY is a FAIL/);
  } finally {
    store.close();
  }
});

test('a failed check and the owner\'s request_changes count as a FAIL for the grant rule; the grant stage\'s own failed run does not (11-d2, standard 3)', () => {
  const merge = { kind: 'command', run: [{ name: 'merge', command: ['true'] }], network: true, grants: ['github'], transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } };
  const direct = { ...ownerCheck, stages: { ...ownerCheck.stages, CHECK: { kind: 'command', transitions: { PASS: 'REVIEW', FAIL: 'ESCALATED' } }, REVIEW: { ...ownerCheck.stages.REVIEW, transitions: { PASS: 'MERGE', FAIL: 'ESCALATED' } }, MERGE: merge } } as Workflow;
  const play = (w: Workflow, events: Event[]) => events.reduce((c, e) => apply(c, e, w), newCycle('c1', 'w'));
  const route = (stage: string): Event => ({ type: 'owner_decision', action: 'route', head: H, reason: 'review it anyway', stage });
  // The required check FAILs; a route past it and a review PASS reach the grant stage.
  const pastCheck = play(direct, [...AT_OWNER.slice(0, 2), { type: 'verification', head: H, checks: [{ name: 'ok', result: 'FAIL' }] }, route('REVIEW'), AT_OWNER[3]!]);
  assert.equal(pastCheck.stage, 'MERGE');
  assert.throws(() => headGate(pastCheck, direct), new RegExp(`^Error: stage MERGE holds a grant, but the last outcome of CHECK is a FAIL for the candidate ${H}; an owner accept after it is the only way past$`));
  // An accept recorded while escalated was never the owner's word at a human stage: it clears nothing.
  const ignoredAccept = play(direct, [...AT_OWNER.slice(0, 2), { type: 'verification', head: H, checks: [{ name: 'ok', result: 'FAIL' }] }, ACCEPT, route('REVIEW'), AT_OWNER[3]!]);
  assert.equal(ignoredAccept.stage, 'MERGE');
  assert.throws(() => headGate(ignoredAccept, direct), /the last outcome of CHECK is a FAIL/);
  // The owner asks for changes at the human stage, then a route skips to the grant stage.
  const w = grantFlow([{ name: 'merge', command: ['true'] }]);
  const rejected = play(w, [...AT_OWNER, { type: 'request_changes', head: H }, route('MERGE')]);
  assert.equal(rejected.stage, 'MERGE');
  assert.throws(() => headGate(rejected, w), /the last outcome of OWNER is a FAIL/);
  // The merge itself failed; a retry of it is a second attempt, not a way past a FAIL.
  const retried = play(w, [...AT_OWNER, ACCEPT, { type: 'verification', head: H, checks: [{ name: 'merge', result: 'FAIL' }] }, { type: 'owner_decision', action: 'retry', head: H, reason: 'the forge was down' }]);
  assert.equal(retried.stage, 'MERGE');
  assert.doesNotThrow(() => headGate(retried, w));
});

test('a FAIL counts for the grant rule only when an owner route landed after it: a path the workflow declares runs, direct or not (11-d2, adversarial)', () => {
  const grant = (PASS: string) => ({ kind: 'command', run: [{ name: 'post', command: ['true'] }], network: true, grants: ['github'], transitions: { PASS, FAIL: 'ESCALATED' } });
  const play = (w: Workflow, events: Event[]) => events.reduce((c, e) => apply(c, e, w), newCycle('c1', 'w'));
  const passes = (w: Workflow, events: Event[], stage: string) => {
    const c = play(w, events);
    assert.equal(c.stage, stage, c.escalation);
    assert.doesNotThrow(() => headGate(c, w));
  };
  // Advisory checks: a failed check goes on to the review, whose PASS leads to the grant stage.
  const advisory = { ...ownerCheck, stages: { ...ownerCheck.stages, CHECK: { kind: 'command', transitions: { PASS: 'REVIEW', FAIL: 'REVIEW' } }, REVIEW: { ...ownerCheck.stages.REVIEW, budget: 2, transitions: { PASS: 'MERGE', FAIL: 'ESCALATED' } }, MERGE: grant('ACCEPTED') } } as Workflow;
  const failedCheck: Event[] = [...AT_OWNER.slice(0, 2), { type: 'verification', head: H, checks: [{ name: 'ok', result: 'FAIL' }] }];
  passes(advisory, [...failedCheck, AT_OWNER[3]!], 'MERGE');
  // A retry reruns the stage the cycle escalated from; it skips nothing, so the declared path still runs.
  passes(advisory, [...failedCheck, { type: 'run_failed', runId: 'rev0', reason: 'timeout' }, { type: 'owner_decision', action: 'retry', head: H, reason: 'again' }, AT_OWNER[3]!], 'MERGE');
  // A route the cycle refused moved nothing, so it skipped nothing.
  passes(advisory, [...failedCheck, { type: 'run_failed', runId: 'rev0', reason: 'timeout' }, { type: 'owner_decision', action: 'route', head: H, reason: 'x', stage: 'NOPE' },
    { type: 'owner_decision', action: 'retry', head: H, reason: 'again' }, AT_OWNER[3]!], 'MERGE');
  // A FAIL that lands while escalated was never the review's, so a route after it skips nothing.
  passes(advisory, [...AT_OWNER.slice(0, 3), { type: 'reject_dispatch', reason: 'paused' }, { type: 'verdict', runId: 'late', head: H, verdict: 'FAIL', findings: ['f'] },
    { type: 'owner_decision', action: 'route', head: H, reason: 'review it again', stage: 'REVIEW' }, { type: 'verdict', runId: 'rev2', head: H, verdict: 'PASS', findings: [] }], 'MERGE');
  // The grant stage's own failed run, then a route back into it: a second attempt, as a retry is.
  passes(advisory, [...AT_OWNER.slice(0, 4), { type: 'verification', head: H, checks: [{ name: 'post', result: 'FAIL' }] },
    { type: 'owner_decision', action: 'route', head: H, reason: 'the forge was down', stage: 'MERGE' }], 'MERGE');
  // The owner's FAIL goes through a plain command stage to one that posts the feedback.
  const feedback = { ...ownerCheck, stages: { ...ownerCheck.stages, OWNER: { kind: 'human', transitions: { PASS: 'ACCEPTED', FAIL: 'NOTE' } }, NOTE: { kind: 'command', transitions: { PASS: 'POST' } }, POST: grant('ESCALATED') } } as Workflow;
  passes(feedback, [...AT_OWNER, { type: 'request_changes', head: H }, { type: 'verification', head: H, checks: [{ name: 'note', result: 'PASS' }] }], 'POST');
  // A FAIL the cycle has since passed: the stage's last outcome is a PASS, so a later route skips nothing.
  const w = grantFlow([{ name: 'merge', command: ['true'] }]);
  const twice = { ...w, stages: { ...w.stages, REVIEW: { ...w.stages.REVIEW, budget: 2, transitions: { PASS: 'OWNER', FAIL: 'DEV' } } } } as Workflow;
  const H2 = 'c'.repeat(40);
  passes(twice, [...AT_OWNER.slice(0, 3), { type: 'verdict', runId: 'rev1', head: H, verdict: 'FAIL', findings: ['f'] },
    { type: 'claim', runId: 'dev2', base: 'b'.repeat(40), runtime: 'fake' }, { type: 'developer_result', runId: 'dev2', head: H2, artifacts: ['x'] },
    { type: 'verification', head: H2, checks: [{ name: 'ok', result: 'PASS' }] }, { type: 'verdict', runId: 'rev2', head: H2, verdict: 'PASS', findings: [] },
    { type: 'reject_dispatch', reason: 'paused' }, { type: 'owner_decision', action: 'route', head: H2, reason: 'merge it', stage: 'MERGE' }], 'MERGE');
});

test('a move jumps when it enters a stage other than the one the cycle escalated from; a FAIL a jump skipped refuses the grant stage, whatever the move (11-d2, standard 4)', () => {
  const merge = { kind: 'command', run: [{ name: 'merge', command: ['true'] }], network: true, grants: ['github'], transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } };
  const flow = (stages: Record<string, unknown> = {}) => ({ name: 'p', start: 'DEV', stages: {
    DEV: { kind: 'agent', role: 'writer', produces: 'commit', roleText: 'w', transitions: { PASS: 'CHECK' } },
    CHECK: { kind: 'command', transitions: { PASS: 'REVIEW', FAIL: 'ESCALATED' } },
    REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'r', budget: 2, transitions: { PASS: 'MERGE', FAIL: 'ESCALATED' } },
    MERGE: merge, ...stages } }) as Workflow;
  const ok: Event = { type: 'verification', head: H, checks: [{ name: 'tests', result: 'PASS' }] };
  const bad: Event = { type: 'verification', head: H, checks: [{ name: 'tests', result: 'FAIL' }] };
  const verdict = (runId: string, v: 'PASS' | 'FAIL'): Event => ({ type: 'verdict', runId, head: H, verdict: v, findings: v === 'FAIL' ? ['f'] : [] });
  type Step = Event | { move: Move['action']; stage?: string };
  // Through the store and moveEvent, so every refusal before a write applies; then the gate verify runs.
  const gate = (w: Workflow, steps: Step[]) => {
    const store = fresh(w);
    try {
      seed(store, 'c1', AT_OWNER.slice(0, 2));
      for (const step of steps) {
        if (!('move' in step)) { store.append('c1', step); continue; }
        const d = moveEvent(store, 'w', mv(step.move, step.stage === undefined ? {} : { stage: step.stage }), where);
        store.append(d.cycleId, d.event, { after: d.after });
      }
      const c = store.load('c1')!;
      assert.equal(c.stage, 'MERGE', c.escalation);
      return () => headGate(c, w);
    } finally {
      store.close();
    }
  };
  const skipped = /^Error: stage MERGE holds a grant, but the last outcome of (CHECK|OWNER) is a FAIL for the candidate a{40}; an owner accept after it is the only way past$/;
  // An overrule from CHECK into REVIEW jumps past the check that FAILed after the review's FAIL.
  assert.throws(gate(flow(), [ok, verdict('r1', 'FAIL'), { move: 'route', stage: 'CHECK' }, bad, { move: 'overrule' }, verdict('r2', 'PASS')]), skipped);
  // The same with no route at all: the review's declared FAIL edge reruns the check.
  const back = flow({ REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'r', budget: 2, transitions: { PASS: 'MERGE', FAIL: 'CHECK' } } });
  assert.throws(gate(back, [ok, verdict('r1', 'FAIL'), bad, { move: 'overrule' }, verdict('r2', 'PASS')]), skipped);
  // The owner's request_changes upstream of the review, then an overrule into the review.
  const owner = flow({ CHECK: { kind: 'command', transitions: { PASS: 'OWNER', FAIL: 'ESCALATED' } }, OWNER: { kind: 'human', transitions: { PASS: 'REVIEW', FAIL: 'ESCALATED' } } });
  assert.throws(gate(owner, [ok, { type: 'accept', head: H }, verdict('r1', 'FAIL'), { move: 'route', stage: 'OWNER' }, { type: 'request_changes', head: H }, { move: 'overrule' }, verdict('r2', 'PASS')]), skipped);
  // A route forward past the check, as before.
  assert.throws(gate(flow(), [ok, verdict('r1', 'FAIL'), { move: 'route', stage: 'CHECK' }, bad, { move: 'route', stage: 'REVIEW' }, verdict('r2', 'PASS')]), skipped);
  // A route back into the stage the cycle escalated from skips nothing, as a retry does.
  const advisory = flow({ CHECK: { kind: 'command', transitions: { PASS: 'REVIEW', FAIL: 'REVIEW' } } });
  assert.doesNotThrow(gate(advisory, [bad, { type: 'run_failed', runId: 'r0', reason: 'timeout' }, { move: 'route', stage: 'REVIEW' }, verdict('r2', 'PASS')]));
  // Each move is judged by where the cycle stood when it landed: a later escalation from MERGE does not make the route back into REVIEW a jump.
  assert.doesNotThrow(gate(advisory, [bad, { type: 'run_failed', runId: 'r0', reason: 'timeout' }, { move: 'route', stage: 'REVIEW' }, verdict('r2', 'PASS'),
    { type: 'verification', head: H, checks: [{ name: 'merge', result: 'FAIL' }] }, { move: 'retry' }]));
  // A jump back to the review after the merge failed: the grant stage's own failed run is not a FAIL it skips.
  assert.doesNotThrow(gate(flow(), [ok, verdict('r1', 'PASS'), { type: 'verification', head: H, checks: [{ name: 'merge', result: 'FAIL' }] },
    { move: 'route', stage: 'REVIEW' }, verdict('r2', 'PASS')]));
  // A FAIL that lands while escalated was never the review's: a jump after it skips nothing.
  assert.doesNotThrow(gate(flow(), [ok, { type: 'reject_dispatch', reason: 'paused' }, verdict('late', 'FAIL'), { move: 'route', stage: 'CHECK' }, ok, verdict('r2', 'PASS')]));
  // A route back into the grant stage after its own run failed is a second attempt, as a retry is.
  assert.doesNotThrow(gate(advisory, [bad, verdict('r1', 'PASS'), { type: 'verification', head: H, checks: [{ name: 'merge', result: 'FAIL' }] }, { move: 'route', stage: 'MERGE' }]));
  // The usual overrule: the dispute escalates from the commit stage, the overrule reruns the review, whose PASS replaces its FAIL.
  const disputed = flow({ REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'r', budget: 2, transitions: { PASS: 'MERGE', FAIL: 'DEV' } } });
  assert.doesNotThrow(gate(disputed, [ok, verdict('r1', 'FAIL'), { type: 'claim', runId: 'dev2', base: 'b'.repeat(40), runtime: 'fake' },
    { type: 'dispute', runId: 'dev2', head: H, reason: 'the finding is wrong' }, { move: 'overrule' }, verdict('r2', 'PASS')]));
});

test('decideAndDrive refuses an empty grant file at the stage the event leads to, writing nothing', async () => {
  const store = fresh(grantFlow([{ name: 'merge', command: ['true'] }]));
  try {
    seed(store, 'c1', AT_OWNER);
    const grants = grantFile('\n');
    const ready = async () => ({ adapters: roles, job, opts: { deadlineMs: 1000, runsDir: dir, grants } });
    await assert.rejects(decideAndDrive(store, 'c1', ACCEPT, ready), new RegExp(`^Error: grant github: file ${grants.github.file} is empty$`));
    assert.equal(store.events('c1').length, AT_OWNER.length);
  } finally {
    store.close();
  }
});

test('decideAndDrive refuses a file argument missing from workflowDir, writing nothing', async () => {
  const store = fresh(grantFlow([{ name: 'merge', command: ['sh', { file: 'merge.sh' }] }]));
  try {
    seed(store, 'c1', AT_OWNER);
    const workflowDir = mkdtempSync(join(dir, 'flow-'));
    const ready = async () => ({ adapters: roles, job, opts: { deadlineMs: 1000, runsDir: dir, workflowDir, grants: grantFile('t\n') } });
    await assert.rejects(decideAndDrive(store, 'c1', ACCEPT, ready), new RegExp(`^Error: stage MERGE names file merge\\.sh, which is not a file in ${workflowDir}$`));
    assert.equal(store.events('c1').length, AT_OWNER.length);
  } finally {
    store.close();
  }
});

test('decideAndDrive refuses a grant stage the head gate would refuse after the event, writing nothing', async () => {
  const store = fresh(grantFlow([{ name: 'merge', command: ['true'] }], false));
  try {
    seed(store, 'c1', AT_OWNER.slice(0, 3));
    const ready = async () => ({ adapters: roles, job, opts: { deadlineMs: 1000, runsDir: dir, grants: grantFile('t\n') } });
    await assert.rejects(decideAndDrive(store, 'c1', ACCEPT, ready), new RegExp(`^Error: stage MERGE holds a grant, but no PASS verdict is for the candidate ${H}$`));
    assert.equal(store.events('c1').length, 3);
  } finally {
    store.close();
  }
});

// Ticket 11-d (A-123 item 1, A-132).
test('requestChangesEvent refuses as acceptEvent does, and returns request_changes for the head with the load it decided on', () => {
  assert.throws(() => requestChangesEvent(undefined, 'w', H, 'owner', where), /^Error: no open cycle for work w in \/runs$/);
  const store = fresh();
  try {
    seed(store, 'c1', TO_ACCEPTANCE.slice(0, 3));
    assert.throws(() => requestChangesEvent(store, 'w', H, 'owner', where), /^Error: cycle c1 is STANDARD_REVIEW, not AWAITING_ACCEPTANCE$/);
    for (const e of TO_ACCEPTANCE.slice(3)) store.append('c1', e);
    assert.throws(() => requestChangesEvent(store, 'w', 'c'.repeat(40), 'owner', where), new RegExp(`is not the candidate head ${H} of cycle c1`));
    assert.deepEqual(requestChangesEvent(store, 'w', H, 'tracker', where, 'gh:42'), {
      cycleId: 'c1', event: { type: 'request_changes', head: H, source: 'tracker', commandId: 'gh:42' }, after: TO_ACCEPTANCE.length,
    });
    assert.equal(store.events('c1').length, TO_ACCEPTANCE.length);
  } finally {
    store.close();
  }
});

test('acceptCycle and cancelWork record the command ID they are given', () => {
  const store = fresh();
  try {
    seed(store, 'c1', TO_ACCEPTANCE);
    acceptCycle(store, 'w', H, 'owner', where, 'cli:1');
    assert.deepEqual(store.events('c1').at(-1), { type: 'accept', head: H, source: 'owner', commandId: 'cli:1' });
    seed(store, 'c2', ESCALATE.slice(0, 1));
    cancelWork(store, 'w', 'owner', where, 'cli:2');
    assert.deepEqual(store.events('c2').at(-1), { type: 'cancel', source: 'owner', commandId: 'cli:2' });
  } finally {
    store.close();
  }
});

test('decideAndDrive refuses with StaleLoad, writing nothing, when another accept lands while it prepares the loop (A-132)', async () => {
  const flow = grantFlow([{ name: 'merge', command: ['true'] }]);
  const path = join(dir, `${n++}.sqlite`);
  const store = new EventStore(path, flow);
  const other = new EventStore(path, flow);
  try {
    seed(store, 'c1', AT_OWNER);
    const grants = grantFile('t\n');
    // The second command records its accept while the first is between its load and its append.
    const ready = async () => { acceptCycle(other, 'w', H, 'second', where); return { adapters: roles, job, opts: { deadlineMs: 1000, runsDir: dir, grants } }; };
    await assert.rejects(decideAndDrive(store, 'c1', ACCEPT, ready), (err: Error) => err instanceof StaleLoad && /^cycle c1 moved since it was loaded/.test(err.message));
    assert.deepEqual(store.events('c1').filter((e) => e.type === 'accept'), [{ type: 'accept', head: H, source: 'second' }]);
    assert.equal(store.load('c1')!.stage, 'MERGE');
  } finally {
    store.close();
    other.close();
  }
});

test('decideAndDrive appends with the load it is given, also when no loop stage follows', async () => {
  const store = fresh(ownerCheck);
  try {
    seed(store, 'c1', AT_OWNER);
    await assert.rejects(decideAndDrive(store, 'c1', ACCEPT, async () => { throw new Error('ready called'); }, AT_OWNER.length - 1), StaleLoad);
    assert.equal(store.events('c1').length, AT_OWNER.length);
    assert.equal((await decideAndDrive(store, 'c1', ACCEPT, async () => { throw new Error('ready called'); }, AT_OWNER.length)).cycle.stage, 'ACCEPTED');
  } finally {
    store.close();
  }
});

test('decideAndDrive drives nothing when its command was already recorded by another delivery (11-d standard 2)', async () => {
  const flow = grantFlow([{ name: 'merge', command: ['true'] }]);
  const path = join(dir, `${n++}.sqlite`);
  const store = new EventStore(path, flow);
  const other = new EventStore(path, flow);
  try {
    seed(store, 'c1', AT_OWNER);
    const grants = grantFile('t\n');
    const event: Event = { ...ACCEPT, commandId: 'same' };
    // The other delivery records the same command while this one prepares the loop.
    const ready = async () => { acceptCycle(other, 'w', H, 'owner', where, 'same'); return { adapters: roles, job, opts: { deadlineMs: 1000, runsDir: dir, grants } }; };
    const r = await decideAndDrive(store, 'c1', event, ready);
    assert.equal(r.written, false);
    assert.equal(r.driven, undefined);
    assert.equal(r.cycle.stage, 'MERGE');
    assert.deepEqual(store.events('c1').slice(AT_OWNER.length).map((e) => e.type), ['accept']);
  } finally {
    store.close();
    other.close();
  }
});

test('cancelWork appends with no after, so a cancel lands whatever came between its load and its write (11-d adversarial)', () => {
  const store = fresh();
  try {
    seed(store, 'c1', ESCALATE.slice(0, 1));
    const seen: unknown[] = [];
    const watched = new Proxy(store, {
      get: (target, key) => key === 'append' ? (cycleId: string, event: Event, opts?: unknown) => { seen.push(opts); return target.append(cycleId, event, opts as { after?: number }); } : Reflect.get(target, key, target),
    });
    cancelWork(watched, 'w', 'owner', where);
    assert.deepEqual(seen, [undefined]);
  } finally {
    store.close();
  }
});

// Ticket 11-d2 (A-114, A-139): the owner's moves. moveEvent refuses, writing nothing, what apply
// would only record with a note, and what the driver could not run.
const mv = (action: Move['action'], extra: Partial<Move> = {}): Move => ({ action, sha: H, reason: 'the owner read it', source: 'owner', ...extra });
const DISPUTED: Event[] = [
  ...TO_ACCEPTANCE.slice(0, 3),
  { type: 'verdict', runId: 'std1', head: H, verdict: 'FAIL', findings: ['f1'] },
  { type: 'claim', runId: 'dev2', base: 'b'.repeat(40), runtime: 'fake' },
  { type: 'dispute', runId: 'dev2', head: H, reason: 'the finding is wrong' },
];

test('moveEvent refuses with no store or no escalated cycle, naming the runs directory (11-d2)', () => {
  assert.throws(() => moveEvent(undefined, 'w', mv('retry'), where), /^Error: no escalated cycle for work w in \/runs$/);
  const store = fresh();
  try {
    seed(store, 'c1', TO_ACCEPTANCE.slice(0, 3));
    assert.throws(() => moveEvent(store, 'w', mv('retry'), where), /^Error: no escalated cycle for work w in \/runs$/);
    assert.equal(store.events('c1').length, 3);
  } finally {
    store.close();
  }
});

test('moveEvent returns the move for the candidate head with the load it decided on (11-d2)', () => {
  const store = fresh();
  try {
    seed(store, 'c1', DISPUTED);
    assert.deepEqual(moveEvent(store, 'w', mv('overrule', { source: 'bot', commandId: 'k' }), where), {
      cycleId: 'c1', after: DISPUTED.length,
      event: { type: 'owner_decision', action: 'overrule', head: H, reason: 'the owner read it', source: 'bot', commandId: 'k' },
    });
    assert.deepEqual(moveEvent(store, 'w', mv('route', { stage: 'VERIFYING' }), where).event,
      { type: 'owner_decision', action: 'route', head: H, reason: 'the owner read it', stage: 'VERIFYING', source: 'owner' });
    assert.equal(store.events('c1').length, DISPUTED.length);
  } finally {
    store.close();
  }
});

test('moveEvent refuses a head other than the candidate, a spent budget, and a stage that is not the workflow\'s (11-d2)', () => {
  const store = fresh();
  try {
    seed(store, 'c1', DISPUTED);
    assert.throws(() => moveEvent(store, 'w', mv('retry', { sha: 'c'.repeat(40) }), where), new RegExp(`^Error: cycle c1 \\(/job.json\\): move refused: ${'c'.repeat(40)} is not the candidate head ${H}$`));
    for (const stage of ['ESCALATED', 'NOPE']) assert.throws(() => moveEvent(store, 'w', mv('route', { stage }), where), new RegExp(`move refused: ${stage} is not a workflow stage$`));
    assert.throws(() => moveEvent(store, 'w', mv('overrule', { reason: '' }), where), /^Error: a move needs a reason$/);
    const spent = fresh();
    seed(spent, 'c1', [...TO_ACCEPTANCE.slice(0, 3), { type: 'verdict', runId: 'std1', head: H, verdict: 'FAIL' }, { type: 'claim', runId: 'dev2', base: 'b'.repeat(40), runtime: 'fake' },
      { type: 'developer_result', runId: 'dev2', head: H, artifacts: ['x'] }, { type: 'verification', head: H, checks: [{ name: 'ok', result: 'PASS' }] }, { type: 'verdict', runId: 'std2', head: H, verdict: 'FAIL' }]);
    assert.equal(spent.load('c1')!.stage, 'ESCALATED');
    for (const m of [mv('retry'), mv('route', { stage: 'STANDARD_REVIEW' })]) assert.throws(() => moveEvent(spent, 'w', m, where), /move refused: STANDARD_REVIEW budget is spent \(2 of 2\)$/);
    spent.close();
    assert.equal(store.events('c1').length, DISPUTED.length);
  } finally {
    store.close();
  }
});

test('moveEvent refuses a stage the driver cannot run: a commit stage without a FAIL for the candidate, a review stage without its verification, a grant stage the head gate refuses (11-d2)', () => {
  const store = fresh();
  try {
    // The adversarial run failed after a standard PASS: no FAIL for a fix run to take.
    seed(store, 'c1', [...TO_ACCEPTANCE.slice(0, 4), { type: 'run_failed', runId: 'adv1', reason: 'timeout' }]);
    assert.throws(() => moveEvent(store, 'w', mv('route', { stage: 'DEVELOPING' }), where), new RegExp(`^Error: cycle c1: commit stage DEVELOPING runs a fix, which needs a FAIL for the candidate ${H}; the last verdict is a PASS for ${H}$`));
    assert.doesNotThrow(() => moveEvent(store, 'w', mv('route', { stage: 'AWAITING_ACCEPTANCE' }), where));
    // SC-17b: a FAIL for a stale SHA, counted and escalated; a fix run would take another head's findings.
    const stale = fresh();
    seed(stale, 'c1', [...TO_ACCEPTANCE.slice(0, 3), { type: 'verdict', runId: 'std1', head: 'e'.repeat(40), verdict: 'FAIL', findings: ['f'] }]);
    assert.throws(() => moveEvent(stale, 'w', mv('route', { stage: 'DEVELOPING' }), where), new RegExp(`the last verdict is a FAIL for ${'e'.repeat(40)}$`));
    stale.close();
    // A PASS that lands while escalated is ignored, so the dispute's FAIL is still the one a fix takes.
    const late = fresh();
    seed(late, 'c1', [...DISPUTED, { type: 'verdict', runId: 'std9', head: H, verdict: 'PASS' }]);
    assert.doesNotThrow(() => moveEvent(late, 'w', mv('route', { stage: 'DEVELOPING' }), where));
    late.close();
    // The fix's checks never ran: verify threw after the new commit.
    const H2 = 'd'.repeat(40);
    const unverified = fresh();
    seed(unverified, 'c1', [...DISPUTED.slice(0, 5), { type: 'developer_result', runId: 'dev2', head: H2, artifacts: ['x'] }, { type: 'reject_dispatch', reason: 'VERIFYING: sandbox' }]);
    assert.throws(() => moveEvent(unverified, 'w', mv('route', { sha: H2, stage: 'STANDARD_REVIEW' }), where), new RegExp(`^Error: cycle c1: review stage STANDARD_REVIEW reads the verification of the candidate ${H2}; the last is for ${H}$`));
    assert.doesNotThrow(() => moveEvent(unverified, 'w', mv('retry', { sha: H2 }), where));
    unverified.close();
    // A verification that lands while escalated was never a command stage's: no evidence for review to read.
    const lateChecks = fresh();
    seed(lateChecks, 'c1', [...DISPUTED.slice(0, 5), { type: 'developer_result', runId: 'dev2', head: H2, artifacts: ['x'] }, { type: 'reject_dispatch', reason: 'another writer' },
      { type: 'verification', head: H2, checks: [{ name: 'ok', result: 'PASS' }] }]);
    assert.throws(() => moveEvent(lateChecks, 'w', mv('route', { sha: H2, stage: 'STANDARD_REVIEW' }), where), new RegExp(`the last is for ${H}$`));
    lateChecks.close();
    // No review between the check and the grant stage, so no PASS verdict binds the head.
    const granted = fresh(grantFlow([{ name: 'merge', command: ['true'] }], false));
    seed(granted, 'c1', [...AT_OWNER.slice(0, 3), { type: 'request_changes', head: H }]);
    assert.throws(() => moveEvent(granted, 'w', mv('route', { stage: 'MERGE' }), where), new RegExp(`^Error: stage MERGE holds a grant, but no PASS verdict is for the candidate ${H}$`));
    granted.close();
    // A PASS that lands while escalated was never the review's: after a FAIL, or after another writer cut the review off.
    const PASS_LATE: Event = { type: 'verdict', runId: 'late', head: H, verdict: 'PASS', findings: [] };
    for (const cut of [{ type: 'verdict', runId: 'rev1', head: H, verdict: 'FAIL', findings: ['f'] }, { type: 'reject_dispatch', reason: 'another writer' }] as Event[]) {
      const late = fresh(grantFlow([{ name: 'merge', command: ['true'] }]));
      seed(late, 'c1', [...AT_OWNER.slice(0, 3), cut, PASS_LATE]);
      assert.throws(() => moveEvent(late, 'w', mv('route', { stage: 'MERGE' }), where), new RegExp(`^Error: stage MERGE holds a grant, but no PASS verdict is for the candidate ${H}$`), cut.type);
      late.close();
    }
  } finally {
    store.close();
  }
});

test('a move through decideAndDrive drives the cycle on into the stage it enters (11-d2)', async () => {
  const store = fresh(ownerCheck);
  try {
    seed(store, 'c1', [...AT_OWNER.slice(0, 3), { type: 'verdict', runId: 'rev1', head: H, verdict: 'FAIL', findings: ['f'] }]);
    const { cycleId, event, after } = moveEvent(store, 'w', mv('overrule'), where);
    let called = false;
    const ready = async () => { called = true; return { adapters: none, job, opts: { deadlineMs: 1000, runsDir: dir } }; };
    // The overrule leads to REVIEW, a stage the loop runs: ready and preflight run before anything is written.
    await assert.rejects(decideAndDrive(store, cycleId, event, ready, after), /^Error: no adapter for role writer \(stage DEV\)$/);
    assert.ok(called);
    assert.equal(store.events('c1').length, 4);
    const routed = moveEvent(store, 'w', mv('route', { stage: 'OWNER' }), where);
    const r = await decideAndDrive(store, routed.cycleId, routed.event, async () => { throw new Error('ready called'); }, routed.after);
    assert.deepEqual([r.written, r.cycle.stage], [true, 'OWNER']);
  } finally {
    store.close();
  }
});
