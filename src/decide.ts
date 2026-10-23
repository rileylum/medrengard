// Ticket 11-a: the owner's decisions on a job's cycles, without printing, so a command, a tracker
// (row 12) or a test can record them in-process. Ticket 07-d's rules: each refuses, writing
// nothing, rather than send an event apply would escalate on.
import { apply, lastVerdictAt, took, type Cycle, type Event, type MoveAction, type Stage, type Workflow } from './lifecycle.ts';
import { STOPPED, type EventStore } from './store.ts';
import { headGate } from './verify.ts';

/** Where the job lives, for the refusals: the owner's next step is in one of these. */
export interface Where {
  runsDir: string;
  /** The job file. */
  file: string;
}

export const humanStages = (w: Workflow) => Object.keys(w.stages).filter((s) => w.stages[s]!.kind === 'human');

/** An owner's decision as it is recorded: `after` is the history length it was decided on (11-d). */
export interface Decided {
  cycleId: string;
  event: Event;
  after: number;
}

/** Accept the work's open cycle at `sha`. `store` is undefined when no run ever made one. */
export function acceptCycle(store: EventStore | undefined, workId: string, sha: string, source: string, where: Where, commandId?: string): Cycle {
  const { cycleId, event, after } = acceptEvent(store, workId, sha, source, where, commandId);
  return store!.append(cycleId, event, { after });
}

/** acceptCycle's refusals, returning the event instead of recording it, for decideAndDrive (src/run.ts). */
export function acceptEvent(store: EventStore | undefined, workId: string, sha: string, source: string, where: Where, commandId?: string): Decided {
  return humanDecision('accept', store, workId, sha, source, where, commandId);
}

/** The owner's FAIL at a human stage, with acceptEvent's refusals (11-d, A-123 item 1). */
export function requestChangesEvent(store: EventStore | undefined, workId: string, sha: string, source: string, where: Where, commandId?: string): Decided {
  return humanDecision('request_changes', store, workId, sha, source, where, commandId);
}

function humanDecision(type: 'accept' | 'request_changes', store: EventStore | undefined, workId: string, sha: string, source: string, where: Where, commandId?: string): Decided {
  const open = store?.cycles(workId).find((c) => c.stage !== undefined && !STOPPED.includes(c.stage));
  if (!store || !open) throw new Error(`no open cycle for work ${workId} in ${where.runsDir}`);
  const cycle = store.drivable(open.cycleId);
  const human = humanStages(store.workflow);
  if (!human.includes(cycle.stage)) throw new Error(`cycle ${cycle.cycleId} is ${cycle.stage}, not ${human.join(' or ') || 'at a human stage'}`);
  // The full SHA only: the owner decides on the exact commit the reviews were bound to.
  const head = cycle.candidate!.head;
  if (sha !== head) throw new Error(`${sha} is not the candidate head ${head} of cycle ${cycle.cycleId} (${where.file})`);
  const event: Event = { type, head, source, ...(commandId === undefined ? {} : { commandId }) };
  return { cycleId: cycle.cycleId, event, after: cycle.history.length };
}

/** Cancel the work's open cycle, or with none open every ESCALATED one. Returns each cycle after its cancel. */
export function cancelWork(store: EventStore | undefined, workId: string, source: string, where: Where, commandId?: string): Cycle[] {
  // A cycle the store cannot replay cannot take a cancel either: append replays it first.
  const listed = store?.cycles(workId) ?? [];
  const all = listed.filter((c) => c.stage !== undefined);
  const open = all.filter((c) => !STOPPED.includes(c.stage!));
  // With none open, every ESCALATED cycle: the store would ask a new cycle to name any of them
  // as its parent, so cancelling only one would not free the work ID.
  const targets = open.length > 0 ? open : all.filter((c) => c.stage === 'ESCALATED');
  // Named with the refusal, so "nothing to cancel" never reads as a work with no cycle.
  const unreplayable = listed.filter((c) => c.refused !== undefined).map((c) => `cycle ${c.cycleId}: the store cannot replay it: ${c.refused}`);
  if (!store || targets.length === 0) throw new Error([`nothing to cancel for work ${workId} in ${where.runsDir}`, ...unreplayable].join('; '));
  // No `after`: a cancel is meant to land whatever came between, a run in flight included (07-d).
  return targets.map(({ cycleId }) => store.append(cycleId, { type: 'cancel', source, ...(commandId === undefined ? {} : { commandId }) }));
}

