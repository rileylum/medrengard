// Ticket 04-a: normal, malformed, timeout, cancel and duplicate outcomes each drive the state
// machine correctly, observed only through execute()'s return value and store.load().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultWorkflow, type Cycle } from '../src/lifecycle.ts';
import { EventStore } from '../src/store.ts';
import { execute, receive } from '../src/controller.ts';
import { fakeAdapter, type Step } from './fake-adapter.ts';
import { PASS_CHECKS, toStandardReview } from './scenarios.ts';
import { ownerCheck } from './workflows.ts';

const dir = mkdtempSync(join(tmpdir(), 'sf-controller-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
const fresh = () => {
  const store = new EventStore(join(dir, `${n++}.sqlite`));
  store.open('c1', 'w1');
  return store;
};
const stage = (c: Cycle) => [c.stage, c.budgets.STANDARD_REVIEW ?? 0, c.budgets.ADVERSARIAL_REVIEW ?? 0];
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
    assert.equal(adapter.aborted, 1, `${step}: adapter was told to stop`);
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
  const refused = b.history.at(-1)!.event as { type: string; runId: string };
  assert.equal(refused.type, 'claim');
  assert.notEqual(refused.runId, a.runs[0].runId);
  assert.match(a.runs[0].runId, /^[0-9a-f-]{36}$/);
  store.close();
});

test('errors other than an unclassifiable claim propagate from receive; no run_failed is attempted', () => {
  // A store that fails for its own reasons (disk, closed handle). The controller must not read
  // that as a malformed claim and try to write run_failed on top of it.
  let appends = 0;
  const broken = { workflow: defaultWorkflow, append() { appends++; throw new Error('disk full'); } } as unknown as EventStore;
  assert.throws(() => receive(broken, 'c1', 'dev1', 'developer', { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } }), /disk full/);
  assert.equal(appends, 1);
  // And execute: a claim that cannot be written stops before any launch.
  const store = fresh();
  store.close();
  return assert.rejects(dev(store, { outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } } }), (err: Error) => !/malformed/.test(err.message));
});

// 04-b: the adversarial findings on 3ba5434.

test('a failed outcome with no usable reason, or an outcome outside the union, still records run_failed', async () => {
  const outcomes = [
    { status: 'failed', reason: '' },
    { status: 'failed', reason: 42 },
    { status: 'failed' },
    { status: 'bogus' },
    undefined,
    null,
    'done',
  ];
  for (const outcome of outcomes) {
    const store = fresh();
    const c = await dev(store, { outcome: outcome as never });
    assert.equal(c.stage, 'ESCALATED', JSON.stringify(outcome));
    const last = c.history.at(-1)!.event as { type: string; reason: string };
    assert.equal(last.type, 'run_failed', JSON.stringify(outcome));
    assert.ok(last.reason.length > 0, JSON.stringify(outcome));
    assert.deepEqual(c, store.load('c1'));
    store.close();
  }
});

test('an adapter that rejects with an unprintable value, or throws synchronously, cannot hang execute', async () => {
  const adapters = [
    { name: 'rejects-null-proto', start: () => Promise.reject(Object.create(null)) },
    { name: 'rejects-undefined', start: () => Promise.reject(undefined) },
    { name: 'throws', start: () => { throw new Error('boom'); } },
  ];
  for (const adapter of adapters) {
    const store = fresh();
    const started = Date.now();
    const c = await execute(store, 'c1', adapter, { ...req, role: 'developer' }, { deadlineMs: 2000, base: 'B1' });
    assert.ok(Date.now() - started < 1000, `${adapter.name}: settled before the deadline`);
    assert.equal(c.stage, 'ESCALATED', adapter.name);
    assert.equal(c.history.at(-1)!.event.type, 'run_failed', adapter.name);
    store.close();
  }
});

test('execute rejects a deadline setTimeout would not honour, before writing anything', async () => {
  for (const deadlineMs of [NaN, 0, -1, 0.5, Infinity, 2 ** 31, '1000']) {
    const store = fresh();
    const adapter = fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } } });
    await assert.rejects(execute(store, 'c1', adapter, { ...req, role: 'developer' }, { deadlineMs: deadlineMs as number, base: 'B1' }), /deadlineMs/, String(deadlineMs));
    assert.equal(store.events('c1').length, 0, String(deadlineMs));
    assert.equal(adapter.requests.length, 0, String(deadlineMs));
    store.close();
  }
});

