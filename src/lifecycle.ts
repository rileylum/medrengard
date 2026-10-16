// Core delivery lifecycle v1. Pure functions over an immutable Cycle value.
// The controller applies events; every transition returns a new Cycle plus the
// appended event. Nothing here touches a database or a process; see docs/specs/core-lifecycle-v1.md.

export const STANDARD_LIMIT = 2;
export const ADVERSARIAL_LIMIT = 1;

export type Stage =
  | 'QUEUED'
  | 'DEVELOPING'
  | 'VERIFYING'
  | 'STANDARD_REVIEW'
  | 'ADVERSARIAL_REVIEW'
  | 'AWAITING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'ESCALATED'
  | 'CANCELLED';

export type Role = 'developer' | 'standard_reviewer' | 'adversarial_reviewer';

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

export type Event =
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
  | { type: 'run_failed'; runId: string; reason: string };

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
  return SHAPE[v.type as Event['type']](v);
}

export interface Cycle {
  cycleId: string;
  workId: string;
  parentCycleId?: string;
  stage: Stage;
  standard: number;
  adversarial: number;
  candidate?: Candidate;
  runs: Run[];
  /** Run IDs whose result or verdict has been consumed; used for duplicate detection. */
  consumed: string[];
  escalation?: string;
  history: { event: Event; from: Stage; to: Stage; note?: string }[];
}

export function newCycle(cycleId: string, workId: string, parentCycleId?: string): Cycle {
  return { cycleId, workId, parentCycleId, stage: 'QUEUED', standard: 0, adversarial: 0, runs: [], consumed: [], history: [] };
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

/** Apply one event. Unknown or out-of-place input never advances the cycle. */
export function apply(c: Cycle, e: Event): Cycle {
  if (TERMINAL.includes(c.stage)) {
    return record(c, e, c.stage, {}, 'ignored: terminal cycle');
  }
  if (e.type === 'cancel') return record(c, e, 'CANCELLED');
  if (c.stage === 'ESCALATED') return record(c, e, 'ESCALATED', {}, 'ignored: escalated; owner must open a child cycle or cancel');

  switch (e.type) {
    case 'claim': {
      if (c.stage !== 'QUEUED' && c.stage !== 'DEVELOPING') return escalate(c, e, 'claim outside QUEUED');
      if (c.runs.some((r) => r.role === 'developer' && !c.consumed.includes(r.runId)))
        return record(c, e, c.stage, {}, 'ignored: developer run already active');
      const run: Run = { runId: e.runId, role: 'developer', runtime: e.runtime, input: c.candidate };
      return record(c, e, 'DEVELOPING', { runs: [...c.runs, run], candidate: c.candidate ?? { head: '', base: e.base } });
    }

    case 'developer_result': {
      if (c.consumed.includes(e.runId)) return record(c, e, c.stage, {}, 'ignored: duplicate result');
      const run = c.runs.find((r) => r.runId === e.runId && r.role === 'developer');
      if (!run) return escalate(c, e, 'result from unknown run');
      if (c.stage !== 'DEVELOPING') return escalate(c, e, 'developer result outside DEVELOPING');
      const consumed = [...c.consumed, e.runId];
      if (!e.head || e.artifacts.length === 0) return escalate(c, e, 'invalid developer result: missing commit or artifact', { consumed });
      return record(c, e, 'VERIFYING', { consumed, candidate: { head: e.head, base: c.candidate!.base } });
    }

    case 'verification': {
      if (c.stage !== 'VERIFYING') return escalate(c, e, 'verification outside VERIFYING');
      if (!sameCandidate(c.candidate, e.head)) return escalate(c, e, 'verification for a non-candidate SHA');
      if (e.checks.length === 0 || e.checks.some((k) => k.result !== 'PASS'))
        return escalate(c, e, 'required check failed or missing');
      if (c.standard >= STANDARD_LIMIT) return escalate(c, e, 'standard review budget exhausted');
      return record(c, e, 'STANDARD_REVIEW');
    }

    case 'verdict': {
      if (c.consumed.includes(e.runId)) return record(c, e, c.stage, {}, 'ignored: duplicate verdict');
      const role: Role | undefined =
        c.stage === 'STANDARD_REVIEW' ? 'standard_reviewer' : c.stage === 'ADVERSARIAL_REVIEW' ? 'adversarial_reviewer' : undefined;
      if (!role) return escalate(c, e, 'verdict outside a review stage');
      const consumed = [...c.consumed, e.runId];
      const counted = role === 'standard_reviewer' ? { standard: c.standard + 1 } : { adversarial: c.adversarial + 1 };
      if (!sameCandidate(c.candidate, e.head)) return escalate(c, e, 'verdict for a stale SHA; counted, not applied', { consumed, ...counted });
      if (role === 'standard_reviewer') {
        if (e.verdict === 'PASS') return record(c, e, 'ADVERSARIAL_REVIEW', { consumed, ...counted });
        if (c.standard + 1 < STANDARD_LIMIT) return record(c, e, 'DEVELOPING', { consumed, ...counted }, 'fix run on findings');
        return escalate(c, e, 'second standard FAIL', { consumed, ...counted });
      }
      if (e.verdict === 'PASS') return record(c, e, 'AWAITING_ACCEPTANCE', { consumed, ...counted });
      return escalate(c, e, 'adversarial FAIL', { consumed, ...counted });
    }

    case 'head_changed': {
      if (c.stage === 'DEVELOPING') return record(c, e, c.stage, {}, 'developer still writing');
      if (sameCandidate(c.candidate, e.head)) return record(c, e, c.stage, {}, 'ignored: same head');
      return escalate(c, e, 'candidate head changed outside a fix run');
    }

    case 'base_changed': {
      if (c.candidate?.base === e.base) return record(c, e, c.stage, {}, 'ignored: same base');
      return escalate(c, e, 'target base changed');
    }

    case 'accept': {
      if (c.stage !== 'AWAITING_ACCEPTANCE') return escalate(c, e, 'accept outside AWAITING_ACCEPTANCE');
      if (!sameCandidate(c.candidate, e.head)) return escalate(c, e, 'accept names a non-candidate SHA');
      return record(c, e, 'ACCEPTED');
    }

    case 'request_changes':
      return escalate(c, e, 'owner requested changes');

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
