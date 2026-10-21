// Ticket 07-b: the loop. Calls develop, then whichever step the cycle's stage kind names, until
// the cycle reaches a stage no step acts on. It never decides a transition: apply does, from what
// each step records. A step that throws is the spec's "cannot classify": the cycle is escalated
// with the message and the owner decides. Ticket 09-b: any workflow that passes checkWorkflow,
// read from the store; adapters are chosen by the stage's role. Ticket 11-a: `drive` is the one
// entry point for a cycle already open; `run` opens one first.
import type { Adapter } from './adapter.ts';
import { develop, fix, type DeveloperAdapter, type Job } from './developer.ts';
import { cyclePaths } from './layout.ts';
import { apply, type Cycle, type Event, type Role, type Stage, type Workflow } from './lifecycle.ts';
import { review } from './review.ts';
import { checkSandbox, type Sandbox } from './sandbox.ts';
import type { EventStore } from './store.ts';
import { checkCommands, grantValues, headGate, missingProgram, stageFiles, stageGrants, verify, type VerifyOptions } from './verify.ts';

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
  const roles = preflight(store.workflow, adapters, job, opts);
  const start = store.workflow.stages[store.workflow.start];
  // checkWorkflow allows a start stage with no role; develop refuses it before using the adapter.
  const developer = roles[start?.kind === 'agent' ? start.role : ''] as DeveloperAdapter;
  // A throw here propagates: develop cancels any cycle it opened, so there is nothing to record.
  const { cycle, worktree, branch } = await develop(store, developer, job, opts);
  return loop(store, cycle, roles, job, opts, worktree, branch);
}

/** Continue a cycle from its stored stage, as run would after develop. Settled cycles come back unchanged. */
export async function drive(store: EventStore, cycleId: string, adapters: Adapters, job: Job, opts: RunOptions): Promise<RunResult> {
  const cycle = store.drivable(cycleId);
  // Nothing has run, so there is no clone to continue from; recovery (row 11) owns this case.
  if (cycle.stage === 'QUEUED') throw new Error(`cycle ${cycleId} is QUEUED: no run started; cancel it and run the job again`);
  const roles = preflight(store.workflow, adapters, job, opts);
  return loop(store, cycle, roles, job, opts, ...cloneOf(opts, cycleId));
}

/** What drive needs, built only when an owner's event leads to a stage the loop runs. */
export interface Drivable {
  adapters: Adapters;
  job: Job;
  opts: RunOptions;
}

/**
 * Record an owner's event, then drive the cycle on (A-129). When the event leads to a stage the
 * loop runs, `ready` and preflight run before the event is written, so a refusal writes nothing:
 * written first, the cycle would wait at that stage with no command to continue it. Otherwise the
 * event is recorded and `ready` is never called, so the default workflow's accept loads no runtime.
 * `after`: the history length the event was decided on (decide.ts); by default this call's own
 * load. Either way the append throws StaleLoad if another writer got in first (11-d, A-132). A
 * command the cycle already holds, by its command ID, is not written and not driven: `written`
 * is false, and the delivery that wrote it drives the cycle.
 */
export async function decideAndDrive(store: EventStore, cycleId: string, event: Event, ready: () => Promise<Drivable>, after?: number): Promise<{ cycle: Cycle; written: boolean; driven?: RunResult }> {
  const now = store.drivable(cycleId);
  const loaded = { after: after ?? now.history.length };
  const w = store.workflow;
  // apply is pure, so this is the cycle the event leads to, before anything is written.
  const next = apply(now, event, w);
  if (!loopRuns(w, next.stage)) return store.write(cycleId, event, loaded);
  const { adapters, job, opts } = await ready();
  const roles = preflight(w, adapters, job, opts);
  // verify's gate, on the cycle as it will be: refused now, the owner may fix and accept again.
  const def = w.stages[next.stage];
  if (def?.kind === 'command' && (def.grants ?? []).length > 0) headGate(next);
  const { cycle, written } = store.write(cycleId, event, loaded);
  // Not written: another delivery of the same command recorded it first and drives the cycle.
  if (!written) return { cycle, written };
  return { cycle, written, driven: await loop(store, cycle, roles, job, opts, ...cloneOf(opts, cycleId)) };
}

/** Where develop put the cycle's clone, and its branch. */
const cloneOf = (opts: RunOptions, cycleId: string) => { const p = cyclePaths(opts.runsDir, cycleId); return [p.clone, p.branch] as const; };

/** The stage kinds loop has a step for. */
const loopRuns = (w: Workflow, stage: Stage) => ['agent', 'command'].includes(w.stages[stage]?.kind ?? '');

