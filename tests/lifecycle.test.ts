// SC-01 to SC-19 from docs/specs/delivery-lifecycle-v0.2-scenarios.md, adapted to v1 semantics.
// Scenarios about readiness, waivers and finding dispositions (SC-09, 10, 12, 14, 15) are marked
// todo where v1 has no corresponding model yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, isEvent, newCycle, openChild, type Cycle, type Event } from '../src/lifecycle.ts';
import { PASS_CHECKS, sc, scenarios, toStandardReview as TO_STANDARD_REVIEW } from './scenarios.ts';

const run = (c: Cycle, ...events: Event[]) => events.reduce(apply, c);
const counters = (c: Cycle) => [c.standard, c.adversarial];
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
  assert.ok(c.standard <= 1);
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
