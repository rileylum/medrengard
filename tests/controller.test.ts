// Ticket 04-a: normal, malformed, timeout, cancel and duplicate outcomes each drive the state
// machine correctly, observed only through execute()'s return value and store.load().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Cycle } from '../src/lifecycle.ts';
import { EventStore } from '../src/store.ts';
import { execute, receive } from '../src/controller.ts';
import { fakeAdapter, type Step } from './fake-adapter.ts';
import { PASS_CHECKS, toStandardReview } from './scenarios.ts';

const dir = mkdtempSync(join(tmpdir(), 'sf-controller-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
const fresh = () => {
  const store = new EventStore(join(dir, `${n++}.sqlite`));
  store.open('c1', 'w1');
  return store;
};
const stage = (c: Cycle) => [c.stage, c.standard, c.adversarial];
const req = { prompt: 'do the ticket', cwd: dir };
const dev = (store: EventStore, step: Step, deadlineMs = 5000) =>
  execute(store, 'c1', fakeAdapter(step), { ...req, role: 'developer' }, { deadlineMs, base: 'B1' });

test('normal: a developer claim moves DEVELOPING to VERIFYING; a verdict moves STANDARD_REVIEW on', async () => {
  const store = fresh();
  const adapter = fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['result.json'] }, sessionId: 's1' } });
  const c = await execute(store, 'c1', adapter, { ...req, role: 'developer' }, { deadlineMs: 5000, base: 'B1' });
  assert.deepEqual(stage(c), ['VERIFYING', 0, 0]);
  assert.equal(c.candidate?.head, 'H1');
  assert.deepEqual(c, store.load('c1'));
  assert.equal(adapter.requests[0].role, 'developer');
  assert.equal(adapter.requests[0].runId, c.runs[0].runId);

  store.append('c1', { type: 'verification', head: 'H1', checks: PASS_CHECKS });
  const reviewer = fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', verdict: 'PASS', findings: [] } } });
  const after = await execute(store, 'c1', reviewer, { ...req, role: 'standard_reviewer' }, { deadlineMs: 5000 });
  assert.deepEqual(stage(after), ['ADVERSARIAL_REVIEW', 1, 0]);
  assert.deepEqual(after, store.load('c1'));
  store.close();
});

test('malformed: a claim the store cannot classify escalates as run_failed "malformed result"', async () => {
  for (const claim of [{ head: 'H1', artifacts: 'r' }, { head: 'H1' }, 'done', null, 42]) {
    const store = fresh();
    const c = await dev(store, { outcome: { status: 'completed', claim } });
    assert.equal(c.stage, 'ESCALATED', JSON.stringify(claim));
    assert.match(c.escalation ?? '', /malformed result/, JSON.stringify(claim));
    assert.equal(c.history.at(-1)!.event.type, 'run_failed');
    assert.deepEqual(c, store.load('c1'));
    store.close();
  }
  // A missing head is a well-formed developer_result that apply itself rejects (SC-07); it is
  // recorded as the result it was, not as run_failed, and escalates the same way.
  const store = fresh();
  const c = await dev(store, { outcome: { status: 'completed', claim: { artifacts: ['r'] } } });
  assert.equal(c.stage, 'ESCALATED');
  assert.equal(c.history.at(-1)!.event.type, 'developer_result');
  assert.match(c.escalation ?? '', /missing commit/);
  store.close();
});

test('timeout: the deadline wins against an adapter that honours abort and one that ignores it', async () => {
  for (const step of ['hang', 'ignore-abort'] as const) {
    const store = fresh();
    const adapter = fakeAdapter(step);
    const started = Date.now();
    const c = await execute(store, 'c1', adapter, { ...req, role: 'developer' }, { deadlineMs: 50, base: 'B1' });
    const took = Date.now() - started;
    assert.ok(took < 1050, `${step}: took ${took}ms`);
    assert.equal(c.stage, 'ESCALATED', step);
    assert.match(c.escalation ?? '', /timeout/, step);
    assert.deepEqual(c, store.load('c1'));
    store.close();
  }
});

test('timeout: a settle that arrives after the deadline changes nothing', async () => {
  const store = fresh();
  const c = await dev(store, { outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } }, afterMs: 150 }, 50);
  assert.match(c.escalation ?? '', /timeout/);
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(store.load('c1'), c);
  assert.equal(store.events('c1').length, 2);
  store.close();
});

test('cancelled and failed outcomes escalate with their reason', async () => {
  const a = fresh();
  const cancelled = await dev(a, { outcome: { status: 'cancelled' } });
  assert.equal(cancelled.stage, 'ESCALATED');
  assert.match(cancelled.escalation ?? '', /cancelled/);
  a.close();
  const b = fresh();
  const failed = await dev(b, { outcome: { status: 'failed', reason: 'ENOENT claude' } });
  assert.equal(failed.stage, 'ESCALATED');
  assert.match(failed.escalation ?? '', /ENOENT claude/);
  b.close();
});

test('duplicate: the same run outcome received twice changes nothing', async () => {
  const store = fresh();
  for (const e of toStandardReview) store.append('c1', e);
  const outcome = { status: 'completed', claim: { head: 'H1', verdict: 'PASS' } } as const;
  const first = receive(store, 'c1', 'sr1', 'standard_reviewer', outcome);
  assert.deepEqual(stage(first), ['ADVERSARIAL_REVIEW', 1, 0]);
  const second = receive(store, 'c1', 'sr1', 'standard_reviewer', outcome);
  assert.deepEqual(second, first);
  assert.equal(store.events('c1').length, toStandardReview.length + 1);
  // Same for a failure: one run_failed per run ID.
  const other = fresh();
  for (const e of toStandardReview) other.append('c1', e);
  const f1 = receive(other, 'c1', 'sr1', 'standard_reviewer', { status: 'failed', reason: 'crash' });
  const f2 = receive(other, 'c1', 'sr1', 'standard_reviewer', { status: 'failed', reason: 'crash' });
  assert.deepEqual(f2, f1);
  assert.equal(other.events('c1').length, toStandardReview.length + 1);
  store.close();
  other.close();
});

test('the controller mints a fresh run ID per execute and does not start a run the cycle refuses', async () => {
  const store = fresh();
  const adapter = fakeAdapter(
    { outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } } },
    { outcome: { status: 'completed', claim: { head: 'H2', artifacts: ['r'] } } },
  );
  const a = await execute(store, 'c1', adapter, { ...req, role: 'developer' }, { deadlineMs: 5000, base: 'B1' });
  // Cycle is VERIFYING: a second claim is "claim outside QUEUED" and escalates. The adapter is never started.
  const b = await execute(store, 'c1', adapter, { ...req, role: 'developer' }, { deadlineMs: 5000, base: 'B1' });
  assert.equal(adapter.requests.length, 1);
  assert.equal(b.stage, 'ESCALATED');
  assert.notEqual(a.runs[0].runId, b.history.at(-1)!.event.type === 'claim' ? (b.history.at(-1)!.event as { runId: string }).runId : '');
  assert.match(a.runs[0].runId, /^[0-9a-f-]{36}$/);
  store.close();
});

test('errors other than an unclassifiable claim propagate; nothing is written', async () => {
  const store = fresh();
  store.close();
  await assert.rejects(dev(store, { outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } } }), (err: Error) => !/malformed/.test(err.message));
});
