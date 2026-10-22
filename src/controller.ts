// Ticket 04-a: the only non-test caller of EventStore.append. Starts a run through an adapter,
// bounds it with a deadline, and turns the outcome into exactly one lifecycle event.
import { randomUUID } from 'node:crypto';
import type { Adapter, RunOutcome, RunRequest } from './adapter.ts';
import { runDir } from './layout.ts';
import { producedBy, STOPPED, type Cycle, type Event, type PromptVersions, type Role, type RunVersions } from './lifecycle.ts';
import { oneLine } from './prompt.ts';
import { UnclassifiableEvent, type EventStore } from './store.ts';

export interface ExecuteOptions {
  /** Wall-clock bound on the run. Required: a launch without one can hold a cycle forever (03-a finding). */
  deadlineMs: number;
  /** Base SHA for the developer's claim event; unused for reviewers. */
  base?: string;
  /**
   * The caller's check on a completed claim, run on the plain copy before it is recorded: the
   * spec's "commit exists" needs Git, which the lifecycle cannot run. Return a reason to refuse
   * the claim (recorded as run_failed, so the cycle escalates), undefined to let the store
   * classify it. A throw is a refusal too. Not called for failed or cancelled runs.
   */
  accept?: (claim: unknown) => string | undefined;
  /** Recorded on the run's outcome event. develop, fix and review always pass it; optional for tests that drive execute directly. */
  versions?: PromptVersions;
  /** Where the run's folder goes (11-e). Default the layout's. */
  runsDir?: string;
}

// setTimeout silently clamps anything outside this range to 1 ms, which would time every run out.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
// How often a run in flight reloads its cycle to see whether another process settled it (an
// owner's cancel). A reload replays the cycle's events in well under a millisecond, so the price of
// a longer period is only a later abort of a paid run.
const WATCH_MS = 1000;

/** Throws for a deadline execute would refuse. Exported so a caller can fail before it opens anything. */
export function checkDeadline(deadlineMs: number): void {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > MAX_TIMEOUT_MS)
    throw new Error(`deadlineMs must be a positive integer at or below ${MAX_TIMEOUT_MS}, got ${String(deadlineMs)}`);
}

/** Mint a run ID, record its start (a claim for a developer, run_started for a reviewer), start the adapter, and record the outcome. */
export async function execute(
  store: EventStore,
  cycleId: string,
  adapter: Adapter,
  req: Omit<RunRequest, 'runId'>,
  opts: ExecuteOptions,
): Promise<Cycle> {
  const { deadlineMs } = opts;
  checkDeadline(deadlineMs);
  const runId = randomUUID();
  if (producedBy(store.workflow, req.role) === 'commit') {
    if (!opts.base) throw new Error('developer run needs a base SHA');
    const claimed = store.append(cycleId, { type: 'claim', runId, base: opts.base, runtime: adapter.name });
    // apply may have ignored the claim (another developer active) or escalated it. Either way
    // the cycle did not accept this run, so nothing is launched.
    if (!claimed.runs.some((r) => r.runId === runId)) return claimed;
  } else {
    requireStage(store, cycleId, req.role);
    // Before the launch, so a run whose controller dies is always on record (11-e). As for a
    // claim: a cycle that did not take the run (settled or escalated meanwhile) launches nothing.
    const started = store.append(cycleId, { type: 'run_started', runId, runtime: adapter.name });
    if (!started.runs.some((r) => r.runId === runId)) return started;
  }
  // A store that cannot be read is skipped for that tick: recording the outcome reads it again,
  // and its error surfaces there, not as an uncaught throw from a timer.
  const settled = () => {
    try { const stage = store.load(cycleId)?.stage; return stage !== undefined && STOPPED.includes(stage); } catch { return false; }
  };
  const outcome = await bounded(adapter, { ...req, runId, runDir: runDir(opts.runsDir, runId), deadlineMs }, deadlineMs, settled);
  const versions: Partial<RunVersions> = { ...opts.versions, runtime: adapter.name, ...(adapter.moduleHash === undefined ? {} : { moduleHash: adapter.moduleHash }) };
  return receive(store, cycleId, runId, req.role, outcome, opts.accept, versions);
}

/**
 * Record one run's outcome against the cycle. Idempotent per run ID: the store keeps one outcome
 * per run, so a redelivery returns the current Cycle unchanged. Never throws for what the adapter
 * returned; only for the controller's own misuse (wrong stage, unopened cycle) or a store failure.
 */
export function receive(store: EventStore, cycleId: string, runId: string, role: Role, outcome: RunOutcome, accept?: ExecuteOptions['accept'], versions?: Partial<RunVersions>): Cycle {
  const commit = producedBy(store.workflow, role) === 'commit';
  if (!commit) requireStage(store, cycleId, role, runId);
  const o = normalise(plain(outcome));
  if (o.status !== 'completed') {
    return store.append(cycleId, { type: 'run_failed', runId, reason: o.status === 'failed' ? o.reason : 'cancelled', ...versions });
  }
  const refused = accept ? refusal(accept, o.claim) : undefined;
  if (refused !== undefined) return store.append(cycleId, { type: 'run_failed', runId, reason: refused, ...versions });
  try {
    return store.append(cycleId, { ...toEvent(runId, commit, o.claim), ...versions });
  } catch (err) {
    // Only the store's own classification failure is a malformed claim. Anything else (a closed
    // database, a cycle that is not open) is the controller's problem and must surface.
    if (!(err instanceof UnclassifiableEvent)) throw err;
    return store.append(cycleId, { type: 'run_failed', runId, reason: 'malformed result', ...versions });
  }
}

