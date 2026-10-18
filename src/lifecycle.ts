// The engine: pure functions that apply events to an immutable Cycle under a Workflow (A-054 to
// A-057). The workflow names the stages, transitions and budgets; the engine keeps the rules no
// workflow can switch off. Every transition returns a new Cycle plus the appended event. Nothing
// here touches a database or a process. The v1 lifecycle (docs/specs/core-lifecycle-v1.md) is
// defaultWorkflow.

export type Stage = string;
export type Role = string;
export type Outcome = 'PASS' | 'FAIL';

/** Stages the engine owns. A workflow may target the last three; it may define none of them. */
export const ENGINE_STAGES = ['QUEUED', 'ESCALATED', 'CANCELLED', 'ACCEPTED'];
const SETTLED_TARGETS = ENGINE_STAGES.slice(1);

export interface Transitions {
  PASS: Stage;
  FAIL?: Stage;
}

export type StageDef =
  | { kind: 'agent'; role: Role; produces: 'commit' | 'verdict'; transitions: Transitions; budget?: number }
  | { kind: 'command'; transitions: Transitions; budget?: number }
  | { kind: 'human'; transitions: Transitions; budget?: number };

/** Plain data, so it can be checked and hashed before anything runs (A-056). */
export interface Workflow {
  start: Stage;
  stages: Record<Stage, StageDef>;
}

