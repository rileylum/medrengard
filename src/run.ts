// Ticket 07-b: the loop. Calls develop, then whichever stage module the cycle's stage names,
// until the cycle reaches a stage no module acts on. It never decides a transition: apply does,
// from what each stage records. A stage that throws is the spec's "cannot classify": the cycle
// is escalated with the message and the owner decides.
import type { Adapter } from './adapter.ts';
import { develop, fix, type DeveloperAdapter, type Job } from './developer.ts';
import type { Cycle } from './lifecycle.ts';
import { review } from './review.ts';
import { checkSandbox, type Sandbox } from './sandbox.ts';
import type { EventStore } from './store.ts';
import { verify, type VerifyOptions } from './verify.ts';

export interface Adapters {
  developer: DeveloperAdapter;
  standard: Adapter;
  adversarial: Adapter;
}

export interface RunOptions {
  /** Per stage: the developer run, each check, each reviewer run. */
  deadlineMs: number;
  /** Shared by every stage. Default /var/tmp/software_factory/runs. */
  runsDir?: string;
  /** Passed to verify. Default cgroup. */
  isolation?: VerifyOptions['isolation'];
  /** Passed to review. Default ['AGENTS.md']. */
  instructions?: string[];
  /** Passed to verify. Default bwrap. */
  sandbox?: Sandbox;
}

export interface RunResult {
  cycle: Cycle;
  /** `sf/<cycleId>` in the job's repository: with no remote, this is the PR the owner diffs and merges. */
  branch: string;
  worktree: string;
  /** Set when a stage threw: the message, after the cycle was escalated with it. */
  error?: string;
}

// The lifecycle's budgets bound a cycle at two developer runs, two verifications and three
// reviews. Reaching this cap means a stage returned without moving the cycle: a controller bug.
const MAX_STEPS = 10;

/** Drive one job from open to a stage the loop cannot leave. Never advances a stage itself. */
export async function run(store: EventStore, adapters: Adapters, job: Job, opts: RunOptions): Promise<RunResult> {
  // Before develop: a sandbox that cannot start would fail verification after a paid developer run.
  checkSandbox(opts.sandbox ?? { backend: 'bwrap' });
  // A throw here propagates: develop cancels any cycle it opened, so there is nothing to record.
  const { cycle: opened, worktree, branch } = await develop(store, adapters.developer, job, opts);
  const { cycleId } = opened;
  let cycle = opened;
  for (let step = 0; ; step++) {
    const stage = cycle.stage;
    try {
      switch (stage) {
        // Reached only after a standard FAIL: apply never returns a cycle to DEVELOPING otherwise.
        case 'DEVELOPING': cycle = (await fix(store, adapters.developer, cycleId, job, opts)).cycle; break;
        case 'VERIFYING': cycle = (await verify(store, cycleId, job, opts)).cycle; break;
        case 'STANDARD_REVIEW': cycle = await review(store, adapters.standard, cycleId, job, opts); break;
        case 'ADVERSARIAL_REVIEW': cycle = await review(store, adapters.adversarial, cycleId, job, opts); break;
        default: return { cycle, worktree, branch };
      }
      if (step + 1 >= MAX_STEPS) throw new Error(`loop made ${step + 1} steps without stopping; last stage ${stage}`);
    } catch (err) {
      const error = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
      // reject_dispatch is the one event that escalates with a reason and counts nothing. The
      // worktree and checkout stay for the owner to read.
      return { cycle: store.append(cycleId, { type: 'reject_dispatch', reason: error }), worktree, branch, error };
    }
  }
}
