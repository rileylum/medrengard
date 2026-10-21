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
/** Stages no run acts on: a run in flight stops, and the driver returns to the owner. */
export const STOPPED: readonly Stage[] = Object.freeze(ENGINE_STAGES.slice(1));
/** Stages nothing moves again. An ESCALATED cycle is stopped but not settled: it waits for the owner's move (A-114). */
export const SETTLED: readonly Stage[] = Object.freeze(['CANCELLED', 'ACCEPTED']);

/**
 * Recorded on each open row (A-123). Bump it when apply would move any existing log to another
 * stage; the stage stored on each row then refuses the cycles it changes, naming both versions.
 */
export const ENGINE_VERSION = 1;

export interface Transitions {
  PASS: Stage;
  FAIL?: Stage;
}

export type StageDef =
  | {
      kind: 'agent';
      role: Role;
      produces: 'commit' | 'verdict';
      /** What the run is asked to do; the first line of its prompt, before the core's contract (A-056). One line. */
      roleText: string;
      /** A commit stage's role text when it is re-entered after a FAIL. Default roleText. */
      fixRoleText?: string;
      transitions: Transitions;
      budget?: number;
    }
  | {
      kind: 'command';
      transitions: Transitions;
      budget?: number;
      /** The stage's own commands, run in order like job.checks. Absent: job.checks (10-c). */
      run?: Command[];
      /** Default false. */
      network?: boolean;
      /** Names the personal or job layer gives; each value reaches this stage's commands alone (10-e). */
      grants?: string[];
    }
  | { kind: 'human'; transitions: Transitions; budget?: number };

/** As verify's Check, but an argument may name a file next to the workflow (10-c). */
export interface Command {
  name: string;
  command: (string | { file: string })[];
}

/** The `{ file }` arguments of one command, in order. */
export const fileArgs = (c: Command): string[] => c.command.flatMap((a) => (typeof a === 'string' ? [] : [a.file]));

/** Plain data, so it can be checked and hashed before anything runs (A-056). */
export interface Workflow {
  /** Recorded with each cycle it opens, for the owner to read; the hash is what binds. */
  name?: string;
  start: Stage;
  stages: Record<Stage, StageDef>;
}