/** Core lifecycle v1 as a workflow: docs/specs/core-lifecycle-v1.md, States. */
export const defaultWorkflow: Workflow = {
  start: 'DEVELOPING',
  stages: {
    DEVELOPING: { kind: 'agent', role: 'developer', produces: 'commit', transitions: { PASS: 'VERIFYING' } },
    VERIFYING: { kind: 'command', transitions: { PASS: 'STANDARD_REVIEW' } },
    STANDARD_REVIEW: { kind: 'agent', role: 'standard_reviewer', produces: 'verdict', budget: 2, transitions: { PASS: 'ADVERSARIAL_REVIEW', FAIL: 'DEVELOPING' } },
    ADVERSARIAL_REVIEW: { kind: 'agent', role: 'adversarial_reviewer', produces: 'verdict', budget: 1, transitions: { PASS: 'AWAITING_ACCEPTANCE', FAIL: 'ESCALATED' } },
    AWAITING_ACCEPTANCE: { kind: 'human', transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
  },
};

export interface Candidate {
  head: string;
  base: string;
}

export interface Run {
  runId: string;
  role: Role;
  /** Which runtime ran it (the adapter's name); spec Run record. Set by the claim; reviewers follow in step 6. */
  runtime?: string;
  /** Candidate the run was given as input; undefined for the first developer run. */
  input?: Candidate;
}

/** `step` names the stage an event belongs to; without it the event belongs to the current stage. */
export type Event = (
  | { type: 'claim'; runId: string; base: string; runtime: string }
  | { type: 'developer_result'; runId: string; head?: string; artifacts: string[] }
  | { type: 'verification'; head: string; checks: { name: string; result: 'PASS' | 'FAIL' | 'MISSING' }[] }
  | { type: 'verdict'; runId: string; head: string; verdict: 'PASS' | 'FAIL'; findings?: string[] }
  | { type: 'head_changed'; head: string }
  | { type: 'base_changed'; base: string }
  | { type: 'accept'; head: string }
  | { type: 'request_changes' }
  | { type: 'cancel' }
  | { type: 'reject_dispatch'; reason: string }
  /** The run ended with no usable claim: timeout, crash, malformed output, cancelled by deadline. */
  | { type: 'run_failed'; runId: string; reason: string }
) & { step?: string };

const str = (v: unknown) => typeof v === 'string' && v.length > 0;
const arr = (v: unknown, each: (x: unknown) => boolean) => Array.isArray(v) && v.every(each);
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCheck = (v: unknown) => obj(v) && str(v.name) && ['PASS', 'FAIL', 'MISSING'].includes(v.result as string);

// Shape checks, one per Event type. Everything apply dereferences must be present; anything else
// is the sender's business. Extra fields are tolerated so an older controller can read newer logs.
const SHAPE: Record<Event['type'], (e: Record<string, unknown>) => boolean> = {
  claim: (e) => str(e.runId) && str(e.base) && str(e.runtime),
  developer_result: (e) => str(e.runId) && arr(e.artifacts, str) && (e.head === undefined || typeof e.head === 'string'),
  verification: (e) => str(e.head) && arr(e.checks, isCheck),
  verdict: (e) => str(e.runId) && str(e.head) && (e.verdict === 'PASS' || e.verdict === 'FAIL'),
  head_changed: (e) => str(e.head),
  base_changed: (e) => str(e.base),
  accept: (e) => str(e.head),
  request_changes: () => true,
  cancel: () => true,
  reject_dispatch: (e) => str(e.reason),
  run_failed: (e) => str(e.runId) && str(e.reason),
};

/** True when apply can classify the value. Use at every boundary where events arrive as data. */
export function isEvent(v: unknown): v is Event {
  if (!obj(v)) return false;
  // hasOwn, not a plain lookup: {type:'toString'} would otherwise find Object.prototype.toString.
  if (typeof v.type !== 'string' || !Object.hasOwn(SHAPE, v.type)) return false;
  // apply compares step with the stage name, so anything but a stage-shaped string is unclassifiable.
  if (v.step !== undefined && !str(v.step)) return false;
  return SHAPE[v.type as Event['type']](v);
}

export interface Cycle {
  cycleId: string;
  workId: string;
  parentCycleId?: string;
  stage: Stage;
  /** Outcomes recorded per budgeted stage. Spent budget never resets within a cycle. */
  budgets: Record<Stage, number>;
  candidate?: Candidate;
  runs: Run[];
  /** Run IDs whose result or verdict has been consumed; used for duplicate detection. */
  consumed: string[];
  escalation?: string;
  history: { event: Event; from: Stage; to: Stage; note?: string }[];
}

export function newCycle(cycleId: string, workId: string, parentCycleId?: string): Cycle {
  return { cycleId, workId, parentCycleId, stage: 'QUEUED', budgets: {}, runs: [], consumed: [], history: [] };
}

/**
 * Reasons the workflow is refused; empty when it passes. Run it wherever a workflow arrives as
 * data: apply trusts its workflow and would misbehave on a malformed one rather than refuse it.
 */
export function checkWorkflow(w: Workflow): string[] {
  if (!obj(w) || !obj(w.stages)) return ['workflow must be an object with stages'];
  const reasons: string[] = [];
  const entries = Object.entries(w.stages);
  for (const [name, def] of entries) {
    if (ENGINE_STAGES.includes(name)) reasons.push(`stage ${name} uses an engine stage name`);
    if (!obj(def)) { reasons.push(`stage ${name} must be an object`); continue; }
    if (!['agent', 'command', 'human'].includes(def.kind)) reasons.push(`stage ${name} has unknown kind ${String(def.kind)}`);
    if (def.kind === 'agent' && !str(def.role)) reasons.push(`stage ${name} is an agent stage with no role`);
    if (def.kind === 'agent' && def.produces !== 'commit' && def.produces !== 'verdict') reasons.push(`stage ${name} produces ${String(def.produces)}, not commit or verdict`);
    if (def.budget !== undefined && !(Number.isSafeInteger(def.budget) && def.budget > 0)) reasons.push(`stage ${name} budget must be a positive integer`);
    if (!obj(def.transitions) || !str(def.transitions.PASS)) reasons.push(`stage ${name} has no PASS transition`);
  }
  // The graph checks below dereference every stage's transitions.
  if (reasons.length > 0) return reasons;

  const known = (s: unknown) => typeof s === 'string' && Object.hasOwn(w.stages, s) && !ENGINE_STAGES.includes(s);
  if (!known(w.start)) reasons.push(`start stage ${String(w.start)} is not a workflow stage`);
  const targets = (name: Stage) => Object.values(w.stages[name]!.transitions);
  for (const [name] of entries)
    for (const [outcome, to] of Object.entries(w.stages[name]!.transitions))
      if (!known(to) && !SETTLED_TARGETS.includes(to)) reasons.push(`stage ${name} ${outcome} names unknown stage ${String(to)}`);

  // Every loop must spend a budget (A-054): with budgeted stages removed, the graph must be acyclic.
  const unbudgeted = entries.filter(([, d]) => d.budget === undefined).map(([n]) => n);
  const state = new Map<Stage, 'open' | 'done'>();
  const visit = (name: Stage, path: Stage[]): void => {
    state.set(name, 'open');
    const here = [...path, name];
    for (const to of targets(name)) {
      if (!unbudgeted.includes(to)) continue;
      if (state.get(to) === 'open') reasons.push(`loop ${[...here.slice(here.indexOf(to)), to].join(' -> ')} has no budgeted stage`);
      else if (!state.has(to)) visit(to, here);
    }
    state.set(name, 'done');
  };
  for (const name of unbudgeted) if (!state.has(name)) visit(name, []);

  const settles = new Set<Stage>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name] of entries)
      if (!settles.has(name) && targets(name).some((to) => SETTLED_TARGETS.includes(to) || settles.has(to))) {
        settles.add(name);
        grew = true;
      }
  }
  for (const [name] of entries) if (!settles.has(name)) reasons.push(`stage ${name} has no path to ${SETTLED_TARGETS.join(', ')}`);
  return reasons;
}

