// src/store.ts for the browser. Same API and the same rules, with the SQLite table replaced by an
// array of rows: row 0 of a cycle is the open marker with the workflow's name, hash and
// definition; every append is checked as serialised bytes with the real isEvent; a second outcome
// for a run ID, or a second event with one command ID, writes nothing; an append decided on a load
// the cycle has since left throws StaleLoad; each row gets a store-wide `pos`, a time `at` and the stage apply
// gave it; load replays the log through the real apply under the workflow the cycle recorded,
// refuses one whose replay disagrees with a stored stage, and drivable refuses a cycle opened under
// another workflow. Keep it in step with src/store.ts; learn/learn.test.ts checks that it exports
// what src/ imports from there.
import { createHash } from 'node:crypto';
import { apply, checkWorkflow, defaultWorkflow, ENGINE_VERSION, isEvent, newCycle, outcomeRunId, replayCheck, SETTLED } from '/src/lifecycle.ts';

export { SETTLED };
export class UnclassifiableEvent extends Error {}
export class ReplayDiverged extends Error {}
export class StaleLoad extends Error {}

// A run key is a JSON string, a command key a JSON object, so the two never collide.
function dedupKey(e) {
  const runId = outcomeRunId(e);
  if (runId !== undefined) return JSON.stringify(runId);
  return typeof e.commandId === 'string' ? JSON.stringify({ commandId: e.commandId }) : null;
}

export const workflowHash = (w) => createHash('sha256').update(JSON.stringify(w)).digest('hex');
export const DEFAULT_RECORD = { name: defaultWorkflow.name, hash: workflowHash(defaultWorkflow) };

export function recordedWorkflow(open, given) {
  const { hash } = open.workflow ?? DEFAULT_RECORD;
  return [open.definition, defaultWorkflow, given].find((w) => w !== undefined && replayCheck(w).length === 0 && workflowHash(w) === hash);
}

export class EventStore {
  constructor(path = ':memory:', workflow = defaultWorkflow, table = []) {
    const refused = checkWorkflow(workflow);
    if (refused.length > 0) throw new Error(`workflow refused: ${refused.join('; ')}`);
    this.path = path;
    this.workflow = workflow;
    this.record = { name: workflow.name ?? 'unnamed', hash: workflowHash(workflow) };
    /** { cycle_id, seq, type, run_id, body, pos, at, stage }: the columns of the real table. Two stores may share one. */
    this.table = table;
    this.listeners = new Set();
  }

  /** Called after every row that was written, and after every write that was ignored. Not in src/store.ts: the demos draw from it. */
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(change) { for (const fn of this.listeners) fn(change); }

  open(cycleId, workId, parentCycleId, base) {
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
    const row = { type: 'open', workId, parentCycleId, workflow: this.record, base, definition: this.workflow, engine: ENGINE_VERSION };
    this.insert(cycleId, 0, 'open', null, JSON.stringify(row), 'QUEUED');
    this.emit({ kind: 'open', cycleId });
    return newCycle(cycleId, workId, parentCycleId);
  }

  append(cycleId, event, opts = {}) {
    requireId(cycleId, 'cycle ID');
    const body = JSON.stringify(event);
    const parsed = body === undefined ? undefined : JSON.parse(body);
    if (!isEvent(parsed)) {
      this.emit({ kind: 'refused', cycleId, body });
      throw new UnclassifiableEvent(`unclassifiable event: ${body}`);
    }
    const runId = dedupKey(parsed);
    // One write at a time is the whole lock here: the replay, the check, the apply and the insert.
    const now = this.replay(cycleId);
    if (!now) throw new Error(`cycle ${cycleId} not open`);
    const length = now.cycle.history.length;
    if (opts.after !== undefined && length !== opts.after)
      throw new StaleLoad(`cycle ${cycleId} moved since it was loaded: ${length} events, not ${opts.after}; nothing was written`);
    // The unique index on (cycle_id, run_id): INSERT OR IGNORE writes nothing for a second outcome or command.
    if (runId !== null && this.table.some((r) => r.cycle_id === cycleId && r.run_id === runId)) {
      this.emit({ kind: 'duplicate', cycleId, body });
      return now.cycle;
    }
    const cycle = apply(now.cycle, parsed, now.workflow);
    const seq = Math.max(...this.table.filter((r) => r.cycle_id === cycleId).map((r) => r.seq)) + 1;
    const row = this.insert(cycleId, seq, parsed.type, runId, body, cycle.stage);
    this.emit({ kind: 'append', cycleId, seq, pos: row.pos, event: parsed, cycle });
    return cycle;
  }