/** The owner's move on an escalated cycle, as the command gives it (11-d2). */
export interface Move {
  action: MoveAction;
  /** The candidate head the owner decided on. */
  sha: string;
  reason: string;
  /** route's target. */
  stage?: Stage;
  source: string;
  commandId?: string;
}

type Verdict = Extract<Event, { type: 'verdict' }>;
type Verification = Extract<Event, { type: 'verification' }>;

/**
 * The owner's move on the work's escalated cycle (A-114), refused before anything is written when
 * apply would only record it with a note, or when the stage it enters is one the driver would
 * throw on at once: that would escalate the cycle again with reject_dispatch where a refusal does.
 * The store holds the rule on child and sibling cycles, under its write lock.
 */
export function moveEvent(store: EventStore | undefined, workId: string, move: Move, where: Where): Decided {
  if (move.reason === '') throw new Error('a move needs a reason');
  // load, not drivable: a sibling opened under another workflow is not the one moved (parked row 51).
  const escalated = (store?.cycles(workId) ?? []).filter((c) => c.stage === 'ESCALATED').map((c) => store!.load(c.cycleId)!);
  if (!store || escalated.length === 0) throw new Error(`no escalated cycle for work ${workId} in ${where.runsDir}`);
  // A parent and its child may both be escalated; the SHA names the one the owner read.
  const cycle = store.drivable((escalated.find((c) => c.candidate?.head === move.sha) ?? escalated.at(-1)!).cycleId);
  const { action, sha: head, reason, stage, source, commandId } = move;
  const event: Event = { type: 'owner_decision', action, head, reason, ...(stage === undefined ? {} : { stage }), source, ...(commandId === undefined ? {} : { commandId }) };
  // apply is pure, so this is the cycle the move leads to, before anything is written.
  const next = apply(cycle, event, store.workflow);
  if (next.stage === 'ESCALATED') throw new Error(`cycle ${cycle.cycleId} (${where.file}): ${next.history.at(-1)!.note}`);
  const def = store.workflow.stages[next.stage]!;
  // fix's precondition (developer.ts): its findings are the last verdict's. Goes when A-108 lets a commit stage run without one.
  if (def.kind === 'agent' && def.produces === 'commit') {
    const last = next.history[lastVerdictAt(store.workflow, next)]?.event as Verdict | undefined;
    if (last?.verdict !== 'FAIL' || last.head !== head)
      throw new Error(`cycle ${cycle.cycleId}: commit stage ${next.stage} runs a fix, which needs a FAIL for the candidate ${head}; the last verdict is ${last ? `a ${last.verdict} for ${last.head}` : 'none'}`);
  }
  // review's precondition (review.ts): the reviewer reads the checkout and evidence verify made of the candidate.
  if (def.kind === 'agent' && def.produces === 'verdict') {
    const last = next.history.findLast((h) => h.event.type === 'verification' && took(store.workflow, h))?.event as Verification | undefined;
    if (last?.head !== head) throw new Error(`cycle ${cycle.cycleId}: review stage ${next.stage} reads the verification of the candidate ${head}; the last is for ${last?.head ?? 'none'}`);
  }
  if (def.kind === 'command' && (def.grants ?? []).length > 0) headGate(next, store.workflow);
  return { cycleId: cycle.cycleId, event, after: cycle.history.length };
}