/** Core lifecycle v1 as a workflow: docs/specs/core-lifecycle-v1.md, States. */
export const defaultWorkflow: Workflow = {
  name: 'default',
  start: 'DEVELOPING',
  stages: {
    DEVELOPING: {
      kind: 'agent', role: 'developer', produces: 'commit',
      roleText: 'You are the developer for the ticket below. The current directory is a Git clone on the branch for this work.',
      // Its first line must differ from roleText's: tests/fixtures/fake-cli.ts commits that line, and a fix that commits the same tree is refused.
      fixRoleText: 'You are the developer fixing review findings on the ticket below. The current directory is a Git clone on the branch for this work, at your earlier commit.',
      transitions: { PASS: 'VERIFYING' },
    },
    VERIFYING: { kind: 'command', transitions: { PASS: 'STANDARD_REVIEW' } },
    STANDARD_REVIEW: {
      kind: 'agent', role: 'standard_reviewer', produces: 'verdict', budget: 2,
      roleText: 'You are the standard reviewer for the change below. Judge the diff against the ticket, the repository instructions and the verification evidence. The current directory is a read-only checkout of the candidate commit.',
      transitions: { PASS: 'ADVERSARIAL_REVIEW', FAIL: 'DEVELOPING' },
    },
    ADVERSARIAL_REVIEW: {
      kind: 'agent', role: 'adversarial_reviewer', produces: 'verdict', budget: 1,
      roleText: 'You are the adversarial reviewer for the change below. Your job is to break it: find inputs, sequences or states under which it does not do what the ticket says, and report what you can show. The current directory is a read-only checkout of the candidate commit.',
      transitions: { PASS: 'AWAITING_ACCEPTANCE', FAIL: 'ESCALATED' },
    },
    AWAITING_ACCEPTANCE: { kind: 'human', transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
  },
};

/** Which prompt wording a run was given (09-c); see src/prompt.ts. */
export interface PromptVersions {
  /** SHA-256 of the contract's wording, built from fixed placeholders. The same for every run of one kind. */
  contractHash: string;
  /** SHA-256 of the role text the run was given. */
  roleTextHash: string;
}

/** What a run's outcome event records of what ran it (10-a): the prompt wording and the runtime. */
export interface RunVersions extends PromptVersions {
  /** The adapter's name. */
  runtime: string;
  /** SHA-256 of an extension runtime's module file; absent for a built-in runtime. */
  moduleHash?: string;
}

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
  | ({ type: 'developer_result'; runId: string; head?: string; artifacts: string[] } & Partial<RunVersions>)
  /** `files`: each file argument a command ran, by its path beside the workflow, to the SHA-256 of what ran (10-c). */
  /** `grants`: the names the stage held, never the values (10-e). */
  | { type: 'verification'; head: string; checks: { name: string; result: 'PASS' | 'FAIL' | 'MISSING'; files?: Record<string, string> }[]; grants?: string[] }
  | ({ type: 'verdict'; runId: string; head: string; verdict: 'PASS' | 'FAIL'; findings?: string[] } & Partial<RunVersions>)
  /**
   * Events from outside a run may carry `commandId` (11-d): the store records one event per ID per
   * cycle, so an observer or a tracker that redelivers sends the same ID and nothing lands twice.
   */
  | { type: 'head_changed'; head: string; commandId?: string }
  | { type: 'base_changed'; base: string; commandId?: string }
  /** `source`: who ran the command, `owner` unless an observer named itself (10-d). A label, not an identity. */
  | { type: 'accept'; head: string; source?: string; commandId?: string }
  /** The owner's FAIL is a verdict, so it names the SHA it rejects (11-d, A-123 item 1). */
  | { type: 'request_changes'; head: string; source?: string; commandId?: string }
  | { type: 'cancel'; source?: string; commandId?: string }
  /**
   * The owner's move on an ESCALATED cycle (11-d2, A-114), bound to the candidate head, with the
   * owner's reason. `stage` names route's target and is absent for the other actions.
   */
  | { type: 'owner_decision'; action: MoveAction; head: string; reason: string; stage?: Stage; source?: string; commandId?: string }
  | { type: 'reject_dispatch'; reason: string }
  /** A fix run's claim that it will not change the candidate, with the developer's reason (07-e). */
  | ({ type: 'dispute'; runId: string; head: string; reason: string } & Partial<RunVersions>)
  /** The run ended with no usable claim: timeout, crash, malformed output, cancelled by deadline. */
  | ({ type: 'run_failed'; runId: string; reason: string } & Partial<RunVersions>)
) & { step?: string };

export const MOVE_ACTIONS = ['retry', 'overrule', 'route'] as const;
export type MoveAction = (typeof MOVE_ACTIONS)[number];

const str = (v: unknown) => typeof v === 'string' && v.length > 0;
const arr = (v: unknown, each: (x: unknown) => boolean) => Array.isArray(v) && v.every(each);
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// Not read by apply, but a value of the wrong type would be a false record of what ran.
const versions = (e: Record<string, unknown>) => (e.runtime === undefined || str(e.runtime)) && (e.moduleHash === undefined || str(e.moduleHash));
/** One line of printable text: a source is printed by the CLI and the stream, so it must not forge a line or a terminal sequence. */
export const isSource = (v: unknown) => typeof v === 'string' && /^[^\p{Cc}\u2028\u2029]+$/u.test(v);
const source = (e: Record<string, unknown>) => e.source === undefined || isSource(e.source);
// Well-formed for the same reason as a run ID (store.ts, requireId): SQLite would fold a lone surrogate.
const command = (e: Record<string, unknown>) => e.commandId === undefined || (str(e.commandId) && (e.commandId as string).isWellFormed());
const isCheck = (v: unknown) => obj(v) && str(v.name) && ['PASS', 'FAIL', 'MISSING'].includes(v.result as string) && (v.files === undefined || (obj(v.files) && Object.values(v.files).every(str)));

