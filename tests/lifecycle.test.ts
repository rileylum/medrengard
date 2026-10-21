// SC-01 to SC-19 from docs/specs/delivery-lifecycle-v0.2-scenarios.md, adapted to v1 semantics.
// Scenarios about readiness, waivers and finding dispositions (SC-09, 10, 12, 14, 15) are marked
// todo where v1 has no corresponding model yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, checkWorkflow, defaultWorkflow, EVENT_TYPES, isEvent, newCycle, openChild, outcomeRunId, replayCheck, type Cycle, type Event, type StageDef, type Workflow } from '../src/lifecycle.ts';
import { PASS_CHECKS, sc, scenarios, toStandardReview as TO_STANDARD_REVIEW } from './scenarios.ts';
import { counters, noHuman, ownerCheck } from './workflows.ts';

const runWith = (w: Workflow, c: Cycle, ...events: Event[]) => events.reduce((acc, e) => apply(acc, e, w), c);
const run = (c: Cycle, ...events: Event[]) => runWith(defaultWorkflow, c, ...events);
const play = (name: string) => run(newCycle('c1', 'w1'), ...sc(name).events);

const toStandardReview = () => run(newCycle('c1', 'w1'), ...TO_STANDARD_REVIEW);

test('every shared scenario ends at its declared stage and counters', () => {
  for (const s of scenarios) {
    const c = play(s.name);
    assert.equal(c.stage, s.stage, s.name);
    assert.deepEqual(counters(c), s.counters, s.name);
  }
});

test('isEvent rejects arrays, primitives and objects with no handled type', () => {
  for (const v of [[], Object.assign([], { type: 'cancel' }), 'cancel', 1, null, undefined, {}, { type: 'bogus' }]) assert.equal(isEvent(v), false, JSON.stringify(v));
  assert.equal(isEvent({ type: 'cancel' }), true);
});

test('outcomeRunId names the run of every outcome event', () => {
  // One valid event per type. A new event type fails the first check until it is listed here.
  const samples: Record<Event['type'], Event> = {
    claim: { type: 'claim', runId: 'r', base: 'B1', runtime: 'fake' },
    developer_result: { type: 'developer_result', runId: 'r', artifacts: [] },
    verification: { type: 'verification', head: 'H1', checks: [] },
    verdict: { type: 'verdict', runId: 'r', head: 'H1', verdict: 'PASS' },
    head_changed: { type: 'head_changed', head: 'H1' },
    base_changed: { type: 'base_changed', base: 'B1' },
    accept: { type: 'accept', head: 'H1' },
    request_changes: { type: 'request_changes' },
    cancel: { type: 'cancel' },
    reject_dispatch: { type: 'reject_dispatch', reason: 'x' },
    dispute: { type: 'dispute', runId: 'r', head: 'H1', reason: 'x' },
    run_failed: { type: 'run_failed', runId: 'r', reason: 'x' },
  };
  assert.deepEqual(Object.keys(samples).sort(), [...EVENT_TYPES].sort());
  for (const e of Object.values(samples)) {
    assert.equal(isEvent(e), true, e.type);
    // An event whose shape requires a run ID is that run's outcome; the store keeps one per run.
    // The claim is the exception: apply decides a redelivered claim.
    const outcome = e.type !== 'claim' && !isEvent({ ...e, runId: undefined });
    assert.equal(outcomeRunId(e), outcome ? 'r' : undefined, e.type);
  }
});

test('an event of unknown type escalates instead of returning undefined', () => {
  const c = apply(toStandardReview(), { type: 'bogus' } as unknown as Event);
  assert.equal(c.stage, 'ESCALATED');
  assert.match(c.history.at(-1)!.note ?? '', /unclassifiable/);
  assert.equal(apply(c, { type: 'cancel' }).stage, 'CANCELLED');
});