  events(cycleId) { return this.rows(cycleId).map((r) => r.body).filter((b) => b.type !== 'open'); }

  load(cycleId) { return this.replay(cycleId)?.cycle; }

  drivable(cycleId) {
    const r = this.replay(cycleId);
    if (!r) throw new Error(`cycle ${cycleId} not open`);
    if (r.opened.hash !== this.record.hash) throw this.mismatch(cycleId, r.opened);
    return r.cycle;
  }

  unsettled() {
    const out = [];
    for (const r of this.table.filter((r) => r.seq === 0).sort((a, b) => (a.cycle_id < b.cycle_id ? -1 : 1))) {
      const cycleId = r.cycle_id;
      let workId = '';
      let stage;
      try {
        let open;
        try { open = JSON.parse(r.body); } catch { throw new Error(`cycle ${cycleId}: row 0 is not JSON`); }
        if (typeof open?.workId === 'string') workId = open.workId;
        stage = this.load(cycleId).stage;
      } catch (err) { out.push({ cycleId, workId, refused: err.message }); continue; }
      if (!SETTLED.includes(stage)) out.push({ cycleId, workId, stage });
    }
    return out;
  }

  replay(cycleId) {
    const rows = this.rows(cycleId);
    if (rows.length === 0) return undefined;
    const head = rows[0].body;
    if (head?.type !== 'open') throw new Error(`cycle ${cycleId}: row 0 is ${String(head?.type)}, not the open marker`);
    const opened = head.workflow ?? DEFAULT_RECORD;
    const workflow = recordedWorkflow(head, this.workflow);
    if (!workflow) throw this.mismatch(cycleId, opened);
    let cycle = newCycle(cycleId, head.workId, head.parentCycleId);
    for (const [i, { seq, body, stage }] of rows.entries()) {
      if (i > 0) cycle = apply(cycle, body, workflow);
      if (stage !== null && stage !== cycle.stage)
        throw new ReplayDiverged(`cycle ${cycleId} row ${seq} (${body.type}) was recorded at ${stage}, but replays to ${cycle.stage} under engine ${ENGINE_VERSION} (opened ${head.engine === undefined ? 'before engine versions' : `under engine ${head.engine}`}); the cycle is not driven`);
    }
    return { cycle, workflow, opened };
  }

  mismatch(cycleId, opened) {
    return new Error(`cycle ${cycleId} was opened under workflow ${opened.name} (${opened.hash.slice(0, 12)}), this store runs ${this.record.name} (${this.record.hash.slice(0, 12)})`);
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

  // pos and at are set in the real insert statement; here, one row at a time is the whole lock.
  insert(cycleId, seq, type, runId, body, stage) {
    const row = { cycle_id: cycleId, seq, type, run_id: runId, body, pos: this.table.length + 1, at: new Date().toISOString(), stage };
    this.table.push(row);
    return row;
  }

  rows(cycleId) {
    return this.table.filter((r) => r.cycle_id === cycleId).sort((a, b) => a.seq - b.seq).map((r) => ({ seq: r.seq, body: JSON.parse(r.body), stage: r.stage ?? null }));
  }
}

function requireId(v, what) {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${what} must be a non-empty string`);
  if (!v.isWellFormed()) throw new Error(`${what} must be a well-formed string`);
}