const TERMINAL: Stage[] = ['ACCEPTED', 'CANCELLED'];

function record(c: Cycle, event: Event, to: Stage, patch: Partial<Cycle> = {}, note?: string): Cycle {
  return { ...c, ...patch, stage: to, history: [...c.history, { event, from: c.stage, to, note }] };
}

function escalate(c: Cycle, event: Event, reason: string, patch: Partial<Cycle> = {}): Cycle {
  return record(c, event, 'ESCALATED', { ...patch, escalation: reason }, reason);
}

function sameCandidate(a: Candidate | undefined, head: string, base?: string): boolean {
  return !!a && a.head === head && (base === undefined || a.base === base);
}

/** The cycle's budgets with one more outcome recorded at its stage, if that stage is budgeted. */
function counted(c: Cycle, def: StageDef): Record<Stage, number> {
  return def.budget === undefined ? c.budgets : { ...c.budgets, [c.stage]: (c.budgets[c.stage] ?? 0) + 1 };
}

/** Move to `to`, unless `to` is a budgeted stage whose budget is already spent. */
function enter(w: Workflow, c: Cycle, e: Event, to: Stage, patch: Partial<Cycle>, note?: string): Cycle {
  const budgets = patch.budgets ?? c.budgets;
  const limit = w.stages[to]?.budget;
  if (limit !== undefined && (budgets[to] ?? 0) >= limit) return escalate(c, e, `${to} budget exhausted`, patch);
  return record(c, e, to, patch, note);
}

/** Record one outcome at the current stage and follow the workflow's transition for it. */
function advance(w: Workflow, c: Cycle, e: Event, def: StageDef, outcome: Outcome, patch: Partial<Cycle> = {}, detail?: string): Cycle {
  const budgets = counted(c, def);
  const next = { ...patch, budgets };
  if (outcome === 'PASS') return enter(w, c, e, def.transitions.PASS, next);
  const to = def.transitions.FAIL;
  if (to === undefined || to === 'ESCALATED') return escalate(c, e, `${c.stage} FAIL${detail ? `: ${detail}` : ''}`, next);
  if (def.budget !== undefined && budgets[c.stage]! >= def.budget) return escalate(c, e, `${c.stage} FAIL at budget limit ${def.budget}`, next);
  return enter(w, c, e, to, next, 'FAIL transition');
}

const takes = (def: StageDef | undefined, produces: 'commit' | 'verdict'): def is Extract<StageDef, { kind: 'agent' }> =>
  def?.kind === 'agent' && def.produces === produces;

