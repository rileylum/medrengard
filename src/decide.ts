// Ticket 11-a: the owner's decisions on a job's cycles, without printing, so a command, a tracker
// (row 12) or a test can record them in-process. Ticket 07-d's rules: each refuses, writing
// nothing, rather than send an event apply would escalate on.
import type { Cycle, Event, Workflow } from './lifecycle.ts';
import { SETTLED, type EventStore } from './store.ts';

/** Where the job lives, for the refusals: the owner's next step is in one of these. */
export interface Where {
  runsDir: string;
  /** The job file. */
  file: string;
}

export const humanStages = (w: Workflow) => Object.keys(w.stages).filter((s) => w.stages[s]!.kind === 'human');

/** Accept the work's open cycle at `sha`. `store` is undefined when no run ever made one. */
export function acceptCycle(store: EventStore | undefined, workId: string, sha: string, source: string, where: Where): Cycle {
  const { cycleId, event } = acceptEvent(store, workId, sha, source, where);
  return store!.append(cycleId, event);
}

/** acceptCycle's refusals, returning the event instead of recording it, for decideAndDrive (src/run.ts). */
export function acceptEvent(store: EventStore | undefined, workId: string, sha: string, source: string, where: Where): { cycleId: string; event: Event } {
  const open = store?.cycles(workId).find((c) => !SETTLED.includes(c.stage));
  if (!store || !open) throw new Error(`no open cycle for work ${workId} in ${where.runsDir}`);
  const cycle = store.load(open.cycleId)!;
  const human = humanStages(store.workflow);
  if (!human.includes(cycle.stage)) throw new Error(`cycle ${cycle.cycleId} is ${cycle.stage}, not ${human.join(' or ') || 'at a human stage'}`);
  // The full SHA only: the owner accepts the exact commit the reviews were bound to.
  const head = cycle.candidate!.head;
  if (sha !== head) throw new Error(`${sha} is not the candidate head ${head} of cycle ${cycle.cycleId} (${where.file})`);
  return { cycleId: cycle.cycleId, event: { type: 'accept', head, source } };
}

/** Cancel the work's open cycle, or with none open every ESCALATED one. Returns each cycle after its cancel. */
export function cancelWork(store: EventStore | undefined, workId: string, source: string, where: Where): Cycle[] {
  const all = store?.cycles(workId) ?? [];
  const open = all.filter((c) => !SETTLED.includes(c.stage));
  // With none open, every ESCALATED cycle: the store would ask a new cycle to name any of them
  // as its parent, so cancelling only one would not free the work ID.
  const targets = open.length > 0 ? open : all.filter((c) => c.stage === 'ESCALATED');
  if (!store || targets.length === 0) throw new Error(`nothing to cancel for work ${workId} in ${where.runsDir}`);
  return targets.map(({ cycleId }) => store.append(cycleId, { type: 'cancel', source }));
}