test('SC-01 happy path: both reviews pass, owner accepts', () => {
  let c = toStandardReview();
  assert.equal(c.stage, 'STANDARD_REVIEW');
  c = apply(c, { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' });
  assert.equal(c.stage, 'ADVERSARIAL_REVIEW');
  assert.deepEqual(counters(c), [1, 0]);
  c = apply(c, { type: 'verdict', runId: 'ar1', head: 'H1', verdict: 'PASS' });
  assert.equal(c.stage, 'AWAITING_ACCEPTANCE');
  assert.deepEqual(counters(c), [1, 1]);
  c = apply(c, { type: 'accept', head: 'H1' });
  assert.equal(c.stage, 'ACCEPTED');
});

test('SC-02 first standard FAIL returns to developer; fix passes both reviews', () => {
  let c = apply(toStandardReview(), { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'FAIL', findings: ['f1'] });
  assert.equal(c.stage, 'DEVELOPING');
  assert.deepEqual(counters(c), [1, 0]);
  c = run(
    c,
    { type: 'claim', runId: 'dev2', base: 'B1', runtime: 'fake' },
    { type: 'developer_result', runId: 'dev2', head: 'H2', artifacts: ['result.json'] },
    { type: 'verification', head: 'H2', checks: PASS_CHECKS },
    { type: 'verdict', runId: 'sr2', head: 'H2', verdict: 'PASS' },
  );
  assert.deepEqual(counters(c), [2, 0]);
  c = apply(c, { type: 'verdict', runId: 'ar1', head: 'H2', verdict: 'PASS' });
  assert.equal(c.stage, 'AWAITING_ACCEPTANCE');
  assert.deepEqual(counters(c), [2, 1]);
  assert.ok(c.history.some((h) => h.event.type === 'verdict' && h.event.verdict === 'FAIL'), 'H1 failure retained');
});

test('SC-03 second standard FAIL escalates; no third review', () => {
  const events = sc('SC-03').events;
  let c = run(newCycle('c1', 'w1'), ...events.slice(0, -1));
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [2, 0]);
  c = apply(c, events.at(-1)!);
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [2, 0]);
});

test('SC-04 adversarial FAIL escalates immediately', () => {
  const c = play('SC-04');
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [1, 1]);
});

test('SC-05 "fix it" without authorisation does nothing; child cycle starts at (0,0)', () => {
  const parent = play('SC-04');
  const still = play('SC-05');
  assert.equal(still.stage, 'ESCALATED');
  assert.deepEqual(counters(still), [1, 1]);
  const child = openChild(parent, 'c2');
  assert.equal(child.stage, 'QUEUED');
  assert.deepEqual(counters(child), [0, 0]);
  assert.equal(child.parentCycleId, 'c1');
  assert.throws(() => openChild(toStandardReview(), 'c3'));
});

test('SC-06 duplicate verdict for the same run counts once', () => {
  const c = play('SC-06');
  assert.equal(c.stage, 'ADVERSARIAL_REVIEW');
  assert.deepEqual(counters(c), [1, 0]);
});

test('SC-07 developer exits without commit or artifact: escalate, no relaunch', () => {
  const events = sc('SC-07').events;
  const c = run(newCycle('c1', 'w1'), ...events.slice(0, -1));
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [0, 0]);
  assert.equal(apply(c, events.at(-1)!).stage, 'ESCALATED');
});

test('SC-08 verification evidence for a different SHA is rejected', () => {
  const c = play('SC-08');
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [0, 0]);
});

test.todo('SC-09 UI work without approved design cannot become READY (readiness model not in v1)');
test.todo('SC-10 docs task with no-UI rationale can become READY (readiness model not in v1)');

test('SC-11 failed mandatory check escalates; unsolicited PASS does not advance', () => {
  const events = sc('SC-11').events;
  let c = run(newCycle('c1', 'w1'), ...events.slice(0, -1));
  assert.equal(c.stage, 'ESCALATED');
  c = apply(c, events.at(-1)!);
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [0, 0]);
});

test.todo('SC-12 owner waiver is HUMAN-WAIVED, not PASS, and binds to one SHA (waivers not in v1)');

test('SC-13 forbidden dispatch is rejected before launch', () => {
  const c = play('SC-13');
  assert.equal(c.stage, 'ESCALATED');
  assert.equal(c.runs.length, 0);
});

test.todo('SC-14 reviewer re-disposition of a finding does not reset counters (finding dispositions not in v1)');
test.todo('SC-15 package incomplete without human UAT observation (acceptance package not in v1)');

test('SC-16 head changes after standard PASS: evidence invalid, escalate, no PASS reuse', () => {
  const c = play('SC-16');
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [1, 0]);
});

test('SC-17 base changes during review: stale PASS is counted once but never applied', () => {
  const events = sc('SC-17').events;
  let c = run(newCycle('c1', 'w1'), ...events.slice(0, -2));
  assert.equal(c.stage, 'ESCALATED');
  // Verdict arriving after escalation: recorded, not counted, not applied.
  c = apply(c, events.at(-2)!);
  assert.equal(c.stage, 'ESCALATED');
  c = apply(c, events.at(-1)!);
  assert.ok(counters(c)[0]! <= 1);
  assert.ok(!c.history.some((h) => h.to === 'ADVERSARIAL_REVIEW'));
});

