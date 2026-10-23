// Ticket 11-f: resolve the started runs a dead controller left (A-105, A-122). A run with no
// outcome is received from its folder if it finished, failed if it is gone, and reported if it is
// still going. Recover records outcomes and never launches a run or spends budget, so a timer may
// run it unattended; driving the cycle on is `resume`'s (11-f2).
import type { Left } from './adapter.ts';
import { receive } from './controller.ts';
import { landing, pinTip, type DeveloperAdapter, type Job } from './developer.ts';
import { cyclePaths, runDir } from './layout.ts';
import { producedBy, type Role, type Stage } from './lifecycle.ts';
import { holdWork, Locked } from './lock.ts';
import type { Sandbox } from './sandbox.ts';
import type { EventStore } from './store.ts';

export interface RecoverOptions {
  runsDir?: string;
  /** Receive a run that finished with no controller (A-122). False: fail it, as A-105 says. */
  adopt: boolean;
  /** End a running run and fail it, rather than leave it going. */
  stop: boolean;
  /** For git over the clone: a developer claim's check and the recovery ref. */
  deadlineMs: number;
  /** Where that git runs. Default bwrap. */
  sandbox?: Sandbox;
}

/**
 * Per unsettled cycle of the work: what recover did. `nothing`: no started run was waiting.
 * `running`: one still is. `locked`: another live process holds the work. `refused`: the store
 * cannot replay the cycle, or a run's runtime is not in the registry; nothing was recorded.
 */
export interface Recovered {
  cycleId: string;
  did: 'nothing' | 'received' | 'failed' | 'running' | 'locked' | 'refused';
  runId?: string;
  stage?: Stage;
  pid?: number;
  reason?: string;
}

/**
 * Resolves every started run with no outcome in `workId`'s unsettled cycles, holding the work's
 * lock. `adapterFor` gives the adapter for a run's recorded runtime and role, or undefined if the
 * registry has none. A cycle at a human stage, ESCALATED, or with no run waiting is left as it is.
 */
export async function recover(store: EventStore, workId: string, adapterFor: (runtime: string, role: Role) => DeveloperAdapter | undefined, job: Job, opts: RecoverOptions): Promise<Recovered[]> {
  const cycles = store.unsettled().filter((c) => c.workId === workId);
  if (cycles.length === 0) return [];
  let release: () => void;
  try {
    release = holdWork(opts.runsDir, workId);
  } catch (err) {
    if (err instanceof Locked) return cycles.map((c) => ({ cycleId: c.cycleId, did: 'locked', pid: err.pid }));
    throw err;
  }
  try {
    const out: Recovered[] = [];
    // One cycle the store cannot replay is the owner's; it hides none of the others.
    for (const c of cycles) out.push(c.refused === undefined ? await resolve(store, c.cycleId, adapterFor, job, opts) : { cycleId: c.cycleId, did: 'refused', reason: c.refused });
    return out;
  } finally {
    release();
  }
}

async function resolve(store: EventStore, cycleId: string, adapterFor: Parameters<typeof recover>[2], job: Job, opts: RecoverOptions): Promise<Recovered> {
  const cycle = store.load(cycleId)!;
  const waiting = cycle.runs.filter((r) => !cycle.consumed.includes(r.runId));
  let done: Recovered = { cycleId, did: 'nothing', stage: cycle.stage };
  for (const run of waiting) {
    const found = run.runtime === undefined ? undefined : adapterFor(run.runtime, run.role);
    if (!found) return { cycleId, did: 'refused', runId: run.runId, reason: `run ${run.runId}: runtime ${run.runtime ?? '(none recorded)'} is not in the registry` };
    const adapter = typeof found === 'function' ? found(cyclePaths(opts.runsDir, cycleId).clone) : found;
    const left: Left = adapter.look ? await adapter.look(run.runId, runDir(opts.runsDir, run.runId), opts.stop) : { state: 'gone' };
    if (left.state === 'running') return { cycleId, did: 'running', runId: run.runId, stage: cycle.stage };
    const commit = producedBy(store.workflow, run.role) === 'commit';
    const versions = { runtime: adapter.name, ...(adapter.moduleHash === undefined ? {} : { moduleHash: adapter.moduleHash }) };
    if (left.state === 'finished' && opts.adopt) {
      // The live run's claim check, so an adopted head lands exactly as a received one would.
      const accept = commit ? landing(job, store.load(cycleId)!, run, opts) : undefined;
      done = { cycleId, did: 'received', runId: run.runId, stage: receive(store, cycleId, run.runId, run.role, left.outcome, accept, versions).stage };
      continue;
    }
    // What a gone developer run committed survives the next run on its branch (A-105 item 3).
    if (left.state === 'gone' && commit) pinTip(job, cycleId, run.runId, opts);
    const reason = left.state === 'finished' ? 'controller died; adoption is off' : left.state === 'stopped' ? 'stopped by recover' : 'controller died; the run left no exit';
    done = { cycleId, did: 'failed', runId: run.runId, stage: store.append(cycleId, { type: 'run_failed', runId: run.runId, reason, ...versions }).stage };
  }
  return done;
}
