// SQLite event store for cycles (ticket 02-a). One append-only table; the state machine in
// lifecycle.ts stays pure and is replayed on load. No leases. A second process (the owner's
// cancel during a run, 07-d) waits for the write lock rather than failing.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { apply, checkWorkflow, defaultWorkflow, ENGINE_VERSION, isEvent, newCycle, outcomeRunId, replayCheck, SETTLED, type Cycle, type Event, type Stage, type Workflow } from './lifecycle.ts';

// Row 0 of every cycle is the store's own "open" marker; it is not a lifecycle Event and never
// reaches apply. Keeping it in the same table honours the one-table constraint.
export interface OpenRow {
  type: 'open';
  workId: string;
  parentCycleId?: string;
  /** Absent in stores written before 09-b, whose cycles were all opened under defaultWorkflow. */
  workflow?: { name: string; hash: string };
  /** The resolved base SHA (10-b): accept and cancel read the configuration layers at it. Absent before 10-b. */
  base?: string;
  /** The workflow itself (10-d), so a reader with no job file can replay the cycle. Trust it only if it hashes to `workflow.hash`. */
  definition?: Workflow;
  /** The ENGINE_VERSION that opened the cycle (11-c). Absent before 11-c. */
  engine?: number;
}

/**
 * SHA-256 of the workflow's JSON. Key order counts: reordering a workflow file makes it a new
 * workflow, which is safe (its old cycles replay under their recorded copy, and drivable refuses
 * to drive them) and avoids a canonical serialiser.
 */
export function workflowHash(w: Workflow): string {
  return createHash('sha256').update(JSON.stringify(w)).digest('hex');
}
export const DEFAULT_RECORD = { name: defaultWorkflow.name!, hash: workflowHash(defaultWorkflow) };

/** The recorded definition, then defaultWorkflow, then `given`: the first that passes replayCheck and hashes to the recorded workflow. */
export function recordedWorkflow(open: OpenRow, given?: Workflow): Workflow | undefined {
  const { hash } = open.workflow ?? DEFAULT_RECORD;
  // apply trusts its workflow, so a definition read back as data is checked, but only for what
  // apply reads: the full checkWorkflow ran when the cycle opened, and may have tightened since (G9).
  return [open.definition, defaultWorkflow, given].find((w) => w !== undefined && replayCheck(w).length === 0 && workflowHash(w) === hash);
}

// Each row's position across the store and the time it was written (10-d), both set inside the
// one insert statement: SQLite holds the write lock for the statement, so positions follow commit
// order and a reader never sees N+1 before N. The time stays out of the Event body, so replay is
// unchanged.
const POS = '(SELECT COALESCE(MAX(pos), 0) + 1 FROM events)';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * Add `pos` and `at` to a store written before 10-d. Old rows are numbered in (cycle_id, seq)
 * order, before every new row, and keep a null time: their real order across cycles is lost.
 * Checked again under the write lock, so two processes upgrading one store cannot both add them.
 */
export function addPositions(db: DatabaseSync): void {
  const has = () => db.prepare("SELECT 1 FROM pragma_table_info('events') WHERE name = 'pos'").get() !== undefined;
  if (has()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!has()) db.exec(`
      ALTER TABLE events ADD COLUMN pos INTEGER;
      ALTER TABLE events ADD COLUMN at TEXT;
      UPDATE events SET pos = n FROM (SELECT cycle_id AS c, seq AS s, ROW_NUMBER() OVER (ORDER BY cycle_id, seq) AS n FROM events) WHERE cycle_id = c AND seq = s;
      CREATE UNIQUE INDEX events_pos ON events (pos);
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Add `stage` to a store written before 11-c: the stage apply gave each row, kept as a checksum,
 * never read as state (A-123). Old rows stay null and are not compared. Filling them from today's
 * apply would vouch for whatever today's apply says, which is what the column is there to catch.
 */
function addStages(db: DatabaseSync): void {
  const has = () => db.prepare("SELECT 1 FROM pragma_table_info('events') WHERE name = 'stage'").get() !== undefined;
  if (has()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!has()) db.exec('ALTER TABLE events ADD COLUMN stage TEXT');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * How each cycle of the work was opened: its base and workflow hash. Read without replay, so it
 * needs no workflow: accept and cancel use it to pick the workflow to open the store with.
 */
export function openings(path: string, workId: string): { base?: string; hash: string }[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    // A read waits out a writer's exclusive lock, as the store's own connection does.
    db.exec('PRAGMA busy_timeout = 5000');
    return db
      .prepare("SELECT body FROM events WHERE seq = 0 AND json_extract(body, '$.workId') = ?")
      .all(workId)
      .map((r) => JSON.parse(r.body as string) as OpenRow)
      .map((o) => ({ base: o.base, hash: (o.workflow ?? DEFAULT_RECORD).hash }));
  } finally {
    db.close();
  }
}

function requireId(v: unknown, what: string): asserts v is string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${what} must be a non-empty string`);
  // SQLite stores a lone surrogate as U+FFFD, so two ill-formed IDs would share one row key.
  if (!v.isWellFormed()) throw new Error(`${what} must be a well-formed string`);
}