test('SC-17b stale verdict while still in review is counted once and escalates', () => {
  const c = play('SC-17b');
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [1, 0]);
});

test('SC-18 candidate moves before acceptance: refuse, keep counters', () => {
  const events = sc('SC-18').events;
  let c = run(newCycle('c1', 'w1'), ...events.slice(0, -1));
  assert.equal(c.stage, 'ESCALATED');
  c = apply(c, events.at(-1)!);
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [1, 1]);
});

test('SC-19 accepted cycle stays accepted; later events are ignored; revision is a child', () => {
  const accepted = play('SC-01');
  const after = play('SC-19');
  assert.equal(after.stage, 'ACCEPTED');
  assert.deepEqual(counters(after), [1, 1]);
  assert.throws(() => openChild(after, 'c2'), /ESCALATED/);
});

test('accept must name the candidate SHA', () => {
  const c = run(
    toStandardReview(),
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
    { type: 'verdict', runId: 'ar1', head: 'H1', verdict: 'PASS' },
    { type: 'accept', head: 'H9' },
  );
  assert.equal(c.stage, 'ESCALATED');
});

test('run_failed escalates with its reason; a duplicate run_failed is ignored (04-a)', () => {
  let c = run(newCycle('c1', 'w1'), { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  c = apply(c, { type: 'run_failed', runId: 'dev1', reason: 'timeout' });
  assert.equal(c.stage, 'ESCALATED');
  assert.match(c.escalation ?? '', /timeout/);
  c = apply(c, { type: 'run_failed', runId: 'dev1', reason: 'timeout' });
  assert.match(c.history.at(-1)!.note ?? '', /ignored/);
  assert.equal(isEvent({ type: 'run_failed', runId: 'dev1' }), false);
  assert.equal(isEvent({ type: 'run_failed', runId: 'dev1', reason: '' }), false);
  assert.equal(isEvent({ type: 'run_failed', runId: 'dev1', reason: 'x' }), true);
});

test('dispute: a fix run escalates with its reason and spends nothing; a duplicate is ignored; a first run, a stranger or a non-candidate head escalates (07-e)', () => {
  const fixing = () => run(toStandardReview(), { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'FAIL' }, { type: 'claim', runId: 'dev2', base: 'B1', runtime: 'fake' });
  let c = apply(fixing(), { type: 'dispute', runId: 'dev2', head: 'H1', reason: 'wrong' });
  assert.equal(c.stage, 'ESCALATED');
  assert.equal(c.escalation, 'developer disputes the findings on H1: wrong');
  assert.deepEqual(c.budgets, fixing().budgets);
  assert.ok(c.consumed.includes('dev2'));
  c = apply(c, { type: 'dispute', runId: 'dev2', head: 'H1', reason: 'wrong' });
  assert.match(c.history.at(-1)!.note ?? '', /ignored/);
  assert.equal(apply(fixing(), { type: 'dispute', runId: 'dev2', head: 'H2', reason: 'r' }).escalation, 'dispute names H2, not the previous candidate H1');
  assert.equal(apply(fixing(), { type: 'dispute', runId: 'other', head: 'H1', reason: 'r' }).escalation, 'dispute from unknown run');
  const first = run(newCycle('c1', 'w1'), { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  assert.equal(apply(first, { type: 'dispute', runId: 'dev1', head: 'B1', reason: 'r' }).escalation, 'dispute outside a fix run');
  assert.equal(isEvent({ type: 'dispute', runId: 'dev2', head: 'H1' }), false);
  assert.equal(isEvent({ type: 'dispute', runId: 'dev2', head: 'H1', reason: '' }), false);
  assert.equal(isEvent({ type: 'dispute', runId: 'dev2', head: 'H1', reason: 'r' }), true);
});

test('run_failed for a run whose verdict or result is already consumed is ignored (04-b)', () => {
  const reviewed = run(toStandardReview(), { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' });
  const after = apply(reviewed, { type: 'run_failed', runId: 'sr1', reason: 'crash' });
  assert.equal(after.stage, 'ADVERSARIAL_REVIEW');
  assert.deepEqual(counters(after), [1, 0]);
  assert.match(after.history.at(-1)!.note ?? '', /ignored/);
  const developed = run(newCycle('c1', 'w1'), ...TO_STANDARD_REVIEW.slice(0, 2));
  assert.equal(apply(developed, { type: 'run_failed', runId: 'dev1', reason: 'cancelled' }).stage, 'VERIFYING');
});

test('a claim names its runtime and the Run carries it; a claim without one is not an event (05-a)', () => {
  const c = run(newCycle('c1', 'w1'), ...sc('RT-01').events);
  assert.equal(c.runs[0]!.runtime, 'pi');
  assert.equal(isEvent({ type: 'claim', runId: 'dev1', base: 'B1' }), false);
  assert.equal(isEvent({ type: 'claim', runId: 'dev1', base: 'B1', runtime: '' }), false);
  assert.equal(isEvent({ type: 'claim', runId: 'dev1', base: 'B1', runtime: 'claude' }), true);
});

// Ticket 09-a: the engine applies events under any workflow that passes checkWorkflow.

const verdict = (runId: string, head: string, v: 'PASS' | 'FAIL', step?: string): Event => ({ type: 'verdict', runId, head, verdict: v, ...(step ? { step } : {}) });
const fixRun = (n: number): Event[] => [
  { type: 'claim', runId: `dev${n}`, base: 'B1', runtime: 'fake' },
  { type: 'developer_result', runId: `dev${n}`, head: `H${n}`, artifacts: ['r'] },
  { type: 'verification', head: `H${n}`, checks: PASS_CHECKS },
];
const refused = (w: unknown, pattern: RegExp) => {
  const reasons = checkWorkflow(w as Workflow);
  assert.ok(reasons.some((r) => pattern.test(r)), `${pattern} not in ${JSON.stringify(reasons)}`);
  return reasons;
};
const withStage = (name: string, def: object): Workflow => ({ ...defaultWorkflow, stages: { ...defaultWorkflow.stages, [name]: def as Workflow['stages'][string] } });

test('the default workflow and the no-human workflow pass checkWorkflow', () => {
  assert.deepEqual(checkWorkflow(defaultWorkflow), []);
  assert.deepEqual(checkWorkflow(noHuman), []);
});

test('checkWorkflow refuses a transition that names an unknown stage', () => {
  refused(withStage('VERIFYING', { kind: 'command', transitions: { PASS: 'NOWHERE' } }), /VERIFYING.*NOWHERE/);
  refused(withStage('VERIFYING', { kind: 'command', transitions: { PASS: 'STANDARD_REVIEW', FAIL: 'QUEUED' } }), /VERIFYING.*QUEUED/);
});

test('checkWorkflow refuses a start that names an unknown stage', () => {
  refused({ ...defaultWorkflow, start: 'NOWHERE' }, /NOWHERE/);
});

test('checkWorkflow refuses a stage that uses an engine stage name', () => {
  for (const name of ['ACCEPTED', 'QUEUED', 'ESCALATED', 'CANCELLED'])
    refused(withStage(name, { kind: 'human', transitions: { PASS: 'ACCEPTED' } }), new RegExp(`${name}.*engine`));
});

test('checkWorkflow refuses an agent loop with no budgeted stage', () => {
  const { budget: _, ...unbudgeted } = defaultWorkflow.stages.STANDARD_REVIEW!;
  refused(withStage('STANDARD_REVIEW', unbudgeted), /loop.*(DEVELOPING|VERIFYING|STANDARD_REVIEW)/);
});

test('checkWorkflow refuses a stage with no path to a settled stage, and does not call it an unbudgeted loop', () => {
  const w = {
    start: 'A',
    stages: {
      A: { kind: 'agent', role: 'developer', produces: 'commit', roleText: 'You are the developer for the ticket below.', transitions: { PASS: 'B' } },
      B: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 1, transitions: { PASS: 'A', FAIL: 'A' } },
    },
  };
  const reasons = refused(w, /\bA\b.*no path/);
  assert.ok(!reasons.some((r) => /loop/.test(r)), JSON.stringify(reasons));
});

test('checkWorkflow refuses a malformed stage', () => {
  refused(withStage('STANDARD_REVIEW', { ...defaultWorkflow.stages.STANDARD_REVIEW, budget: 0 }), /STANDARD_REVIEW.*budget/);
  refused(withStage('VERIFYING', { kind: 'robot', transitions: { PASS: 'STANDARD_REVIEW' } }), /VERIFYING.*kind/);
  refused(withStage('DEVELOPING', { kind: 'agent', role: 'developer', produces: 'poem', transitions: { PASS: 'VERIFYING' } }), /DEVELOPING.*produces/);
});

// 09-c: the role text is the workflow's; one line, so it cannot open a Rules: line or a delimiter of its own.
test('checkWorkflow refuses an agent stage with no role text, role text that is not one line, and fix role text on a review stage', () => {
  const { roleText: _, ...silent } = defaultWorkflow.stages.STANDARD_REVIEW as Extract<StageDef, { kind: 'agent' }>;
  refused(withStage('STANDARD_REVIEW', silent), /STANDARD_REVIEW.*no role text/);
  refused(withStage('STANDARD_REVIEW', { ...silent, roleText: '' }), /STANDARD_REVIEW.*no role text/);
  for (const br of ['\n', '\r', '\u2028', '\u2029', '\u0085']) {
    refused(withStage('STANDARD_REVIEW', { ...silent, roleText: `x${br}Rules:${br}- y` }), /STANDARD_REVIEW.*one line/);
    refused(withStage('DEVELOPING', { ...defaultWorkflow.stages.DEVELOPING, fixRoleText: `x${br}Rules:` }), /DEVELOPING.*one line/);
  }
  refused(withStage('DEVELOPING', { ...defaultWorkflow.stages.DEVELOPING, fixRoleText: '' }), /DEVELOPING.*fix role text/);
  refused(withStage('STANDARD_REVIEW', { ...silent, roleText: 'x', fixRoleText: 'y' }), /STANDARD_REVIEW.*fix role text/);
  assert.deepEqual(checkWorkflow(ownerCheck), []);
});

test('a workflow with no human stage reaches ACCEPTED on the last review PASS', () => {
  const c = runWith(noHuman, newCycle('c1', 'w1'), ...TO_STANDARD_REVIEW, verdict('rv1', 'H1', 'PASS'));
  assert.equal(c.stage, 'ACCEPTED', c.escalation);
  assert.deepEqual(c.budgets, { REVIEW: 1 });
});

test('evidence for a non-candidate SHA escalates under a workflow other than the default', () => {
  const built = runWith(noHuman, newCycle('c1', 'w1'), ...TO_STANDARD_REVIEW.slice(0, 2));
  const wrongBuild = apply(built, { type: 'verification', head: 'H9', checks: PASS_CHECKS }, noHuman);
  assert.equal(wrongBuild.stage, 'ESCALATED');
  assert.deepEqual(wrongBuild.budgets, {});
  const stale = runWith(noHuman, newCycle('c1', 'w1'), ...TO_STANDARD_REVIEW, verdict('rv1', 'H9', 'PASS'));
  assert.equal(stale.stage, 'ESCALATED');
  assert.deepEqual(stale.budgets, { REVIEW: 1 });
});

test('review budgets come from the workflow, not from constants', () => {
  const events = [...TO_STANDARD_REVIEW, verdict('sr1', 'H1', 'FAIL'), ...fixRun(2), verdict('sr2', 'H2', 'FAIL'), ...fixRun(3), verdict('sr3', 'H3', 'PASS')];
  const roomy = withStage('STANDARD_REVIEW', { ...defaultWorkflow.stages.STANDARD_REVIEW, budget: 3 });
  const c = runWith(roomy, newCycle('c1', 'w1'), ...events);
  assert.equal(c.stage, 'ADVERSARIAL_REVIEW', c.escalation);
  assert.equal(c.budgets.STANDARD_REVIEW, 3);
  assert.equal(run(newCycle('c1', 'w1'), ...events).stage, 'ESCALATED');
});

test('entering a budgeted stage whose budget is spent escalates', () => {
  const loop: Workflow = {
    start: 'DEV',
    stages: {
      DEV: { kind: 'agent', role: 'developer', produces: 'commit', roleText: 'You are the developer for the ticket below.', transitions: { PASS: 'REVIEW' } },
      REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 1, transitions: { PASS: 'DEV', FAIL: 'ESCALATED' } },
    },
  };
  assert.deepEqual(checkWorkflow(loop), []);
  const c = runWith(loop, newCycle('c1', 'w1'),
    { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' },
    { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] },
    verdict('rv1', 'H1', 'PASS'),
    { type: 'claim', runId: 'dev2', base: 'B1', runtime: 'fake' },
    { type: 'developer_result', runId: 'dev2', head: 'H2', artifacts: ['r'] },
  );
  assert.equal(c.stage, 'ESCALATED');
  assert.match(c.escalation ?? '', /REVIEW budget exhausted/);
});

test('escalation reasons name the stage and, at the limit, the budget', () => {
  assert.match(play('SC-03').escalation ?? '', /STANDARD_REVIEW FAIL at budget limit 2/);
  assert.match(play('SC-04').escalation ?? '', /ADVERSARIAL_REVIEW FAIL/);
  assert.match(play('SC-11').escalation ?? '', /required check failed or missing/);
});

test('an event with a step for the current stage advances; one for another stage escalates uncounted', () => {
  const same = apply(toStandardReview(), verdict('sr1', 'H1', 'PASS', 'STANDARD_REVIEW'));
  assert.equal(same.stage, 'ADVERSARIAL_REVIEW');
  assert.deepEqual(counters(same), [1, 0]);
  const other = apply(toStandardReview(), verdict('sr1', 'H1', 'PASS', 'ADVERSARIAL_REVIEW'));
  assert.equal(other.stage, 'ESCALATED');
  assert.deepEqual(counters(other), [0, 0]);
  assert.equal(isEvent({ type: 'cancel', step: '' }), false);
  assert.equal(isEvent({ type: 'cancel', step: 1 }), false);
  assert.equal(isEvent({ type: 'cancel', step: 'DEVELOPING' }), true);
});

// Ticket 09-b: the controller tells a claim from a verdict by the run's role, so a role must
// produce one kind of output.
test('checkWorkflow refuses a role that produces both a commit and a verdict, and an empty name', () => {
  refused({ ...noHuman, stages: { ...noHuman.stages, REVIEW: { ...noHuman.stages.REVIEW!, role: 'developer' } as Workflow['stages'][string] } }, /role developer.*commit.*verdict/);
  refused({ ...noHuman, name: '' }, /name/);
  assert.deepEqual(checkWorkflow(ownerCheck), []);
});

// Ticket 10-c: a command stage's run, network and file arguments are refused at load, not at verify.
test('checkWorkflow refuses a malformed run, network or file argument on a command stage', () => {
  const cmd = (extra: object) => withStage('VERIFYING', { kind: 'command', transitions: { PASS: 'STANDARD_REVIEW' }, ...extra });
  const ok = { name: 'lint', command: ['node', { file: 'lint.ts' }, '--strict'] };
  assert.deepEqual(checkWorkflow(cmd({ run: [ok, { name: 'sub', command: [{ file: 'bin/check.sh' }] }], network: true })), []);
  for (const run of [[], 'npm test', {}, [['npm', 'test']], [null]]) refused(cmd({ run }), /VERIFYING.*run/);
  for (const name of ['a b', '../x', '..', '', 'tree', 7]) refused(cmd({ run: [{ ...ok, name }] }), /VERIFYING.*name/);
  refused(cmd({ run: [ok, ok] }), /VERIFYING.*lint.*twice/);
  for (const command of [[], 'npm test', undefined]) refused(cmd({ run: [{ name: 'c', command }] }), /VERIFYING.*c.*command/);
  for (const arg of [7, null, {}, { path: 'x' }, { file: 'x', mode: 1 }, ['x']]) refused(cmd({ run: [{ name: 'c', command: ['node', arg] }] }), /VERIFYING.*c.*argument/);
  for (const file of [7, '', '/etc/passwd', '../x.ts', 'a/../../x.ts', 'a\\..\\x.ts']) refused(cmd({ run: [{ name: 'c', command: ['node', { file }] }] }), /VERIFYING.*c.*file/);
  for (const network of ['yes', 1, null]) refused(cmd({ network }), /VERIFYING.*network/);
  // Its name is a directory under evidence/<head>/.
  refused({ ...noHuman, stages: { ...noHuman.stages, DEV: { ...noHuman.stages.DEV!, transitions: { PASS: '../x' } }, '../x': noHuman.stages.BUILD! } }, /\.\.\/x.*command stage name/);
});

test('a verification check may record files, path to SHA-256, and nothing else in that field (10-c)', () => {
  const v = (files: unknown) => ({ type: 'verification', head: 'H1', checks: [{ name: 'lint', result: 'PASS', files }] });
  assert.ok(isEvent(v(undefined)));
  assert.ok(isEvent(v({ 'lint.ts': 'a'.repeat(64) })));
  for (const bad of ['abc', ['lint.ts'], null, { 'lint.ts': 7 }, { 'lint.ts': '' }]) assert.ok(!isEvent(v(bad)), JSON.stringify(bad));
});

// Ticket 10-e: a grant stage holds the owner's credential, so its shape is fixed at load (A-083 Q4).
test('checkWorkflow refuses malformed grants, and a grant stage without run, without network, with a FAIL that does not escalate, or with a command named head', () => {
  const run = [{ name: 'merge', command: ['node', { file: 'merge.ts' }] }];
  const grant = (extra: object) => withStage('VERIFYING', { kind: 'command', transitions: { PASS: 'STANDARD_REVIEW' }, run, network: true, grants: ['github'], ...extra });
  assert.deepEqual(checkWorkflow(grant({})), []);
  assert.deepEqual(checkWorkflow(grant({ grants: ['github', 'npm_2-x'], transitions: { PASS: 'STANDARD_REVIEW', FAIL: 'ESCALATED' } })), []);
  for (const grants of [[], 'github', [''], ['GitHub'], ['a b'], [7], null]) refused(grant({ grants }), /VERIFYING.*grants/);
  refused(grant({ grants: ['github', 'github'] }), /VERIFYING.*grant github.*twice/);
  refused(grant({ run: undefined }), /VERIFYING.*grant.*run/);
  for (const network of [undefined, false]) refused(grant({ network }), /VERIFYING.*grant.*network/);
  refused(grant({ transitions: { PASS: 'STANDARD_REVIEW', FAIL: 'DEVELOPING' } }), /VERIFYING.*grant.*FAIL.*ESCALATED/);
  refused(grant({ run: [...run, { name: 'head', command: ['true'] }] }), /VERIFYING.*head.*reserved/);
  // Nothing would be granted: refused, not ignored.
  refused(withStage('STANDARD_REVIEW', { ...defaultWorkflow.stages.STANDARD_REVIEW!, grants: ['github'] } as StageDef), /STANDARD_REVIEW.*grants.*command stage/);
  // Only a grant stage reserves head.
  assert.deepEqual(checkWorkflow(withStage('VERIFYING', { kind: 'command', transitions: { PASS: 'STANDARD_REVIEW' }, run: [{ name: 'head', command: ['true'] }] })), []);
});

test('a verification may record the grant names its stage held, and nothing else in that field (10-e)', () => {
  const v = (grants: unknown) => ({ type: 'verification', head: 'H1', checks: [{ name: 'merge', result: 'PASS' }], grants });
  assert.ok(isEvent(v(undefined)));
  assert.ok(isEvent(v(['github'])));
  for (const bad of ['github', [''], [7], null, {}]) assert.ok(!isEvent(v(bad)), JSON.stringify(bad));
});

// Sweep 2026-10-20, finding 4: each guard below survived deletion until these tests.

test('an event the stage\'s kind does not take escalates with nothing counted, in every stage of the default workflow', () => {
  const failed = run(toStandardReview(), verdict('sr1', 'H1', 'FAIL'));
  const stages: Record<string, Cycle> = {
    QUEUED: newCycle('c1', 'w1'),
    DEVELOPING: apply(failed, { type: 'claim', runId: 'dev2', base: 'B1', runtime: 'fake' }),
    VERIFYING: run(newCycle('c1', 'w1'), ...TO_STANDARD_REVIEW.slice(0, 2)),
    STANDARD_REVIEW: toStandardReview(),
    ADVERSARIAL_REVIEW: run(toStandardReview(), verdict('sr1', 'H1', 'PASS')),
    AWAITING_ACCEPTANCE: run(toStandardReview(), verdict('sr1', 'H1', 'PASS'), verdict('ar1', 'H1', 'PASS')),
  };
  const takes: Record<string, Event['type'][]> = {
    QUEUED: ['claim'],
    DEVELOPING: ['claim', 'developer_result', 'dispute'],
    VERIFYING: ['verification'],
    STANDARD_REVIEW: ['verdict'],
    ADVERSARIAL_REVIEW: ['verdict'],
    AWAITING_ACCEPTANCE: ['accept', 'request_changes'],
  };
  // Every event names the candidate H1 or a known, unfinished run, so only the stage check can refuse it.
  const events: Event[] = [
    { type: 'claim', runId: 'devY', base: 'B1', runtime: 'fake' },
    { type: 'developer_result', runId: 'devX', head: 'H2', artifacts: ['r'] },
    { type: 'dispute', runId: 'devX', head: 'H1', reason: 'r' },
    { type: 'verification', head: 'H1', checks: PASS_CHECKS },
    verdict('rX', 'H1', 'PASS'),
    { type: 'accept', head: 'H1' },
    { type: 'request_changes' },
  ];
  assert.deepEqual(Object.keys(stages).slice(1), Object.keys(defaultWorkflow.stages));
  let cells = 0;
  for (const [stage, reached] of Object.entries(stages)) {
    assert.equal(reached.stage, stage);
    // Outside a commit stage no run is ever unfinished, so a result or dispute would stop at "unknown run" first.
    // devX has an input so that, without the stage check, a dispute would not stop at "dispute outside a fix run" either.
    const c: Cycle = { ...reached, runs: [...reached.runs, { runId: 'devX', role: 'developer', input: { head: 'H1', base: 'B1' } }] };
    for (const e of events) {
      if (takes[stage]!.includes(e.type)) continue;
      const after = apply(c, e);
      const cell = `${e.type} in ${stage}`;
      assert.equal(after.stage, 'ESCALATED', cell);
      assert.match(after.escalation ?? '', /^\S+( result)? outside (a (command|human|review|commit) stage|QUEUED or a commit stage)/, cell);
      assert.deepEqual(after.budgets, c.budgets, cell);
      cells++;
    }
  }
  assert.equal(cells, 6 * 7 - 9);
});

test('a claim while a developer run is active is ignored and starts no run', () => {
  const c = run(newCycle('c1', 'w1'), { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' }, { type: 'claim', runId: 'dev2', base: 'B1', runtime: 'fake' });
  assert.equal(c.stage, 'DEVELOPING');
  assert.deepEqual(c.runs.map((r) => r.runId), ['dev1']);
  assert.equal(c.history.at(-1)!.note, 'ignored: developer run already active');
});

test('a base change naming the candidate\'s base is ignored in any stage; a head change naming its head, outside a commit stage', () => {
  const reviewing = toStandardReview();
  for (const e of [{ type: 'head_changed', head: 'H1' }, { type: 'base_changed', base: 'B1' }] as Event[]) {
    const c = apply(reviewing, e);
    assert.equal(c.stage, 'STANDARD_REVIEW', e.type);
    assert.match(c.history.at(-1)!.note ?? '', /^ignored: same (head|base)$/, e.type);
  }
  const fixing = run(reviewing, verdict('sr1', 'H1', 'FAIL'), { type: 'claim', runId: 'dev2', base: 'B1', runtime: 'fake' });
  const developing = apply(fixing, { type: 'base_changed', base: 'B1' });
  assert.equal(developing.stage, 'DEVELOPING');
  assert.equal(developing.history.at(-1)!.note, 'ignored: same base');
  assert.equal(apply(reviewing, { type: 'head_changed', head: 'H2' }).stage, 'ESCALATED');
  assert.equal(apply(reviewing, { type: 'base_changed', base: 'B2' }).stage, 'ESCALATED');
});

// Ticket 11-c: replayCheck keeps only what apply reads (A-136, engine.md P6).
test('replayCheck passes every workflow checkWorkflow passes, and one with role text checkWorkflow refuses', () => {
  for (const w of [defaultWorkflow, noHuman, ownerCheck]) assert.deepEqual(replayCheck(w), [], w.name);
  const twoLines = { ...ownerCheck, stages: { ...ownerCheck.stages, DEV: { ...ownerCheck.stages.DEV!, roleText: 'a\nb' } } } as Workflow;
  assert.notDeepEqual(checkWorkflow(twoLines), []);
  assert.deepEqual(replayCheck(twoLines), []);
});

test('replayCheck refuses each stage table apply could not walk, naming the stage', () => {
  const dev = ownerCheck.stages.DEV!;
  const at = (DEV: unknown, more: Partial<Workflow> = {}) => ({ ...ownerCheck, ...more, stages: { ...ownerCheck.stages, DEV } }) as Workflow;
  const cases: [Workflow, RegExp][] = [
    [{ start: 'DEV' } as unknown as Workflow, /^workflow must be an object with stages$/],
    [at(dev, { start: 'NOWHERE' }), /^start stage NOWHERE is not a workflow stage$/],
    [{ ...ownerCheck, stages: { ...ownerCheck.stages, ESCALATED: dev } }, /^stage ESCALATED uses an engine stage name$/],
    [at('DEV'), /^stage DEV must be an object$/],
    [at({ ...dev, kind: 'timer' }), /^stage DEV has unknown kind timer$/],
    [at({ ...dev, role: '' }), /^stage DEV is an agent stage with no role$/],
    [at({ ...dev, produces: 'both' }), /^stage DEV produces both, not commit or verdict$/],
    [at({ ...dev, budget: 0 }), /^stage DEV budget must be a positive integer$/],
    [at({ ...dev, transitions: undefined }), /^stage DEV has no transitions$/],
    [at({ ...dev, transitions: { FAIL: 'CHECK' } }), /^stage DEV has no PASS transition$/],
    [at({ ...dev, transitions: { PASS: 'CHECK', FAIL: 7 } }), /^stage DEV FAIL transition must be a stage name$/],
    [at({ ...dev, transitions: { PASS: 'GONE' } }), /^stage DEV PASS names unknown stage GONE$/],
  ];
  for (const [w, reason] of cases) assert.ok(replayCheck(w).some((r) => reason.test(r)), `${reason}: ${replayCheck(w).join('; ')}`);
});