// Shape checks, one per Event type. Everything apply dereferences must be present; anything else
// is the sender's business. Extra fields are tolerated so an older controller can read newer logs.
const SHAPE: Record<Event['type'], (e: Record<string, unknown>) => boolean> = {
  claim: (e) => str(e.runId) && str(e.base) && str(e.runtime),
  developer_result: (e) => str(e.runId) && arr(e.artifacts, str) && (e.head === undefined || typeof e.head === 'string') && versions(e),
  verification: (e) => str(e.head) && arr(e.checks, isCheck) && (e.grants === undefined || arr(e.grants, str)),
  verdict: (e) => str(e.runId) && str(e.head) && (e.verdict === 'PASS' || e.verdict === 'FAIL') && versions(e),
  head_changed: (e) => str(e.head) && command(e),
  base_changed: (e) => str(e.base) && command(e),
  accept: (e) => str(e.head) && source(e) && command(e),
  request_changes: (e) => str(e.head) && source(e) && command(e),
  cancel: (e) => source(e) && command(e),
  reject_dispatch: (e) => str(e.reason),
  run_failed: (e) => str(e.runId) && str(e.reason) && versions(e),
  dispute: (e) => str(e.runId) && str(e.head) && str(e.reason) && versions(e),
  owner_decision: (e) => MOVE_ACTIONS.includes(e.action as MoveAction) && str(e.head) && str(e.reason) && (e.action === 'route' ? str(e.stage) : e.stage === undefined) && source(e) && command(e),
};

export const EVENT_TYPES = Object.keys(SHAPE) as Event['type'][];

/**
 * The run ID when `e` is a run's outcome, else undefined. A run has one outcome: the store keeps
 * the first and writes nothing for a second, and apply ignores a second. A claim is not an
 * outcome: apply decides a redelivered claim. A new event that ends a run belongs here.
 */
export function outcomeRunId(e: Event): string | undefined {
  switch (e.type) {
    case 'developer_result':
    case 'verdict':
    case 'run_failed':
    case 'dispute':
      return e.runId;
  }
}

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
  if (w.name !== undefined && !str(w.name)) reasons.push('workflow name must be a non-empty string');
  const entries = Object.entries(w.stages);
  for (const [name, def] of entries) {
    if (ENGINE_STAGES.includes(name)) reasons.push(`stage ${name} uses an engine stage name`);
    if (!obj(def)) { reasons.push(`stage ${name} must be an object`); continue; }
    if (!['agent', 'command', 'human'].includes(def.kind)) reasons.push(`stage ${name} has unknown kind ${String(def.kind)}`);
    if (def.kind === 'agent' && !str(def.role)) reasons.push(`stage ${name} is an agent stage with no role`);
    if (def.kind === 'agent' && def.produces !== 'commit' && def.produces !== 'verdict') reasons.push(`stage ${name} produces ${String(def.produces)}, not commit or verdict`);
    if (def.kind === 'agent') reasons.push(...roleTextReasons(name, def));
    if (def.kind === 'command') reasons.push(...commandReasons(name, def));
    else if ((def as { grants?: unknown }).grants !== undefined) reasons.push(`stage ${name} asks for grants, which only a command stage can hold`);
    if (def.budget !== undefined && !(Number.isSafeInteger(def.budget) && def.budget > 0)) reasons.push(`stage ${name} budget must be a positive integer`);
    if (!obj(def.transitions) || !str(def.transitions.PASS)) reasons.push(`stage ${name} has no PASS transition`);
  }
  // The graph checks below dereference every stage's transitions.
  if (reasons.length > 0) return reasons;

  // The controller tells a claim from a verdict by the run's role alone.
  const produces = new Map<Role, string>();
  for (const [name, def] of entries) {
    if (def.kind !== 'agent') continue;
    const other = produces.get(def.role);
    if (other !== undefined && other !== def.produces) reasons.push(`role ${def.role} produces both commit and verdict (stage ${name})`);
    produces.set(def.role, def.produces);
  }

  const known = (s: unknown) => typeof s === 'string' && Object.hasOwn(w.stages, s) && !ENGINE_STAGES.includes(s);
  if (!known(w.start)) reasons.push(`start stage ${String(w.start)} is not a workflow stage`);
  const targets = (name: Stage) => Object.values(w.stages[name]!.transitions);
  for (const [name] of entries)
    for (const [outcome, to] of Object.entries(w.stages[name]!.transitions))
      if (!known(to) && !STOPPED.includes(to)) reasons.push(`stage ${name} ${outcome} names unknown stage ${String(to)}`);

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
      if (!settles.has(name) && targets(name).some((to) => STOPPED.includes(to) || settles.has(to))) {
        settles.add(name);
        grew = true;
      }
  }
  for (const [name] of entries) if (!settles.has(name)) reasons.push(`stage ${name} has no path to ${STOPPED.join(', ')}`);
  return reasons;
}

