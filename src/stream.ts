// Ticket 10-d: the observation stream (A-074, A-088). A reader replays each cycle through apply to
// give every event the stage it moved the cycle to, in store-wide order. It decides nothing: a row
// it cannot replay is passed on as stored, with null stages, never escalated.
import { DatabaseSync } from 'node:sqlite';
import { apply, checkWorkflow, defaultWorkflow, isEvent, newCycle, type Cycle, type Stage, type Workflow } from './lifecycle.ts';
import { addPositions, DEFAULT_RECORD, workflowHash, type OpenRow } from './store.ts';

export interface Line {
  /** The row's position. Increasing across the store; not dense. */
  seq: number;
  /** ISO time the row was written; null for a row written before 10-d. */
  at: string | null;
  cycleId: string;
  workId: string;
  /** The event as stored. May be of a type this version does not know. */
  event: unknown;
  /** The cycle's stage before and after the event, and its escalation after; null when the reader cannot replay the cycle. */
  from: Stage | null;
  stage: Stage | null;
  escalation: string | null;
}

/** The cycle's own recorded definition, the default, or the caller's, whichever hashes to the recorded workflow. */
function workflowOf(open: OpenRow, given?: Workflow): Workflow | undefined {
  const { hash } = open.workflow ?? DEFAULT_RECORD;
  // apply trusts its workflow, so a definition read back as data is checked like any other.
  return [open.definition, defaultWorkflow, given].find((w) => w !== undefined && checkWorkflow(w).length === 0 && workflowHash(w) === hash);
}

/** Lines after `after`, in seq order. Each poll returns the lines written since the last. */
export function openStream(path: string, opts: { workId?: string; after?: number; workflow?: Workflow } = {}): { poll(): Line[]; close(): void } {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  // The one write a reader makes: an old store has no positions to read by.
  addPositions(db);
  const read = db.prepare('SELECT pos, at, cycle_id, seq, body FROM events WHERE pos > ? ORDER BY pos');
  // lazy: every poll after the first reads only new rows, but the first replays the whole store.
  // ceiling: about 100 000 rows. upgrade: a per-cycle snapshot when a store passes that.
  const cycles = new Map<string, { workId: string; workflow?: Workflow; cycle?: Cycle }>();
  let last = 0;
  const warn = (cycleId: string, why: string) => process.stderr.write(`events: cycle ${cycleId}: ${why}; its stages are null from here\n`);
  return {
    poll() {
      const out: Line[] = [];
      for (const r of read.all(last)) {
        last = r.pos as number;
        const cycleId = r.cycle_id as string;
        const body: unknown = JSON.parse(r.body as string);
        if (r.seq === 0) {
          const open = body as OpenRow;
          const workflow = open.type === 'open' ? workflowOf(open, opts.workflow) : undefined;
          const known = { workId: typeof open.workId === 'string' ? open.workId : '', workflow, cycle: workflow && newCycle(cycleId, open.workId, open.parentCycleId) };
          cycles.set(cycleId, known);
          if (!known.cycle && (opts.workId === undefined || opts.workId === known.workId)) warn(cycleId, 'no workflow that matches the one it was opened under');
          continue;
        }
        const c = cycles.get(cycleId) ?? { workId: '' };
        cycles.set(cycleId, c);
        if (opts.workId !== undefined && c.workId !== opts.workId) continue;
        let step: { from: Stage | null; stage: Stage | null; escalation: string | null } = { from: null, stage: null, escalation: null };
        if (c.cycle && isEvent(body)) {
          c.cycle = apply(c.cycle, body, c.workflow!);
          const h = c.cycle.history.at(-1)!;
          step = { from: h.from, stage: h.to, escalation: c.cycle.escalation ?? null };
        } else if (c.cycle) {
          warn(cycleId, `row ${String(r.seq)} is not an event this version can read`);
          c.cycle = undefined;
        }
        if (last > (opts.after ?? 0)) out.push({ seq: last, at: (r.at as string | null) ?? null, cycleId, workId: c.workId, event: body, ...step });
      }
      return out;
    },
    close: () => db.close(),
  };
}
