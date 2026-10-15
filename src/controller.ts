// Ticket 04-a: the only non-test caller of EventStore.append. Starts a run through an adapter,
// bounds it with a deadline, and turns the outcome into exactly one lifecycle event.
import { randomUUID } from 'node:crypto';
import type { Adapter, RunOutcome, RunRequest } from './adapter.ts';
import type { Cycle, Event, Role, Stage } from './lifecycle.ts';
import { UnclassifiableEvent, type EventStore } from './store.ts';

export interface ExecuteOptions {
  /** Wall-clock bound on the run. Required: a launch without one can hold a cycle forever (03-a finding). */
  deadlineMs: number;
  /** Base SHA for the developer's claim event; unused for reviewers. */
  base?: string;
}

// setTimeout silently clamps anything outside this range to 1 ms, which would time every run out.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const REVIEW_STAGE: Partial<Record<Role, Stage>> = { standard_reviewer: 'STANDARD_REVIEW', adversarial_reviewer: 'ADVERSARIAL_REVIEW' };

/** Mint a run ID, claim the cycle for a developer, start the adapter, and record the outcome. */
export async function execute(
  store: EventStore,
  cycleId: string,
  adapter: Adapter,
  req: Omit<RunRequest, 'runId'>,
  opts: ExecuteOptions,
): Promise<Cycle> {
  const { deadlineMs } = opts;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > MAX_TIMEOUT_MS)
    throw new Error(`deadlineMs must be a positive integer at or below ${MAX_TIMEOUT_MS}, got ${String(deadlineMs)}`);
  const runId = randomUUID();
  if (req.role === 'developer') {
    if (!opts.base) throw new Error('developer run needs a base SHA');
    const claimed = store.append(cycleId, { type: 'claim', runId, base: opts.base });
    // apply may have ignored the claim (another developer active) or escalated it. Either way
    // the cycle did not accept this run, so nothing is launched.
    if (!claimed.runs.some((r) => r.runId === runId)) return claimed;
  } else {
    requireStage(store, cycleId, req.role);
  }
  const outcome = await bounded(adapter, { ...req, runId }, deadlineMs);
  return receive(store, cycleId, runId, req.role, outcome);
}

/**
 * Record one run's outcome against the cycle. Idempotent per run ID: the store keeps one outcome
 * per run, so a redelivery returns the current Cycle unchanged. Never throws for what the adapter
 * returned; only for the controller's own misuse (wrong stage, unopened cycle) or a store failure.
 */
export function receive(store: EventStore, cycleId: string, runId: string, role: Role, outcome: RunOutcome): Cycle {
  if (role !== 'developer') requireStage(store, cycleId, role, runId);
  const o = normalise(outcome);
  if (o.status !== 'completed') {
    return store.append(cycleId, { type: 'run_failed', runId, reason: o.status === 'failed' ? o.reason : 'cancelled' });
  }
  try {
    return store.append(cycleId, toEvent(runId, role, o.claim));
  } catch (err) {
    // Only the store's own classification failure is a malformed claim. Anything else (a closed
    // database, a cycle that is not open) is the controller's problem and must surface.
    if (!(err instanceof UnclassifiableEvent)) throw err;
    return store.append(cycleId, { type: 'run_failed', runId, reason: 'malformed result' });
  }
}

// A reviewer verdict is counted against whatever review stage the cycle is in, so a run for the
// wrong role would be miscounted. Refuse to start or record one; this is a controller bug, not a
// runtime outcome, so it throws rather than escalating the cycle. A run that already has its
// outcome recorded is exempt: its redelivery is a no-op whatever stage the cycle has reached.
function requireStage(store: EventStore, cycleId: string, role: Role, runId?: string): void {
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  if (runId !== undefined && cycle.consumed.includes(runId)) return;
  const expected = REVIEW_STAGE[role];
  if (expected && cycle.stage !== expected) throw new Error(`${role} run on a cycle in ${cycle.stage}, expected ${expected}`);
}

// Whatever the adapter actually returned, the controller must be able to write a well-formed
// run_failed for it: an empty reason or a shape outside the union is still "the run failed".
function normalise(outcome: unknown): RunOutcome {
  const o = (typeof outcome === 'object' && outcome !== null ? outcome : {}) as Partial<Record<string, unknown>>;
  if (o.status === 'completed') return { status: 'completed', claim: o.claim, sessionId: typeof o.sessionId === 'string' ? o.sessionId : undefined };
  if (o.status === 'cancelled') return { status: 'cancelled' };
  if (o.status === 'failed') return { status: 'failed', reason: typeof o.reason === 'string' && o.reason ? o.reason : 'failed with no reason' };
  return { status: 'failed', reason: `adapter returned an unknown outcome: ${describe(outcome)}` };
}

// String(x) throws for a null-prototype object or a Symbol; a reason must never throw.
function describe(v: unknown): string {
  try { return String(v); } catch { return Object.prototype.toString.call(v); }
}

// Builds the event shape from whatever the runtime sent and lets the store's isEvent decide.
// Picking named fields means a claim that is not an object becomes an event with missing fields,
// which is rejected the same way as one with wrong fields.
function toEvent(runId: string, role: Role, claim: unknown): Event {
  const c = (typeof claim === 'object' && claim !== null ? claim : {}) as Record<string, unknown>;
  if (role === 'developer') return { type: 'developer_result', runId, head: c.head, artifacts: c.artifacts } as Event;
  return { type: 'verdict', runId, head: c.head, verdict: c.verdict, findings: c.findings } as Event;
}

// The deadline resolves the race, then aborts the adapter; whatever the adapter does afterwards
// (settle `cancelled`, settle late, reject, or nothing) lands on an already-settled promise and
// is dropped. So the outcome is `timeout` for every adapter, including one that ignores abort.
function bounded(adapter: Adapter, req: RunRequest, deadlineMs: number): Promise<RunOutcome> {
  const ac = new AbortController();
  return new Promise<RunOutcome>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ status: 'failed', reason: 'timeout' });
      ac.abort();
    }, deadlineMs);
    // Wrapped in a Promise so a synchronous throw from start() is a rejection, not an escape.
    new Promise<RunOutcome>((res) => res(adapter.start(req, ac.signal))).then(
      (o) => { clearTimeout(timer); resolve(o); },
      (err) => { clearTimeout(timer); resolve({ status: 'failed', reason: `adapter threw: ${describe(err)}` }); },
    );
  });
}