/**
 * What apply reads, for a workflow read back from the store (A-123, engine.md P6): a stage table
 * apply can walk without crashing or routing to a stage that is not there. checkWorkflow's other
 * rules guard new cycles; adding one here makes every cycle opened before it unloadable.
 */
export function replayCheck(w: Workflow): string[] {
  if (!obj(w) || !obj(w.stages)) return ['workflow must be an object with stages'];
  const reasons: string[] = [];
  const known = (s: unknown) => typeof s === 'string' && Object.hasOwn(w.stages, s) && !ENGINE_STAGES.includes(s);
  if (!known(w.start)) reasons.push(`start stage ${String(w.start)} is not a workflow stage`);
  for (const [name, def] of Object.entries(w.stages)) {
    if (ENGINE_STAGES.includes(name)) reasons.push(`stage ${name} uses an engine stage name`);
    if (!obj(def)) { reasons.push(`stage ${name} must be an object`); continue; }
    if (!['agent', 'command', 'human'].includes(def.kind)) reasons.push(`stage ${name} has unknown kind ${String(def.kind)}`);
    if (def.kind === 'agent' && !str(def.role)) reasons.push(`stage ${name} is an agent stage with no role`);
    if (def.kind === 'agent' && def.produces !== 'commit' && def.produces !== 'verdict') reasons.push(`stage ${name} produces ${String(def.produces)}, not commit or verdict`);
    if (def.budget !== undefined && !(Number.isSafeInteger(def.budget) && def.budget > 0)) reasons.push(`stage ${name} budget must be a positive integer`);
    if (!obj(def.transitions)) { reasons.push(`stage ${name} has no transitions`); continue; }
    if (!str(def.transitions.PASS)) reasons.push(`stage ${name} has no PASS transition`);
    if (def.transitions.FAIL !== undefined && !str(def.transitions.FAIL)) reasons.push(`stage ${name} FAIL transition must be a stage name`);
    for (const [outcome, to] of Object.entries(def.transitions))
      if (!known(to) && !STOPPED.includes(to)) reasons.push(`stage ${name} ${outcome} names unknown stage ${String(to)}`);
  }
  return reasons;
}

// The terminators oneLine (src/prompt.ts) folds. The contract's Rules: line and delimiters are
// structure only at the start of a line, so role text that cannot break a line cannot forge them.
const LINE_BREAK = /[\r\n\u2028\u2029\u0085]/;