test('a reviewer run starts only when the cycle is in the stage for its role', async () => {
  const cases: [string, 'standard_reviewer' | 'adversarial_reviewer', number][] = [
    ['QUEUED', 'standard_reviewer', 0],
    ['STANDARD_REVIEW', 'adversarial_reviewer', 3],
    ['ADVERSARIAL_REVIEW', 'standard_reviewer', 4],
  ];
  const upTo = [...toStandardReview, { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' } as const];
  for (const [stageName, role, n] of cases) {
    const store = fresh();
    for (const e of upTo.slice(0, n)) store.append('c1', e);
    assert.equal(store.load('c1')!.stage, stageName);
    const adapter = fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', verdict: 'PASS' } } });
    await assert.rejects(execute(store, 'c1', adapter, { ...req, role }, { deadlineMs: 1000 }), new RegExp(`${role}.*${stageName}`));
    assert.equal(adapter.requests.length, 0, `${role} on ${stageName}`);
    assert.equal(store.load('c1')!.stage, stageName);
    assert.throws(() => receive(store, 'c1', 'x1', role, { status: 'completed', claim: { head: 'H1', verdict: 'PASS' } }), new RegExp(role));
    assert.equal(store.load('c1')!.stage, stageName);
    store.close();
  }
  // Unopened cycle: nothing to check against, nothing starts.
  const store = fresh();
  const adapter = fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', verdict: 'PASS' } } });
  await assert.rejects(execute(store, 'nope', adapter, { ...req, role: 'standard_reviewer' }, { deadlineMs: 1000 }), /not open/);
  assert.equal(adapter.requests.length, 0);
  store.close();
});

// 04-c: the adversarial findings on 8664c1b. Values no runtime can produce, but a buggy in-process
// adapter can; none may keep execute from settling or leave a run without an outcome.

const throwingTag = () => Object.defineProperty({}, Symbol.toStringTag, { get() { throw new Error('tag'); } });
const throwingProxy = () => new Proxy({}, { get() { throw new Error('trap'); } });
const throwingGetter = (key: string, rest: Record<string, unknown> = {}) =>
  Object.defineProperty({ ...rest }, key, { get() { throw new Error(`${key} getter`); }, enumerable: true });

test('a rejection value that cannot be described still settles execute with run_failed', async () => {
  for (const [name, value] of [['toStringTag throws', throwingTag()], ['proxy trap throws', throwingProxy()]] as const) {
    const store = fresh();
    const started = Date.now();
    const c = await execute(store, 'c1', { name, start: () => Promise.reject(value) }, { ...req, role: 'developer' }, { deadlineMs: 2000, base: 'B1' });
    assert.ok(Date.now() - started < 1000, `${name}: settled`);
    assert.equal(c.stage, 'ESCALATED', name);
    assert.equal(c.history.at(-1)!.event.type, 'run_failed', name);
    store.close();
  }
});

test('an outcome or claim with throwing getters or traps records run_failed and does not strand the cycle', async () => {
  const outcomes: [string, unknown][] = [
    ['status getter throws', throwingGetter('status')],
    ['proxy outcome', throwingProxy()],
    ['claim head getter throws', { status: 'completed', claim: throwingGetter('head', { artifacts: ['r'] }) }],
    ['reason getter throws', throwingGetter('reason', { status: 'failed' })],
    ['function outcome', () => 'completed'],
    // Clone fine, serialise never: the store's JSON.stringify would throw a bare TypeError.
    ['bigint in claim', { status: 'completed', claim: { head: 'H1', artifacts: ['r', 10n] } }],
    ['circular claim', (() => { const a: unknown[] = ['r']; a.push(a); return { status: 'completed', claim: { head: 'H1', artifacts: a } }; })()],
  ];
  // The proxy never reaches the clone: resolving the promise reads `.then` on it and the trap
  // throws, so it is reported as a rejection ("adapter threw").
  const notPlain = ['function outcome', 'bigint in claim', 'circular claim'];
  for (const [name, outcome] of outcomes) {
    const store = fresh();
    const c = await execute(store, 'c1', { name, start: async () => outcome as never }, { ...req, role: 'developer' }, { deadlineMs: 2000, base: 'B1' });
    assert.equal(c.stage, 'ESCALATED', name);
    const last = c.history.at(-1)!.event as { type: string; reason: string };
    assert.equal(last.type, 'run_failed', name);
    assert.ok(last.reason.length > 0, name);
    if (notPlain.includes(name)) assert.equal(last.reason, 'adapter outcome is not plain data', name);
    assert.deepEqual(c, store.load('c1'), name);
    // The run has its outcome: a later developer execute is refused by the stage, not by an active run.
    const again = await dev(store, { outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } } });
    assert.doesNotMatch(again.history.at(-1)!.note ?? '', /already active/, name);
    store.close();
  }
});

test('a reviewer run whose cycle was cancelled or escalated while it ran is recorded, not thrown', async () => {
  const interruptions = [{ type: 'cancel' }, { type: 'head_changed', head: 'H2' }] as const;
  for (const interruption of interruptions) {
    const store = fresh();
    for (const e of toStandardReview) store.append('c1', e);
    const adapter = fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', verdict: 'PASS' } }, afterMs: 100 });
    const running = execute(store, 'c1', adapter, { ...req, role: 'standard_reviewer' }, { deadlineMs: 2000 });
    await new Promise((r) => setTimeout(r, 20));
    const interrupted = store.append('c1', interruption);
    const c = await running;
    assert.equal(c.stage, interrupted.stage, interruption.type);
    assert.deepEqual(stage(c), stage(interrupted), interruption.type);
    assert.deepEqual(c, store.load('c1'), interruption.type);
    assert.match(c.history.at(-1)!.note ?? '', /ignored/, interruption.type);
    store.close();
  }
});