// main.ts and the guide's demos import it from here.
export { SETTLED };

/** append refused the event because apply could not classify its serialised form. */
export class UnclassifiableEvent extends Error {}

/** The replay disagrees with a stage stored on a row: the engine reads this log differently from the one that wrote it. */
export class ReplayDiverged extends Error {}

/** The cycle has rows the writer had not loaded when it decided; nothing was written (11-d, A-132). */
export class StaleLoad extends Error {}

/**
 * The run_id column's key: a run's outcome by its JSON-escaped run ID, an event from outside a
 * run by its command ID (11-d). One unique index then keeps the first of each. A run key is a
 * JSON string and starts with `"`, a command key with `{`, so the two never collide.
 */
function dedupKey(e: Event): string | null {
  const runId = outcomeRunId(e);
  if (runId !== undefined) return JSON.stringify(runId);
  const commandId = (e as { commandId?: unknown }).commandId;
  return typeof commandId === 'string' ? JSON.stringify({ commandId }) : null;
}

export class EventStore {
  private db: DatabaseSync;
  readonly workflow: Workflow;
  private record: { name: string; hash: string };

  /**
   * `workflow` opens new cycles and is the only one the stage functions drive (`drivable`); a load
   * replays each cycle under the workflow it recorded. Throws, before touching `path`, if
   * checkWorkflow refuses it.
   */
  constructor(path: string, workflow: Workflow = defaultWorkflow) {
    const refused = checkWorkflow(workflow);
    if (refused.length > 0) throw new Error(`workflow refused: ${refused.join('; ')}`);
    this.workflow = workflow;
    this.record = { name: workflow.name ?? 'unnamed', hash: workflowHash(workflow) };
    this.db = new DatabaseSync(path);
    // Every write here is one statement, or a transaction that replays one cycle (append, open), so
    // a second process waits at most for one append or open: milliseconds for a cycle of hundreds of
    // events (11-c probe: 3.4 ms at 1,000).
    // At 0 (SQLite's default) `main.ts cancel` during a run fails with `database is locked`.
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        cycle_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        run_id TEXT,
        body TEXT NOT NULL,
        PRIMARY KEY (cycle_id, seq)
      ) WITHOUT ROWID;
      CREATE UNIQUE INDEX IF NOT EXISTS events_run_outcome
        ON events (cycle_id, run_id) WHERE run_id IS NOT NULL;
    `);
    addPositions(this.db);
    addStages(this.db);
  }

  /** Create a cycle. Returns the initial Cycle. Throws if the ID is already in use. */
  open(cycleId: string, workId: string, parentCycleId?: string, base?: string): Cycle {
    requireId(cycleId, 'cycle ID');
    requireId(workId, 'work ID');
    // The checks and the insert share one write lock, as in addPositions: otherwise two processes
    // opening different cycle IDs for one work both pass the open-cycle check and both insert.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.exists(cycleId)) throw new Error(`cycle ${cycleId} already open`);
      // Spec: one work item has at most one open cycle, and a new cycle names an ESCALATED parent
      // (02-b adversarial; openChild checks the parent in memory, this is the store's copy).
      if (parentCycleId !== undefined) {
        const parent = this.load(parentCycleId);
        if (!parent) throw new Error(`parent cycle ${parentCycleId} not found`);
        if (parent.stage !== 'ESCALATED') throw new Error(`parent cycle ${parentCycleId} is ${parent.stage}, not ESCALATED`);
        if (parent.workId !== workId) throw new Error(`parent cycle ${parentCycleId} belongs to work ${parent.workId}, not ${workId}`);
      }
      const { open, escalated } = this.cyclesFor(workId);
      if (open !== undefined) throw new Error(`work ${workId} already has an open cycle ${open}`);
      // Spec: a new cycle for the same work names its parent; an escalated cycle is waiting for one.
      if (parentCycleId === undefined && escalated !== undefined) throw new Error(`work ${workId} has an ESCALATED cycle ${escalated}; name it as the parent`);
      const row: OpenRow = { type: 'open', workId, parentCycleId, workflow: this.record, base, definition: this.workflow, engine: ENGINE_VERSION };
      // Fixed seq 0, not MAX+1: an open row that landed mid-log would reach apply, which has no
      // 'open' case.
      this.db
        .prepare(`INSERT INTO events (cycle_id, seq, type, run_id, body, pos, at, stage) VALUES (?, 0, ?, NULL, ?, ${POS}, ${NOW}, 'QUEUED')`)
        .run(cycleId, row.type, JSON.stringify(row));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return newCycle(cycleId, workId, parentCycleId);
  }

  /**
   * Append one event and return the Cycle replayed from the log. Callers must use the returned
   * Cycle and never apply the object they passed in: the object can read differently live than
   * its serialised form does (02-c finding). Throws before writing if apply could not classify
   * the serialised event: a bad row would make the whole log unloadable. A run has one outcome:
   * a second outcome for a run ID that already has one writes nothing and returns the current
   * Cycle; so does a second event with a command ID the cycle has already recorded. Only those
   * carry a key into the unique index (`dedupKey`); a redelivered claim is stored and apply decides.
   * The load, the apply and the insert share one write lock, so the stage stored on the row is the
   * one the rows before it lead to. `after`: the history length of the cycle the writer decided
   * on; a longer history throws StaleLoad, so two owner commands decided on one load cannot both
   * land (A-132). Run outcomes and cancel pass none: they must land whatever came between.
   */
  append(cycleId: string, event: Event, opts: { after?: number } = {}): Cycle {
    requireId(cycleId, 'cycle ID');
    // Validate the serialised body, not the object: sparse arrays, toJSON, array-with-props and
    // inherited fields all pass a check on the object yet serialise to something apply reads
    // differently. What is checked here is exactly the bytes that go into the row.
    const body = JSON.stringify(event);
    const parsed: unknown = body === undefined ? undefined : JSON.parse(body);
    if (!isEvent(parsed)) throw new UnclassifiableEvent(`unclassifiable event: ${body}`);
    // The index key is JSON-escaped, not the raw string: SQLite would fold a lone surrogate to
    // U+FFFD and two distinct IDs would collide.
    const key = dedupKey(parsed);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = this.replay(cycleId);
      if (!now) throw new Error(`cycle ${cycleId} not open`);
      const length = now.cycle.history.length;
      if (opts.after !== undefined && length !== opts.after)
        throw new StaleLoad(`cycle ${cycleId} moved since it was loaded: ${length} events, not ${opts.after}; nothing was written`);
      // The parsed body, not `event`: the cycle a later load replays from the row (02-c).
      const next = apply(now.cycle, parsed, now.workflow);
      const written = this.insert(cycleId, parsed.type, key, body, next.stage);
      this.db.exec('COMMIT');
      return written ? next : now.cycle;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Lifecycle events for a cycle in commit order, without the open marker. */
  events(cycleId: string): Event[] {
    return this.rows(cycleId).map((r) => r.body).filter((b) => b.type !== 'open') as Event[];
  }

  /** Replay the cycle through apply, under the workflow it was opened with. Undefined if the cycle was never opened. */
  load(cycleId: string): Cycle | undefined {
    return this.replay(cycleId)?.cycle;
  }

  /**
   * Load a cycle to act on it. The stage functions read their stage table from `this.workflow`,
   * so a cycle opened under another workflow is refused here, though `load` reads it (A-136).
   */
  drivable(cycleId: string): Cycle {
    const r = this.replay(cycleId);
    if (!r) throw new Error(`cycle ${cycleId} not open`);
    if (r.opened.hash !== this.record.hash) throw this.mismatch(cycleId, r.opened);
    return r.cycle;
  }

  close(): void {
    this.db.close();
  }

  private replay(cycleId: string): { cycle: Cycle; workflow: Workflow; opened: { name: string; hash: string } } | undefined {
    const rows = this.rows(cycleId);
    if (rows.length === 0) return undefined;
    const head = rows[0]!.body;
    // workId and parent come from this row; any other type would replay as a cycle of no work.
    if (head?.type !== 'open') throw new Error(`cycle ${cycleId}: row 0 is ${String(head?.type)}, not the open marker`);
    const opened = head.workflow ?? DEFAULT_RECORD;
    // A cycle replayed under another workflow than it was opened with can reach a stage it never
    // had, so it replays only under one that hashes to its record; with none, refuse (A-059, A-112).
    const workflow = recordedWorkflow(head, this.workflow);
    if (!workflow) throw this.mismatch(cycleId, opened);
    let cycle = newCycle(cycleId, head.workId, head.parentCycleId);
    for (const [i, { seq, body, stage }] of rows.entries()) {
      if (i > 0) cycle = apply(cycle, body as Event, workflow);
      if (stage !== null && stage !== cycle.stage)
        throw new ReplayDiverged(`cycle ${cycleId} row ${seq} (${body.type}) was recorded at ${stage}, but replays to ${cycle.stage} under engine ${ENGINE_VERSION} (opened ${head.engine === undefined ? 'before engine versions' : `under engine ${head.engine}`}); the cycle is not driven`);
    }
    return { cycle, workflow, opened };
  }

  private mismatch(cycleId: string, opened: { name: string; hash: string }): Error {
    return new Error(`cycle ${cycleId} was opened under workflow ${opened.name} (${opened.hash.slice(0, 12)}), this store runs ${this.record.name} (${this.record.hash.slice(0, 12)})`);
  }

  // OR IGNORE turns the unique-index hit into "no change"; returns false then.
  private insert(cycleId: string, type: string, runId: string | null, body: string, stage: Stage): boolean {
    return this.db
      .prepare(
        `INSERT OR IGNORE INTO events (cycle_id, seq, type, run_id, body, pos, at, stage)
         SELECT ?, COALESCE(MAX(seq), -1) + 1, ?, ?, ?, ${POS}, ${NOW}, ? FROM events WHERE cycle_id = ?`,
      )
      .run(cycleId, type, runId, body, stage, cycleId).changes > 0;
  }

  /** Every cycle of a work item with its replayed stage, ordered by cycle ID. */
  cycles(workId: string): { cycleId: string; stage: Stage }[] {
    return this.db
      .prepare("SELECT cycle_id FROM events WHERE seq = 0 AND json_extract(body, '$.workId') = ? ORDER BY cycle_id")
      .all(workId)
      .map((r) => ({ cycleId: r.cycle_id as string, stage: this.load(r.cycle_id as string)!.stage }));
  }

  /**
   * Every cycle not in SETTLED, across work IDs, ordered by cycle ID: what recover (11-f) must
   * resolve. A cycle that cannot be replayed is listed with the reason, so one bad cycle does not
   * hide the rest; it is the owner's to resolve.
   */
  unsettled(): { cycleId: string; workId: string; stage?: Stage; refused?: string }[] {
    const out: { cycleId: string; workId: string; stage?: Stage; refused?: string }[] = [];
    for (const r of this.db.prepare('SELECT cycle_id, body FROM events WHERE seq = 0 ORDER BY cycle_id').all()) {
      const cycleId = r.cycle_id as string;
      // Only a raw write makes row 0 anything but an open marker; it is listed, not thrown.
      let workId = '';
      let stage: Stage;
      try {
        let open: Partial<OpenRow> | null;
        try { open = JSON.parse(r.body as string); } catch { throw new Error(`cycle ${cycleId}: row 0 is not JSON`); }
        if (typeof open?.workId === 'string') workId = open.workId;
        stage = this.load(cycleId)!.stage;
      } catch (err) {
        out.push({ cycleId, workId, refused: (err as Error).message });
        continue;
      }
      if (!SETTLED.includes(stage)) out.push({ cycleId, workId, stage });
    }
    return out;
  }

  // Open means still able to move: escalated cycles wait for the owner and never move again.
  private cyclesFor(workId: string): { open?: string; escalated?: string } {
    const all = this.cycles(workId);
    return {
      open: all.find((c) => !SETTLED.includes(c.stage))?.cycleId,
      escalated: all.findLast((c) => c.stage === 'ESCALATED')?.cycleId,
    };
  }

  private exists(cycleId: string): boolean {
    return this.db.prepare('SELECT 1 FROM events WHERE cycle_id = ? AND seq = 0').get(cycleId) !== undefined;
  }

  private rows(cycleId: string): { seq: number; body: Event | OpenRow; stage: Stage | null }[] {
    return this.db
      .prepare('SELECT seq, body, stage FROM events WHERE cycle_id = ? ORDER BY seq')
      .all(cycleId)
      .map((r) => ({ seq: r.seq as number, body: JSON.parse(r.body as string), stage: r.stage as Stage | null }));
  }
}