function roleTextReasons(name: Stage, def: Extract<StageDef, { kind: 'agent' }>): string[] {
  const reasons: string[] = [];
  if (!str(def.roleText)) reasons.push(`stage ${name} is an agent stage with no role text`);
  else if (LINE_BREAK.test(def.roleText)) reasons.push(`stage ${name} role text must be one line`);
  if (def.fixRoleText === undefined) return reasons;
  if (def.produces !== 'commit') reasons.push(`stage ${name} has fix role text but produces ${String(def.produces)}, not commit`);
  else if (!str(def.fixRoleText)) reasons.push(`stage ${name} fix role text must be a non-empty string`);
  else if (LINE_BREAK.test(def.fixRoleText)) reasons.push(`stage ${name} fix role text must be one line`);
  return reasons;
}

/** A file stem, nothing that could leave the evidence directory or hide a sibling's file. Check and command names, and command stage names. */
export const FILE_STEM = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
// verify's own check, recorded only when it fails: a check that rewrote a tracked file
// (formatter, codegen) left a checkout that is not the commit, so what the reviewers would read
// is not what was verified. Recording it escalates the cycle with evidence instead of leaving it
// in the review stage with review refusing the dirty checkout on every call (06-c adversarial).
export const TREE_CHECK = 'tree';
// verify's check that a grant stage wrote the candidate head to output/head (10-e, A-083 Q4).
export const HEAD_CHECK = 'head';
const GRANT_NAME = /^[a-z0-9_-]+$/;

// verify's rules for job.checks names, at load time for `run` (10-c), plus what a file argument may name.
function commandReasons(name: Stage, def: Extract<StageDef, { kind: 'command' }>): string[] {
  const reasons: string[] = [];
  // The stage's evidence directory is evidence/<head>/<stage>/.
  if (!FILE_STEM.test(name)) reasons.push(`stage ${name}: a command stage name must be a file stem`);
  if (def.network !== undefined && typeof def.network !== 'boolean') reasons.push(`stage ${name} network must be true or false`);
  if (def.grants !== undefined) reasons.push(...grantReasons(name, def));
  if (def.run === undefined) return reasons;
  if (!Array.isArray(def.run) || def.run.length === 0) return [...reasons, `stage ${name} run must be a non-empty array of { name, command }`];
  const seen = new Set<unknown>();
  for (const c of def.run as unknown[]) {
    if (!obj(c)) { reasons.push(`stage ${name} run entry ${JSON.stringify(c)} must be { name, command }`); continue; }
    const label = `stage ${name} command ${JSON.stringify(c.name)}`;
    if (typeof c.name !== 'string' || !FILE_STEM.test(c.name)) reasons.push(`${label}: name is not a file stem`);
    else if (c.name === TREE_CHECK) reasons.push(`${label}: name ${TREE_CHECK} is reserved for the controller's tracked-tree check`);
    else if (seen.has(c.name)) reasons.push(`${label}: declared twice`);
    else if (c.name === HEAD_CHECK && def.grants !== undefined) reasons.push(`${label}: name ${HEAD_CHECK} is reserved in a grant stage for the controller's head check`);
    seen.add(c.name);
    if (!Array.isArray(c.command) || c.command.length === 0) { reasons.push(`${label}: command must be a non-empty array`); continue; }
    for (const arg of c.command as unknown[]) {
      if (typeof arg === 'string') continue;
      if (!obj(arg) || Object.keys(arg).join() !== 'file') reasons.push(`${label}: argument ${JSON.stringify(arg)} is neither a string nor { file }`);
      // Copied to files/<file> in the stage directory, so it must stay inside both.
      else if (typeof arg.file !== 'string' || arg.file === '' || arg.file.startsWith('/') || arg.file.split(/[\\/]/).includes('..'))
        reasons.push(`${label}: file ${JSON.stringify(arg.file)} must be a relative path beside the workflow, without ..`);
    }
  }
  return reasons;
}