/**
 * Throws for what a later step would refuse only after a paid run: a sandbox that cannot start,
 * a file argument with no workflowDir, a grant not given, a check verify would refuse or whose
 * program the sandbox cannot reach, a workflow shape the driver cannot run, a role with no
 * adapter. Returns the adapters by role.
 */
function preflight(w: Workflow, adapters: Adapters, job: Job, opts: RunOptions): Adapters {
  const sandbox = opts.sandbox ?? { backend: 'bwrap' };
  checkSandbox(sandbox);
  const limits = driverLimits(w);
  if (limits.length > 0) throw new Error(`the driver cannot run workflow ${w.name ?? '(unnamed)'}: ${limits.join('; ')}`);
  // Only the paths every stage binds: the stage's own folders do not exist yet.
  const policy = { cwd: '/', write: [], read: [], network: false };
  for (const [name, def] of Object.entries(w.stages)) {
    if (def.kind !== 'command') continue;
    stageFiles(name, def.run ?? [], opts.workflowDir);
    // Read and dropped: an empty file would otherwise be found only when the stage runs.
    grantValues(stageGrants(name, def, opts.grants, opts.sandbox));
    const checks = def.run ?? job.checks ?? [];
    checkCommands(checks, def.run !== undefined);
    for (const { name: check, command: [program] } of checks) {
      // A path names a file in the candidate, which does not exist before the developer run.
      if (typeof program !== 'string' || program.includes('/')) continue;
      const why = missingProgram(program, sandbox, policy);
      if (why) throw new Error(`stage ${name} check ${check}: ${why}`);
    }
  }
  return byRole(w, adapters);
}

/**
 * Shapes checkWorkflow accepts, which apply runs, but which today's steps cannot: each would
 * throw only after a paid developer run. Limits of this driver, not engine rules, so they live
 * here; when a step learns a case, delete its rule.
 */
function driverLimits(w: Workflow): string[] {
  const kind = (s: Stage) => {
    const d = w.stages[s];
    return d?.kind === 'agent' ? d.produces : d?.kind;
  };
  // apply takes only PASS at a commit stage (a dispute or a failed run escalates), so its FAIL
  // edge is never followed; nor is any edge of a stage the start never reaches.
  const edges = (s: Stage): [string, Stage][] => {
    const t = w.stages[s]!.transitions;
    return kind(s) === 'commit' ? [['PASS', t.PASS]] : Object.entries(t);
  };
  const reached = new Set<Stage>();
  const reach = (s: Stage): void => {
    if (reached.has(s) || !w.stages[s]) return;
    reached.add(s);
    for (const [, to] of edges(s)) reach(to);
  };
  reach(w.start);
  const reasons: string[] = [];
  // fix takes its findings from the last verdict, which must be a FAIL for the candidate. A new
  // commit or a review's PASS leaves none; command and human stages pass that on unchanged, so
  // mark every one they reach. A check's FAIL back to the developer needs fix to take the failed
  // checks as findings first.
  const noFail = new Set<Stage>();
  const mark = (s: Stage): void => {
    if (noFail.has(s) || (kind(s) !== 'command' && kind(s) !== 'human')) return;
    noFail.add(s);
    for (const [, to] of edges(s)) mark(to);
  };
  const leavesNoFail = (name: Stage, outcome: string) => kind(name) === 'commit' || (kind(name) === 'verdict' && outcome === 'PASS');
  for (const name of reached) for (const [outcome, to] of edges(name)) if (leavesNoFail(name, outcome)) mark(to);
  for (const name of reached)
    for (const [outcome, to] of edges(name))
      if (kind(to) === 'commit' && (leavesNoFail(name, outcome) || noFail.has(name)))
        reasons.push(`stage ${name} ${outcome} enters commit stage ${to}, but the last verdict there may not be a review's FAIL for the candidate, which a fix run takes as its findings`);
  // review reads the checkout and evidence verify made of the candidate, so after each commit a
  // command stage must come before any review.
  for (const from of [...reached].filter((s) => kind(s) === 'commit')) {
    const seen = new Set<Stage>();
    const walk = (s: Stage) => {
      for (const [, to] of edges(s)) {
        if (seen.has(to) || !w.stages[to] || kind(to) === 'command' || kind(to) === 'commit') continue;
        seen.add(to);
        if (kind(to) === 'verdict') reasons.push(`review stage ${to} follows commit stage ${from} with no command stage between`);
        walk(to);
      }
    };
    walk(from);
  }
  return reasons;
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

async function loop(store: EventStore, opened: Cycle, roles: Adapters, job: Job, opts: RunOptions, worktree: string, branch: string): Promise<RunResult> {
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