// accept runs Git over a claim the runtime wrote; a throw (or an empty reason) must still end as
// one well-formed run_failed, never as an exception out of receive.
function refusal(accept: NonNullable<ExecuteOptions['accept']>, claim: unknown): string | undefined {
  try {
    const r: unknown = accept(claim);
    if (r === undefined) return undefined;
    // Types are stripped, not checked: a non-string reason would fail isEvent and escape as a throw.
    return typeof r === 'string' && r ? r : `accept refused the claim: ${describe(r)}`;
  } catch (err) {
    return `accept threw: ${describe(err)}`;
  }
}

// A reviewer verdict is counted against whatever review stage the cycle is in, so a run for the
// wrong role would be miscounted. Refuse to start or record one; this is a controller bug, not a
// runtime outcome, so it throws rather than escalating the cycle. Exempt: a run that already has
// its outcome (redelivery is a no-op), and a cycle that is escalated or terminal (apply ignores
// everything, so nothing can be miscounted and a cancel mid-review must not throw).
function requireStage(store: EventStore, cycleId: string, role: Role, runId?: string): void {
  const cycle = store.drivable(cycleId);
  if (runId !== undefined && (cycle.consumed.includes(runId) || STOPPED.includes(cycle.stage))) return;
  const def = store.workflow.stages[cycle.stage];
  if (def?.kind === 'agent' && def.role === role) return;
  const expected = Object.entries(store.workflow.stages).find(([, d]) => d.kind === 'agent' && d.role === role)?.[0];
  throw new Error(`${role} run on a cycle in ${cycle.stage}, expected ${expected ?? `a stage for role ${role}`}`);
}

// The adapter contract is plain data, and "plain" means what the store can persist: a JSON round
// trip, not structuredClone, because BigInt and cycles clone fine and then throw a bare TypeError
// out of JSON.stringify in append. The round trip runs every getter, trap and toJSON once, here,
// inside the catch; what comes out has none, so no later read or write in this path can throw.
function plain(outcome: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(outcome));
  } catch {
    return { status: 'failed', reason: 'adapter outcome is not plain data' };
  }
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

// String(x) throws for a null-prototype object or a Symbol, and the Object.prototype.toString
// fallback reads Symbol.toStringTag, which can throw too; a reason must never throw.
function describe(v: unknown): string {
  try { return String(v); } catch { /* fall through */ }
  try { return Object.prototype.toString.call(v); } catch { return '[value that cannot be described]'; }
}

// Builds the event shape from whatever the runtime sent and lets the store's isEvent decide.
// Picking named fields means a claim that is not an object becomes an event with missing fields,
// which is rejected the same way as one with wrong fields.
function toEvent(runId: string, commit: boolean, claim: unknown): Event {
  const c = (typeof claim === 'object' && claim !== null ? claim : {}) as Record<string, unknown>;
  // A non-string or empty dispute fails the event's shape check and becomes "malformed result".
  if (commit && c.dispute !== undefined) return { type: 'dispute', runId, head: c.head, reason: typeof c.dispute === 'string' ? disputeReason(c.dispute) : c.dispute } as Event;
  if (commit) return { type: 'developer_result', runId, head: c.head, artifacts: c.artifacts } as Event;
  return { type: 'verdict', runId, head: c.head, verdict: c.verdict, findings: c.findings } as Event;
}

// The reason reaches the owner's terminal through the escalation: one line (07-c), and bounded so
// a developer cannot bury the head of it. The owner approved 2 KiB (A-072).
const DISPUTE_MAX = 2048;
function disputeReason(text: string): string {
  const r = oneLine(text);
  return r.length <= DISPUTE_MAX ? r : `${r.slice(0, DISPUTE_MAX)} [... ${r.length - DISPUTE_MAX} characters cut]`;
}

// The deadline or a settled cycle resolves the race, then aborts the adapter;
// whatever the adapter does afterwards (settle `cancelled`, settle late, reject, or nothing) lands
// on an already-settled promise and is dropped. So the outcome is `timeout` or `cancelled` for
// every adapter, including one that ignores abort. The adapter kills its process tree on abort.
function bounded(adapter: Adapter, req: RunRequest, deadlineMs: number, settled: () => boolean): Promise<RunOutcome> {
  const ac = new AbortController();
  return new Promise<RunOutcome>((resolve) => {
    let done = false;
    // resolve runs before the clears: if anything here could still throw, the outcome is in.
    const finish = (o: RunOutcome) => {
      if (done) return;
      done = true;
      resolve(o);
      clearTimeout(timer);
      clearInterval(watch);
    };
    const stop = (o: RunOutcome) => { if (!done) { finish(o); ac.abort(); } };
    const timer = setTimeout(() => stop({ status: 'failed', reason: 'timeout' }), deadlineMs);
    // unref: the run, not the watch, is what this process waits for. `?.` because the guide runs
    // this file in a browser, where a timer is a number.
    const watch = setInterval(() => { if (settled()) stop({ status: 'cancelled' }); }, WATCH_MS);
    watch.unref?.();
    // Wrapped in a Promise so a synchronous throw from start() is a rejection, not an escape.
    new Promise<RunOutcome>((res) => res(adapter.start(req, ac.signal))).then(
      finish,
      (err) => finish({ status: 'failed', reason: `adapter threw: ${describe(err)}` }),
    );
  });
}
