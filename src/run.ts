// Ticket 07-b: the loop. Calls develop, then whichever step the cycle's stage kind names, until
// the cycle reaches a stage no step acts on. It never decides a transition: apply does, from what
// each step records. A step that throws is the spec's "cannot classify": the cycle is escalated
// with the message and the owner decides. Ticket 09-b: any workflow that passes checkWorkflow,
// read from the store; adapters are chosen by the stage's role.
import { join, resolve } from 'node:path';
import type { Adapter } from './adapter.ts';
import { DEFAULT_RUNS_DIR, develop, fix, type DeveloperAdapter, type Job } from './developer.ts';
import { fileArgs, type Cycle, type Role, type Workflow } from './lifecycle.ts';
import { review } from './review.ts';
import { checkSandbox, type Sandbox } from './sandbox.ts';
import type { EventStore } from './store.ts';
import { noWorkflowDir, stageGrants, verify, type VerifyOptions } from './verify.ts';

/** By role. A commit role may be a factory per worktree; a verdict role must be an Adapter. */
export type Adapters = Record<Role, DeveloperAdapter>;

/**
 * Keys callers and job files used before 09-b, renamed to the default workflow's roles. Only
 * these: any other key is taken as a role. Removing an entry breaks existing job files.
 */
export const ROLE_ALIASES: Record<string, Role> = { standard: 'standard_reviewer', adversarial: 'adversarial_reviewer' };

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
  /** Passed to verify: the workflow file's folder (Config.workflowDir). */
  workflowDir?: string;
  /** Passed to verify: what a grant stage may hold (Config.grants). */
  grants?: VerifyOptions['grants'];
}

export interface RunResult {
  cycle: Cycle;
  /** `sf/<cycleId>` in the job's repository: with no remote, this is the PR the owner diffs and merges. */
  branch: string;
  worktree: string;
  /** Set when a stage threw: the message, after the cycle was escalated with it. */
  error?: string;
}

/** Drive one job from open to a stage the loop cannot leave. Never advances a stage itself. */
export async function run(store: EventStore, adapters: Adapters, job: Job, opts: RunOptions): Promise<RunResult> {
  // Before develop: a sandbox that cannot start would fail verification after a paid developer run.
  checkSandbox(opts.sandbox ?? { backend: 'bwrap' });
  // Before develop too: verify would refuse it, but only after a paid developer run.
  if (opts.workflowDir === undefined)
    for (const [name, def] of Object.entries(store.workflow.stages))
      for (const file of def.kind === 'command' ? (def.run ?? []).flatMap(fileArgs) : []) throw new Error(noWorkflowDir(name, file));
  for (const [name, def] of Object.entries(store.workflow.stages)) stageGrants(name, def, opts.grants, opts.sandbox);
  const roles = byRole(store.workflow, adapters);
  const start = store.workflow.stages[store.workflow.start];
  // checkWorkflow allows a start stage with no role; develop refuses it before using the adapter.
  const developer = roles[start?.kind === 'agent' ? start.role : ''] as DeveloperAdapter;
  // A throw here propagates: develop cancels any cycle it opened, so there is nothing to record.
  const { cycle, worktree, branch } = await develop(store, developer, job, opts);
  return drive(store, cycle, roles, job, opts, worktree, branch);
}

/** Continue a cycle from its stored stage, as run would after develop. Settled cycles come back unchanged. */
export async function resume(store: EventStore, cycleId: string, adapters: Adapters, job: Job, opts: RunOptions): Promise<RunResult> {
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  // Nothing has run, so there is no clone to continue from; recovery (row 11) owns this case.
  if (cycle.stage === 'QUEUED') throw new Error(`cycle ${cycleId} is QUEUED: no run started; cancel it and run the job again`);
  checkSandbox(opts.sandbox ?? { backend: 'bwrap' });
  const roles = byRole(store.workflow, adapters);
  // Where develop put them.
  const worktree = join(resolve(opts.runsDir ?? DEFAULT_RUNS_DIR), cycleId);
  return drive(store, cycle, roles, job, opts, worktree, `sf/${cycleId}`);
}

/** Adapters keyed by role, aliases renamed; throws for an agent stage whose role has none. */
function byRole(w: Workflow, adapters: Adapters): Adapters {
  const roles = Object.fromEntries(Object.entries(adapters).map(([k, a]) => [ROLE_ALIASES[k] ?? k, a]));
  for (const [name, def] of Object.entries(w.stages))
    if (def.kind === 'agent' && !roles[def.role]) throw new Error(`no adapter for role ${def.role} (stage ${name})`);
  return roles;
}

/**
 * checkWorkflow refuses a loop that spends no budget, so between two budget spends a cycle visits
 * each stage at most once. Reaching this means a step returned without moving the cycle: a
 * controller bug.
 */
function stepCap(w: Workflow): number {
  const stages = Object.values(w.stages);
  return (stages.reduce((sum, d) => sum + (d.budget ?? 0), 0) + 1) * stages.length;
}

async function drive(store: EventStore, opened: Cycle, roles: Adapters, job: Job, opts: RunOptions, worktree: string, branch: string): Promise<RunResult> {
  const w = store.workflow;
  const cap = stepCap(w);
  const { cycleId } = opened;
  let cycle = opened;
  for (let step = 0; ; step++) {
    const stage = cycle.stage;
    const def = w.stages[stage];
    try {
      if (def?.kind === 'agent' && def.produces === 'commit') cycle = (await fix(store, roles[def.role]!, cycleId, job, opts)).cycle;
      else if (def?.kind === 'agent') cycle = await review(store, roles[def.role] as Adapter, cycleId, job, opts);
      else if (def?.kind === 'command') cycle = (await verify(store, cycleId, job, opts)).cycle;
      // A human stage, or an engine stage (QUEUED aside, which develop has left): the owner's move.
      else return { cycle, worktree, branch };
      if (step + 1 >= cap) throw new Error(`loop made ${step + 1} steps without stopping; last stage ${stage}`);
    } catch (err) {
      const error = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
      // reject_dispatch is the one event that escalates with a reason and counts nothing. The
      // worktree and checkout stay for the owner to read.
      return { cycle: store.append(cycleId, { type: 'reject_dispatch', reason: error }), worktree, branch, error };
    }
  }
}