// A grant stage acted outward with the owner's credential: it runs only its own commands (job.checks
// may come from the repository), with network, and a FAIL goes to the owner, never round again.
function grantReasons(name: Stage, def: Extract<StageDef, { kind: 'command' }>): string[] {
  const g: unknown = def.grants;
  if (!Array.isArray(g) || g.length === 0 || !g.every((x) => typeof x === 'string' && GRANT_NAME.test(x)))
    return [`stage ${name} grants must be a non-empty array of names matching ${GRANT_NAME.source}`];
  const reasons = g.filter((x, i) => g.indexOf(x) !== i).map((x) => `stage ${name} grant ${x} is asked for twice`);
  if (def.run === undefined) reasons.push(`stage ${name} holds a grant, so it needs its own run`);
  if (def.network !== true) reasons.push(`stage ${name} holds a grant, so it must set network: true`);
  if (obj(def.transitions) && def.transitions.FAIL !== undefined && def.transitions.FAIL !== 'ESCALATED') reasons.push(`stage ${name} holds a grant, so its FAIL must be ESCALATED or absent`);
  return reasons;
}

/** What `role`'s runs produce under `w`; undefined when no agent stage names it. Unique once checkWorkflow passes. */
export function producedBy(w: Workflow, role: Role): 'commit' | 'verdict' | undefined {
  for (const def of Object.values(w.stages)) if (def.kind === 'agent' && def.role === role) return def.produces;
  return undefined;
}

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
  if (SETTLED.includes(c.stage)) {
    return record(c, e, c.stage, {}, 'ignored: terminal cycle');
  }
  if (e.type === 'cancel') return record(c, e, 'CANCELLED');
  if (c.stage === 'ESCALATED') return e.type === 'owner_decision' ? move(w, c, e) : record(c, e, 'ESCALATED', {}, 'ignored: escalated; the owner moves it, opens a child cycle or cancels');
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

    // 07-e: the developer answers a FAIL by keeping the candidate and saying why. Only the owner
    // can weigh that against the verdict, so it escalates; no budget moves, as for run_failed.
    case 'dispute': {
      if (c.consumed.includes(e.runId)) return record(c, e, c.stage, {}, 'ignored: duplicate dispute');
      const disputing = c.runs.find((r) => r.runId === e.runId);
      if (!disputing) return escalate(c, e, 'dispute from unknown run');
      if (!takes(def, 'commit')) return escalate(c, e, `dispute outside a commit stage (in ${c.stage})`);
      const consumed = [...c.consumed, e.runId];
      // A first run has no findings to dispute; its input is the candidate it was asked to fix.
      if (!disputing.input) return escalate(c, e, 'dispute outside a fix run', { consumed });
      if (e.head !== disputing.input.head) return escalate(c, e, `dispute names ${e.head}, not the previous candidate ${disputing.input.head}`, { consumed });
      return escalate(c, e, `developer disputes the findings on ${e.head}: ${e.reason}`, { consumed });
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
      if (!sameCandidate(c.candidate, e.head)) return escalate(c, e, 'request_changes names a non-candidate SHA');
      return advance(w, c, e, def, 'FAIL', {}, 'owner requested changes');

    case 'reject_dispatch':
      return escalate(c, e, `dispatch rejected: ${e.reason}`);

    case 'owner_decision':
      return escalate(c, e, `owner_decision outside ESCALATED (in ${c.stage})`);

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

type Move = Extract<Event, { type: 'owner_decision' }>;

/**
 * Whether the stage in `from` took the entry's outcome as its own. An outcome recorded but ignored
 * (while escalated, settled, or a duplicate), escalated for another step before the stage looked
 * at it, or out of place at a stage of another kind was never that stage's word. Every read of the
 * history for evidence goes through this: since a move lets an ESCALATED cycle run again, an
 * ignored PASS or verification would otherwise stand in for one the engine never took.
 */
export function took(w: Workflow, h: Cycle['history'][number]): boolean {
  const { event: e, from, note } = h;
  if (note?.startsWith('ignored:') || (e.step !== undefined && e.step !== from)) return false;
  const def = w.stages[from];
  if (e.type === 'verdict') return takes(def, 'verdict');
  if (e.type === 'verification') return def?.kind === 'command';
  if (e.type === 'accept') return def?.kind === 'human';
  return def !== undefined;
}

/** Where the last verdict a review stage took sits in the history, or -1. */
export function lastVerdictAt(w: Workflow, c: Cycle): number {
  return c.history.findLastIndex((h) => h.event.type === 'verdict' && took(w, h));
}

/**
 * The owner's move on an ESCALATED cycle (A-114). A move whose condition does not hold is recorded
 * with a note and changes nothing else; decide.ts refuses it before it is written, so only a raw
 * write lands here. A move that holds enters its stage directly, not through `enter`: a spent
 * budget is a refusal here, where `enter` would escalate again with a new reason.
 */
function move(w: Workflow, c: Cycle, e: Move): Cycle {
  const refuse = (why: string) => record(c, e, 'ESCALATED', {}, `move refused: ${why}`);
  if (!sameCandidate(c.candidate, e.head)) return refuse(`${e.head} is not the candidate head ${c.candidate?.head || '(none)'}`);
  const spent = (stage: Stage, budgets: Record<Stage, number>) => {
    const limit = w.stages[stage]!.budget;
    return limit !== undefined && (budgets[stage] ?? 0) >= limit ? `${stage} budget is spent (${budgets[stage]} of ${limit})` : undefined;
  };
  let to: Stage;
  let budgets = c.budgets;
  if (e.action === 'retry') {
    // Entries recorded while escalated run from ESCALATED to ESCALATED; the one before them entered it.
    to = c.history.findLast((h) => h.to === 'ESCALATED' && h.from !== 'ESCALATED')?.from ?? 'QUEUED';
    if (!Object.hasOwn(w.stages, to)) return refuse(`the cycle escalated from ${to}, not a workflow stage`);
  } else if (e.action === 'overrule') {
    const at = lastVerdictAt(w, c);
    if (at < 0) return refuse('the cycle has no verdict to overrule');
    const { event: last, from } = c.history[at]! as { event: Extract<Event, { type: 'verdict' }>; from: Stage };
    if (last.verdict !== 'FAIL') return refuse(`the last verdict is a ${last.verdict}, not a FAIL`);
    if (last.head !== c.candidate!.head) return refuse(`the last FAIL is for ${last.head}, not the candidate ${c.candidate!.head}`);
    // One refund per FAIL: an overrule loops paid reviews only after a fresh FAIL (engine.md P5 holds any cap).
    if (c.history.slice(at + 1).some((h) => h.event.type === 'owner_decision' && h.event.action === 'overrule' && h.to !== 'ESCALATED'))
      return refuse('the last FAIL was overruled already');
    to = from;
    if (w.stages[to]!.budget !== undefined) budgets = { ...budgets, [to]: (budgets[to] ?? 0) - 1 };
  } else {
    to = e.stage!;
    if (!Object.hasOwn(w.stages, to)) return refuse(`${to} is not a workflow stage`);
  }
  const why = spent(to, budgets);
  if (why) return refuse(why);
  // A run cut off by the escalation will never get an outcome the cycle takes; consumed, its late
  // outcome is a duplicate, and fix is not blocked by a run that will never answer.
  const consumed = [...c.consumed, ...c.runs.filter((r) => !c.consumed.includes(r.runId)).map((r) => r.runId)];
  return record(c, e, to, { budgets, consumed, escalation: undefined });
}

/** Owner opens a child cycle from an ESCALATED parent. The parent is unchanged. */
export function openChild(parent: Cycle, childId: string): Cycle {
  if (parent.stage !== 'ESCALATED') throw new Error('child cycle requires an ESCALATED parent');
  return newCycle(childId, parent.workId, parent.cycleId);
}