/** Apply one event. Unknown or out-of-place input never advances the cycle. Trusts that `w` passed checkWorkflow. */
export function apply(c: Cycle, e: Event, w: Workflow = defaultWorkflow): Cycle {
  if (TERMINAL.includes(c.stage)) {
    return record(c, e, c.stage, {}, 'ignored: terminal cycle');
  }
  if (e.type === 'cancel') return record(c, e, 'CANCELLED');
  if (c.stage === 'ESCALATED') return record(c, e, 'ESCALATED', {}, 'ignored: escalated; owner must open a child cycle or cancel');
  if (e.step !== undefined && e.step !== c.stage) return escalate(c, e, `event for step ${e.step} while in ${c.stage}`);
  const def = w.stages[c.stage];

  switch (e.type) {
    case 'claim': {
      const to = c.stage === 'QUEUED' ? w.start : c.stage;
      if (c.stage !== 'QUEUED' && !takes(def, 'commit')) return escalate(c, e, 'claim outside QUEUED or a commit stage');
      const target = w.stages[to];
      if (!takes(target, 'commit')) return escalate(c, e, `claim: start stage ${to} does not take a developer run`);
      // Only claims create runs, so every run here is a commit stage's.
      if (c.runs.some((r) => !c.consumed.includes(r.runId)))
        return record(c, e, c.stage, {}, 'ignored: developer run already active');
      const run: Run = { runId: e.runId, role: target.role, runtime: e.runtime, input: c.candidate };
      const patch = { runs: [...c.runs, run], candidate: c.candidate ?? { head: '', base: e.base } };
      return to === c.stage ? record(c, e, to, patch) : enter(w, c, e, to, patch);
    }

    case 'developer_result': {
      if (c.consumed.includes(e.runId)) return record(c, e, c.stage, {}, 'ignored: duplicate result');
      if (!c.runs.some((r) => r.runId === e.runId)) return escalate(c, e, 'result from unknown run');
      if (!takes(def, 'commit')) return escalate(c, e, `developer result outside a commit stage (in ${c.stage})`);
      const consumed = [...c.consumed, e.runId];
      // A malformed claim, not a FAIL: there is no commit to send anywhere.
      if (!e.head || e.artifacts.length === 0) return escalate(c, e, 'invalid developer result: missing commit or artifact', { consumed });
      return advance(w, c, e, def, 'PASS', { consumed, candidate: { head: e.head, base: c.candidate!.base } });
    }

    case 'verification': {
      if (def?.kind !== 'command') return escalate(c, e, `verification outside a command stage (in ${c.stage})`);
      if (!sameCandidate(c.candidate, e.head)) return escalate(c, e, 'verification for a non-candidate SHA');
      if (e.checks.length === 0 || e.checks.some((k) => k.result !== 'PASS')) return advance(w, c, e, def, 'FAIL', {}, 'required check failed or missing');
      return advance(w, c, e, def, 'PASS');
    }

    case 'verdict': {
      if (c.consumed.includes(e.runId)) return record(c, e, c.stage, {}, 'ignored: duplicate verdict');
      if (!takes(def, 'verdict')) return escalate(c, e, 'verdict outside a review stage');
      const consumed = [...c.consumed, e.runId];
      // Spec: a verdict for a SHA that is not the candidate is recorded and counted, never applied.
      if (!sameCandidate(c.candidate, e.head)) return escalate(c, e, 'verdict for a stale SHA; counted, not applied', { consumed, budgets: counted(c, def) });
      return advance(w, c, e, def, e.verdict, { consumed });
    }

    case 'head_changed': {
      if (takes(def, 'commit')) return record(c, e, c.stage, {}, 'developer still writing');
      if (sameCandidate(c.candidate, e.head)) return record(c, e, c.stage, {}, 'ignored: same head');
      return escalate(c, e, 'candidate head changed outside a fix run');
    }

    case 'base_changed': {
      if (c.candidate?.base === e.base) return record(c, e, c.stage, {}, 'ignored: same base');
      return escalate(c, e, 'target base changed');
    }

    case 'accept': {
      if (def?.kind !== 'human') return escalate(c, e, `accept outside a human stage (in ${c.stage})`);
      if (!sameCandidate(c.candidate, e.head)) return escalate(c, e, 'accept names a non-candidate SHA');
      return advance(w, c, e, def, 'PASS');
    }

    case 'request_changes':
      if (def?.kind !== 'human') return escalate(c, e, `request_changes outside a human stage (in ${c.stage})`);
      return advance(w, c, e, def, 'FAIL', {}, 'owner requested changes');

    case 'reject_dispatch':
      return escalate(c, e, `dispatch rejected: ${e.reason}`);

    // Counters do not move: an infrastructure failure is not a review attempt (spec, Recovery).
    // A run that already delivered its result or verdict cannot fail afterwards; a late
    // run_failed for it is a redelivery and must not overturn the recorded transition.
    case 'run_failed':
      if (c.consumed.includes(e.runId)) return record(c, e, c.stage, {}, 'ignored: run already has an outcome');
      // Consumed so the controller can tell a redelivered run_failed from a run in the wrong stage.
      return escalate(c, e, `run failed: ${e.reason}`, { consumed: [...c.consumed, e.runId] });

    // Reachable at runtime: types are stripped, not checked, and events arrive as JSON.
    default:
      return escalate(c, e, `unclassifiable event: ${String((e as { type?: unknown }).type)}`);
  }
}

/** Owner opens a child cycle from an ESCALATED parent. The parent is unchanged. */
export function openChild(parent: Cycle, childId: string): Cycle {
  if (parent.stage !== 'ESCALATED') throw new Error('child cycle requires an ESCALATED parent');
  return newCycle(childId, parent.workId, parent.cycleId);
}
