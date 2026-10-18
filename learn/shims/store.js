// src/store.ts for the browser. Same API and the same rules, with the SQLite table replaced by an
// array of rows: row 0 of a cycle is the open marker, every append is checked as serialised bytes
// with the real isEvent, a second outcome for a run ID writes nothing, and load replays the log
// through the real apply. Keep it in step with src/store.ts; learn/learn.test.ts checks that it
// exports what src/ imports from there.
import { apply, isEvent, newCycle } from '/src/lifecycle.ts';

export const SETTLED = ['ESCALATED', 'ACCEPTED', 'CANCELLED'];
export class UnclassifiableEvent extends Error {}

const DEDUP = ['developer_result', 'verdict', 'run_failed'];

export class EventStore {
  constructor(path = ':memory:') {
    this.path = path;
    /** { cycle_id, seq, type, run_id, body } — the columns of the real table. */
    this.table = [];
    this.listeners = new Set();
  }

  /** Called after every row that was written, and after every write that was ignored. */
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(change) { for (const fn of this.listeners) fn(change); }

  open(cycleId, workId, parentCycleId) {
    requireId(cycleId, 'cycle ID');
    requireId(workId, 'work ID');
    if (this.exists(cycleId)) throw new Error(`cycle ${cycleId} already open`);
    if (parentCycleId !== undefined) {
      const parent = this.load(parentCycleId);
      if (!parent) throw new Error(`parent cycle ${parentCycleId} not found`);
      if (parent.stage !== 'ESCALATED') throw new Error(`parent cycle ${parentCycleId} is ${parent.stage}, not ESCALATED`);
      if (parent.workId !== workId) throw new Error(`parent cycle ${parentCycleId} belongs to work ${parent.workId}, not ${workId}`);
    }
    const { open, escalated } = this.cyclesFor(workId);
    if (open !== undefined) throw new Error(`work ${workId} already has an open cycle ${open}`);
    if (parentCycleId === undefined && escalated !== undefined) throw new Error(`work ${workId} has an ESCALATED cycle ${escalated}; name it as the parent`);
    const row = { type: 'open', workId, parentCycleId };
    this.table.push({ cycle_id: cycleId, seq: 0, type: 'open', run_id: null, body: JSON.stringify(row) });
    this.emit({ kind: 'open', cycleId });
    return newCycle(cycleId, workId, parentCycleId);
  }

  append(cycleId, event) {
    requireId(cycleId, 'cycle ID');
    const body = JSON.stringify(event);
    const parsed = body === undefined ? undefined : JSON.parse(body);
    if (!isEvent(parsed)) {
      this.emit({ kind: 'refused', cycleId, body });
      throw new UnclassifiableEvent(`unclassifiable event: ${body}`);
    }
    if (!this.exists(cycleId)) throw new Error(`cycle ${cycleId} not open`);
    const runId = DEDUP.includes(parsed.type) ? JSON.stringify(parsed.runId) : null;
    // The unique index on (cycle_id, run_id): INSERT OR IGNORE writes nothing for a second outcome.
    if (runId !== null && this.table.some((r) => r.cycle_id === cycleId && r.run_id === runId)) {
      this.emit({ kind: 'duplicate', cycleId, body });
      return this.load(cycleId);
    }
    const seq = Math.max(...this.table.filter((r) => r.cycle_id === cycleId).map((r) => r.seq)) + 1;
    this.table.push({ cycle_id: cycleId, seq, type: parsed.type, run_id: runId, body });
    const cycle = this.load(cycleId);
    this.emit({ kind: 'append', cycleId, seq, event: parsed, cycle });
    return cycle;
  }

  events(cycleId) { return this.rows(cycleId).filter((r) => r.type !== 'open'); }

  load(cycleId) {
    const [first, ...rest] = this.rows(cycleId);
    if (!first) return undefined;
    if (first.type !== 'open') throw new Error(`cycle ${cycleId}: row 0 is ${String(first.type)}, not the open marker`);
    return rest.reduce(apply, newCycle(cycleId, first.workId, first.parentCycleId));
  }

  close() {}

  cycles(workId) {
    return this.table.filter((r) => r.seq === 0 && JSON.parse(r.body).workId === workId)
      .map((r) => r.cycle_id).sort().map((cycleId) => ({ cycleId, stage: this.load(cycleId).stage }));
  }

  cyclesFor(workId) {
    const all = this.cycles(workId);
    return {
      open: all.find((c) => !SETTLED.includes(c.stage))?.cycleId,
      escalated: all.findLast((c) => c.stage === 'ESCALATED')?.cycleId,
    };
  }

  exists(cycleId) { return this.table.some((r) => r.cycle_id === cycleId && r.seq === 0); }

  rows(cycleId) {
    return this.table.filter((r) => r.cycle_id === cycleId).sort((a, b) => a.seq - b.seq).map((r) => JSON.parse(r.body));
  }
}

function requireId(v, what) {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${what} must be a non-empty string`);
  if (!v.isWellFormed()) throw new Error(`${what} must be a well-formed string`);
}
