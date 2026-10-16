// SQLite event store for cycles (ticket 02-a). One append-only table; the state machine in
// lifecycle.ts stays pure and is replayed on load. No leases, no cross-process concurrency.
import { DatabaseSync } from 'node:sqlite';
import { apply, isEvent, newCycle, type Cycle, type Event, type Stage } from './lifecycle.ts';

// Row 0 of every cycle is the store's own "open" marker; it is not a lifecycle Event and never
// reaches apply. Keeping it in the same table honours the one-table constraint.
interface OpenRow {
  type: 'open';
  workId: string;
  parentCycleId?: string;
}

function requireId(v: unknown, what: string): asserts v is string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${what} must be a non-empty string`);
  // SQLite stores a lone surrogate as U+FFFD, so two ill-formed IDs would share one row key.
  if (!v.isWellFormed()) throw new Error(`${what} must be a well-formed string`);
}

const DEDUP: Event['type'][] = ['developer_result', 'verdict', 'run_failed'];
const SETTLED: Stage[] = ['ESCALATED', 'ACCEPTED', 'CANCELLED'];

/** append refused the event because apply could not classify its serialised form. */
export class UnclassifiableEvent extends Error {}

export class EventStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
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
  }

  /** Create a cycle. Returns the initial Cycle. Throws if the ID is already in use. */
  open(cycleId: string, workId: string, parentCycleId?: string): Cycle {
    requireId(cycleId, 'cycle ID');
    requireId(workId, 'work ID');
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
    const row: OpenRow = { type: 'open', workId, parentCycleId };
    // Fixed seq 0, not MAX+1: a second open (racing the check above on another connection)
    // must collide on the primary key and be ignored, otherwise it would land mid-log and reach
    // apply, which has no 'open' case.
    const result = this.db
      .prepare('INSERT OR IGNORE INTO events (cycle_id, seq, type, run_id, body) VALUES (?, 0, ?, NULL, ?)')
      .run(cycleId, row.type, JSON.stringify(row));
    if (result.changes !== 1) throw new Error(`cycle ${cycleId} already open`);
    return newCycle(cycleId, workId, parentCycleId);
  }

  /**
   * Append one event and return the Cycle replayed from the log. Callers must use the returned
   * Cycle and never apply the object they passed in: the object can read differently live than
   * its serialised form does (02-c finding). Throws before writing if apply could not classify
   * the serialised event: a bad row would make the whole log unloadable. A run has one outcome:
   * a second result, verdict or run_failed for a run ID that already has one writes nothing and
   * returns the current Cycle. Only those three carry run_id into the unique index; a redelivered
   * claim is stored and apply decides.
   */
  append(cycleId: string, event: Event): Cycle {
    requireId(cycleId, 'cycle ID');
    // Validate the serialised body, not the object: sparse arrays, toJSON, array-with-props and
    // inherited fields all pass a check on the object yet serialise to something apply reads
    // differently. What is checked here is exactly the bytes that go into the row.
    const body = JSON.stringify(event);
    const parsed: unknown = body === undefined ? undefined : JSON.parse(body);
    if (!isEvent(parsed)) throw new UnclassifiableEvent(`unclassifiable event: ${body}`);
    if (!this.exists(cycleId)) throw new Error(`cycle ${cycleId} not open`);
    // The index key is the JSON-escaped run ID, not the raw string: SQLite would fold a lone
    // surrogate to U+FFFD and two distinct run IDs would collide.
    const dedupKey = DEDUP.includes(parsed.type) ? JSON.stringify((parsed as { runId: string }).runId) : null;
    this.insert(cycleId, parsed.type, dedupKey, body);
    return this.load(cycleId)!;
  }

  /** Lifecycle events for a cycle in commit order, without the open marker. */
  events(cycleId: string): Event[] {
    return this.rows(cycleId).filter((r) => r.type !== 'open') as Event[];
  }

  /** Replay the cycle through apply. Undefined if the cycle was never opened. */
  load(cycleId: string): Cycle | undefined {
    const [first, ...rest] = this.rows(cycleId);
    if (!first) return undefined;
    const head = first as OpenRow;
    return (rest as Event[]).reduce(apply, newCycle(cycleId, head.workId, head.parentCycleId));
  }

  close(): void {
    this.db.close();
  }

  // Single statement so seq allocation and the insert cannot interleave with another append on
  // this connection; OR IGNORE turns the unique-index hit into "no change".
  private insert(cycleId: string, type: string, runId: string | null, body: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO events (cycle_id, seq, type, run_id, body)
         SELECT ?, COALESCE(MAX(seq), -1) + 1, ?, ?, ? FROM events WHERE cycle_id = ?`,
      )
      .run(cycleId, type, runId, body, cycleId);
  }

  // Open means still able to move: escalated cycles wait for the owner and never move again.
  private cyclesFor(workId: string): { open?: string; escalated?: string } {
    const stages = this.db
      .prepare("SELECT cycle_id FROM events WHERE seq = 0 AND json_extract(body, '$.workId') = ? ORDER BY cycle_id")
      .all(workId)
      .map((r) => [r.cycle_id as string, this.load(r.cycle_id as string)!.stage] as const);
    return {
      open: stages.find(([, stage]) => !SETTLED.includes(stage))?.[0],
      escalated: stages.findLast(([, stage]) => stage === 'ESCALATED')?.[0],
    };
  }

  private exists(cycleId: string): boolean {
    return this.db.prepare('SELECT 1 FROM events WHERE cycle_id = ? AND seq = 0').get(cycleId) !== undefined;
  }

  private rows(cycleId: string): (Event | OpenRow)[] {
    return this.db
      .prepare('SELECT body FROM events WHERE cycle_id = ? ORDER BY seq')
      .all(cycleId)
      .map((r) => JSON.parse(r.body as string));
  }
}
