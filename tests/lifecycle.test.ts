// SC-01 to SC-19 from docs/specs/delivery-lifecycle-v0.2-scenarios.md, adapted to v1 semantics.
// Scenarios about readiness, waivers and finding dispositions (SC-09, 10, 12, 14, 15) are marked
// todo where v1 has no corresponding model yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newCycle, openChild, type Cycle, type Event } from '../src/lifecycle.ts';

const run = (c: Cycle, ...events: Event[]) => events.reduce(apply, c);
const counters = (c: Cycle) => [c.standard, c.adversarial];

const PASS_CHECKS = [{ name: 'tests', result: 'PASS' as const }];

function toStandardReview(): Cycle {
  return run(
    newCycle('c1', 'w1'),
    { type: 'claim', runId: 'dev1', base: 'B1' },
    { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['result.json'] },
    { type: 'verification', head: 'H1', checks: PASS_CHECKS },
  );
}

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
    { type: 'claim', runId: 'dev2', base: 'B1' },
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
  let c = run(
    toStandardReview(),
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'FAIL' },
    { type: 'claim', runId: 'dev2', base: 'B1' },
    { type: 'developer_result', runId: 'dev2', head: 'H2', artifacts: ['r'] },
    { type: 'verification', head: 'H2', checks: PASS_CHECKS },
    { type: 'verdict', runId: 'sr2', head: 'H2', verdict: 'FAIL' },
  );
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [2, 0]);
  c = apply(c, { type: 'verdict', runId: 'sr3', head: 'H2', verdict: 'PASS' });
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [2, 0]);
});

test('SC-04 adversarial FAIL escalates immediately', () => {
  const c = run(
    toStandardReview(),
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
    { type: 'verdict', runId: 'ar1', head: 'H1', verdict: 'FAIL' },
  );
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [1, 1]);
});

test('SC-05 "fix it" without authorisation does nothing; child cycle starts at (0,0)', () => {
  const parent = run(
    toStandardReview(),
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
    { type: 'verdict', runId: 'ar1', head: 'H1', verdict: 'FAIL' },
  );
  const still = apply(parent, { type: 'claim', runId: 'dev2', base: 'B1' });
  assert.equal(still.stage, 'ESCALATED');
  assert.deepEqual(counters(still), [1, 1]);
  const child = openChild(parent, 'c2');
  assert.equal(child.stage, 'QUEUED');
  assert.deepEqual(counters(child), [0, 0]);
  assert.equal(child.parentCycleId, 'c1');
  assert.throws(() => openChild(toStandardReview(), 'c3'));
});

test('SC-06 duplicate verdict for the same run counts once', () => {
  const c = run(
    toStandardReview(),
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
  );
  assert.equal(c.stage, 'ADVERSARIAL_REVIEW');
  assert.deepEqual(counters(c), [1, 0]);
});

test('SC-07 developer exits without commit or artifact: escalate, no relaunch', () => {
  const c = run(
    newCycle('c1', 'w1'),
    { type: 'claim', runId: 'dev1', base: 'B1' },
    { type: 'developer_result', runId: 'dev1', artifacts: [] },
  );
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [0, 0]);
  assert.equal(apply(c, { type: 'claim', runId: 'dev2', base: 'B1' }).stage, 'ESCALATED');
});

test('SC-08 verification evidence for a different SHA is rejected', () => {
  const c = run(
    newCycle('c1', 'w1'),
    { type: 'claim', runId: 'dev1', base: 'B1' },
    { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] },
    { type: 'verification', head: 'H2', checks: PASS_CHECKS },
  );
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [0, 0]);
});

test.todo('SC-09 UI work without approved design cannot become READY (readiness model not in v1)');
test.todo('SC-10 docs task with no-UI rationale can become READY (readiness model not in v1)');

test('SC-11 failed mandatory check escalates; unsolicited PASS does not advance', () => {
  let c = run(
    newCycle('c1', 'w1'),
    { type: 'claim', runId: 'dev1', base: 'B1' },
    { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] },
    { type: 'verification', head: 'H1', checks: [{ name: 'security', result: 'FAIL' }] },
  );
  assert.equal(c.stage, 'ESCALATED');
  c = apply(c, { type: 'verdict', runId: 'stranger', head: 'H1', verdict: 'PASS' });
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [0, 0]);
});

test.todo('SC-12 owner waiver is HUMAN-WAIVED, not PASS, and binds to one SHA (waivers not in v1)');

test('SC-13 forbidden dispatch is rejected before launch', () => {
  const c = apply(newCycle('c1', 'w1'), { type: 'reject_dispatch', reason: 'forbidden runtime' });
  assert.equal(c.stage, 'ESCALATED');
  assert.equal(c.runs.length, 0);
});

test.todo('SC-14 reviewer re-disposition of a finding does not reset counters (finding dispositions not in v1)');
test.todo('SC-15 package incomplete without human UAT observation (acceptance package not in v1)');

test('SC-16 head changes after standard PASS: evidence invalid, escalate, no PASS reuse', () => {
  const c = run(
    toStandardReview(),
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
    { type: 'head_changed', head: 'H2' },
  );
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [1, 0]);
});

test('SC-17 base changes during review: stale PASS is counted once but never applied', () => {
  let c = run(toStandardReview(), { type: 'base_changed', base: 'B2' });
  assert.equal(c.stage, 'ESCALATED');
  // Verdict arriving after escalation: recorded, not counted, not applied.
  c = apply(c, { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' });
  assert.equal(c.stage, 'ESCALATED');
  c = apply(c, { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' });
  assert.ok(c.standard <= 1);
  assert.ok(!c.history.some((h) => h.to === 'ADVERSARIAL_REVIEW'));
});

test('SC-17b stale verdict while still in review is counted once and escalates', () => {
  const c = run(
    toStandardReview(),
    { type: 'verdict', runId: 'sr1', head: 'H0', verdict: 'PASS' },
    { type: 'verdict', runId: 'sr1', head: 'H0', verdict: 'PASS' },
  );
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [1, 0]);
});

test('SC-18 candidate moves before acceptance: refuse, keep counters', () => {
  let c = run(
    toStandardReview(),
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
    { type: 'verdict', runId: 'ar1', head: 'H1', verdict: 'PASS' },
    { type: 'head_changed', head: 'H2' },
  );
  assert.equal(c.stage, 'ESCALATED');
  c = apply(c, { type: 'accept', head: 'H2' });
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(counters(c), [1, 1]);
});

test('SC-19 accepted cycle stays accepted; later events are ignored; revision is a child', () => {
  const accepted = run(
    toStandardReview(),
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
    { type: 'verdict', runId: 'ar1', head: 'H1', verdict: 'PASS' },
    { type: 'accept', head: 'H1' },
  );
  const after = apply(accepted, { type: 'base_changed', base: 'B2' });
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
