// Ticket 04-a: the only non-test caller of EventStore.append. Starts a run through an adapter,
// bounds it with a deadline, and turns the outcome into exactly one lifecycle event.
import { randomUUID } from 'node:crypto';
import type { Adapter, RunOutcome, RunRequest } from './adapter.ts';
import type { Cycle, Event, Role } from './lifecycle.ts';
import type { EventStore } from './store.ts';

export interface ExecuteOptions {
  /** Wall-clock bound on the run. Required: a launch without one can hold a cycle forever (03-a finding). */
  deadlineMs: number;
  /** Base SHA for the developer's claim event; unused for reviewers. */
  base?: string;
}

/** Mint a run ID, claim the cycle for a developer, start the adapter, and record the outcome. */
export async function execute(
  store: EventStore,
  cycleId: string,
  adapter: Adapter,
  req: Omit<RunRequest, 'runId'>,
  opts: ExecuteOptions,
): Promise<Cycle> {
  const runId = randomUUID();
  if (req.role === 'developer') {
    if (!opts.base) throw new Error('developer run needs a base SHA');
    const claimed = store.append(cycleId, { type: 'claim', runId, base: opts.base });
    // apply may have ignored the claim (another developer active) or escalated it. Either way
    // the cycle did not accept this run, so nothing is launched.
    if (!claimed.runs.some((r) => r.runId === runId)) return claimed;
  }
  const outcome = await bounded(adapter, { ...req, runId }, opts.deadlineMs);
  return receive(store, cycleId, runId, req.role, outcome);
}

/**
 * Record one run's outcome against the cycle. Idempotent per run ID: the store dedups results,
 * verdicts and run_failed, so a redelivery returns the current Cycle unchanged.
 */
export function receive(store: EventStore, cycleId: string, runId: string, role: Role, outcome: RunOutcome): Cycle {
  if (outcome.status !== 'completed') {
    const reason = outcome.status === 'failed' ? outcome.reason : 'cancelled';
    return store.append(cycleId, { type: 'run_failed', runId, reason });
  }
  try {
    return store.append(cycleId, toEvent(runId, role, outcome.claim));
  } catch (err) {
    // Only the store's own classification failure is a malformed claim. Anything else (a closed
    // database, a cycle that is not open) is the controller's problem and must surface.
    if (!(err instanceof Error) || !err.message.startsWith('unclassifiable event')) throw err;
    return store.append(cycleId, { type: 'run_failed', runId, reason: 'malformed result' });
  }
}

// Builds the event shape from whatever the runtime sent and lets the store's isEvent decide.
// Picking named fields means a claim that is not an object becomes an event with missing fields,
// which is rejected the same way as one with wrong fields.
function toEvent(runId: string, role: Role, claim: unknown): Event {
  const c = (typeof claim === 'object' && claim !== null ? claim : {}) as Record<string, unknown>;
  if (role === 'developer') return { type: 'developer_result', runId, head: c.head, artifacts: c.artifacts } as Event;
  return { type: 'verdict', runId, head: c.head, verdict: c.verdict, findings: c.findings } as Event;
}

// The deadline is decided here, before the adapter is told to stop, so the outcome is `timeout`
// whether the adapter then settles `cancelled`, settles late, or never settles. A late settle or
// rejection is dropped.
function bounded(adapter: Adapter, req: RunRequest, deadlineMs: number): Promise<RunOutcome> {
  const ac = new AbortController();
  return new Promise<RunOutcome>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ status: 'failed', reason: 'timeout' });
      ac.abort();
    }, deadlineMs);
    let started: Promise<RunOutcome>;
    try {
      started = adapter.start(req, ac.signal);
    } catch (err) {
      started = Promise.reject(err);
    }
    started.then(
      (o) => { clearTimeout(timer); resolve(o); },
      (err) => { clearTimeout(timer); resolve({ status: 'failed', reason: `adapter threw: ${String(err)}` }); },
    );
  });
}