test('the claim event records the adapter name as the runtime (05-a)', async () => {
  const store = fresh();
  const c = await dev(store, { outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } } });
  assert.equal(c.stage, 'VERIFYING');
  assert.equal(c.runs[0]!.runtime, 'fake');
  assert.equal(store.events('c1')[0]!.type, 'claim');
  assert.equal((store.events('c1')[0] as { runtime?: string }).runtime, 'fake');
});

test('accept: a reason from the caller turns a completed claim into run_failed; undefined lets it through (05-a)', async () => {
  const seen: unknown[] = [];
  const accept = (claim: unknown) => { seen.push(claim); return (claim as { head: string }).head === 'H1' ? undefined : `commit ${(claim as { head: string }).head} is not on the branch`; };
  const go = (store: EventStore, head: string) =>
    execute(store, 'c1', fakeAdapter({ outcome: { status: 'completed', claim: { head, artifacts: ['r'] } } }), { ...req, role: 'developer' }, { deadlineMs: 5000, base: 'B1', accept });
  let c = await go(fresh(), 'H1');
  assert.equal(c.stage, 'VERIFYING');
  const store = fresh();
  c = await go(store, 'H2');
  assert.equal(c.stage, 'ESCALATED');
  assert.match(c.escalation ?? '', /run failed: commit H2 is not on the branch/);
  assert.deepEqual(store.events('c1').map((e) => e.type), ['claim', 'run_failed']);
  assert.deepEqual(seen, [{ head: 'H1', artifacts: ['r'] }, { head: 'H2', artifacts: ['r'] }]);
});

test('accept sees plain data and is not consulted for failed or cancelled runs; a throwing accept is a failed run (05-a)', async () => {
  let calls = 0;
  const count = () => { calls++; return undefined; };
  let c = await execute(fresh(), 'c1', fakeAdapter({ outcome: { status: 'failed', reason: 'boom' } }), { ...req, role: 'developer' }, { deadlineMs: 5000, base: 'B1', accept: count });
  assert.equal(c.stage, 'ESCALATED');
  assert.equal(calls, 0);
  // Getters ran once in plain(); accept gets the copy.
  let reads = 0;
  const claim = { artifacts: ['r'], get head() { reads++; return 'H1'; } };
  c = await execute(fresh(), 'c1', fakeAdapter({ outcome: { status: 'completed', claim } }), { ...req, role: 'developer' }, { deadlineMs: 5000, base: 'B1', accept: (x) => { (x as { head: string }).head; (x as { head: string }).head; return undefined; } });
  assert.equal(c.stage, 'VERIFYING');
  assert.equal(reads, 1);
  c = await execute(fresh(), 'c1', fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } } }), { ...req, role: 'developer' }, { deadlineMs: 5000, base: 'B1', accept: () => { throw new Error('git exploded'); } });
  assert.equal(c.stage, 'ESCALATED');
  assert.match(c.escalation ?? '', /accept threw: Error: git exploded/);
  // 05-b: a non-string return is a refusal with a reason the store can write, not an exception.
  c = await execute(fresh(), 'c1', fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } } }), { ...req, role: 'developer' }, { deadlineMs: 5000, base: 'B1', accept: (() => 42) as unknown as () => string });
  assert.equal(c.stage, 'ESCALATED');
  assert.match(c.escalation ?? '', /accept refused the claim: 42/);
});

// Ticket 09-b: the run's role, looked up in the store's workflow, decides whether its outcome is a
// claim or a verdict and which stage it may run in; no default role name is special.
test('under another workflow, its commit role claims and its review role records a verdict in its own stage', async () => {
  const store = new EventStore(join(dir, `${n++}.sqlite`), ownerCheck);
  store.open('c1', 'w1');
  const writer = fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } } });
  const written = await execute(store, 'c1', writer, { ...req, role: 'writer' }, { deadlineMs: 5000, base: 'B1' });
  assert.equal(written.stage, 'CHECK', written.escalation);
  const early = fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', verdict: 'PASS' } } });
  await assert.rejects(execute(store, 'c1', early, { ...req, role: 'reviewer' }, { deadlineMs: 1000 }), /reviewer run on a cycle in CHECK, expected REVIEW/);
  assert.equal(early.requests.length, 0);
  const checked = store.append('c1', { type: 'verification', head: 'H1', checks: PASS_CHECKS });
  assert.equal(checked.stage, 'REVIEW');
  await assert.rejects(execute(store, 'c1', early, { ...req, role: 'standard_reviewer' }, { deadlineMs: 1000 }), /standard_reviewer run on a cycle in REVIEW, expected a stage for role standard_reviewer/);
  const reviewer = fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', verdict: 'PASS', findings: [] } } });
  const reviewed = await execute(store, 'c1', reviewer, { ...req, role: 'reviewer' }, { deadlineMs: 5000 });
  assert.equal(reviewed.stage, 'OWNER', reviewed.escalation);
  store.close();
});
