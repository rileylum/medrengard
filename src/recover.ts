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
    // One cycle the store cannot replay, or whose recovery throws (a workflow mismatch, an adapter
    // that cannot be built, git past its deadline), is the owner's; it hides none of the others.
    for (const c of cycles) {
      if (c.refused !== undefined) { out.push({ cycleId: c.cycleId, did: 'refused', reason: c.refused }); continue; }
      try {
        out.push(await resolve(store, c.cycleId, adapterFor, job, opts));
      } catch (err) {
        out.push({ cycleId: c.cycleId, did: 'refused', reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  } finally {
    release();
  }
}

async function resolve(store: EventStore, cycleId: string, adapterFor: Parameters<typeof recover>[2], job: Job, opts: RecoverOptions): Promise<Recovered> {
  // drivable, not load: an outcome recorded under another workflow would be counted against stages
  // the cycle does not have, so a mismatch is refused before anything is looked at.
  const cycle = store.drivable(cycleId);
  let done: Recovered = { cycleId, did: 'nothing', stage: cycle.stage };
  // Only an agent stage waits on its run. Anywhere else (ESCALATED, a human stage) a run can still be
  // listed unconsumed, but the cycle is the owner's: nothing is looked at, stopped or recorded.
  if (store.workflow.stages[cycle.stage]?.kind !== 'agent') return done;
  const waiting = cycle.runs.filter((r) => !cycle.consumed.includes(r.runId));
  for (const run of waiting) {
    const found = run.runtime === undefined ? undefined : adapterFor(run.runtime, run.role);
    if (!found) return { cycleId, did: 'refused', runId: run.runId, reason: `run ${run.runId}: runtime ${run.runtime ?? '(none recorded)'} is not in the registry` };
    const adapter = typeof found === 'function' ? found(cyclePaths(opts.runsDir, cycleId).clone) : found;
    const left: Left = adapter.look ? await adapter.look(run.runId, runDir(opts.runsDir, run.runId), opts.stop) : { state: 'gone' };
    if (left.state === 'running') return { cycleId, did: 'running', runId: run.runId, stage: cycle.stage };
    const commit = producedBy(store.workflow, run.role) === 'commit';
    // The hash kept at launch; a folder from before 11-f2 kept none, and the module now is all there is.
    const moduleHash = (left.state === 'running' ? undefined : left.moduleHash) ?? adapter.moduleHash;
    const versions = { runtime: adapter.name, ...(moduleHash === undefined ? {} : { moduleHash }) };
    if (left.state === 'finished' && opts.adopt) {
      // The live run's claim check, so an adopted head lands exactly as a received one would.
      const accept = commit ? landing(job, store.load(cycleId)!, run, opts) : undefined;
      done = { cycleId, did: 'received', runId: run.runId, stage: receive(store, cycleId, run.runId, run.role, left.outcome, accept, versions).stage };
      continue;
    }
    // What a developer run committed survives the next run on its branch, whatever ended it with no
    // outcome (A-105 item 3); a tip that could not be pinned is said, not silently skipped.
    const unpinned = commit ? pinTip(job, cycleId, run.runId, opts) : undefined;
    const reason = left.state === 'finished' ? 'controller died; adoption is off' : left.state === 'stopped' ? 'stopped by recover' : 'controller died; the run left no exit';
    const stage = store.append(cycleId, { type: 'run_failed', runId: run.runId, reason, ...versions }).stage;
    done = { cycleId, did: 'failed', runId: run.runId, stage, ...(unpinned === undefined ? {} : { reason: `no branch tip pinned: ${unpinned}` }) };
  }
  return done;
}
