// SQLite event store for cycles (ticket 02-a). One append-only table; the state machine in
// lifecycle.ts stays pure and is replayed on load. No leases, no cross-process concurrency.
import { DatabaseSync } from 'node:sqlite';
import { apply, isEvent, newCycle, type Cycle, type Event } from './lifecycle.ts';

// Row 0 of every cycle is the store's own "open" marker; it is not a lifecycle Event and never
// reaches apply. Keeping it in the same table honours the one-table constraint.
interface OpenRow {
  type: 'open';
  workId: string;
  parentCycleId?: string;
}

function requireId(v: unknown, what: string): asserts v is string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`${what} must be a non-empty string`);
}

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
      CREATE UNIQUE INDEX IF NOT EXISTS events_run
        ON events (cycle_id, type, run_id) WHERE run_id IS NOT NULL;
    `);
  }

  /** Create a cycle. Returns the initial Cycle. Throws if the ID is already in use. */
  open(cycleId: string, workId: string, parentCycleId?: string): Cycle {
    requireId(cycleId, 'cycle ID');
    requireId(workId, 'work ID');
    const row: OpenRow = { type: 'open', workId, parentCycleId };
    // Fixed seq 0, not MAX+1: a second open must collide on the primary key and be ignored,
    // otherwise it would land mid-log and reach apply, which has no 'open' case.
    const result = this.db
      .prepare('INSERT OR IGNORE INTO events (cycle_id, seq, type, run_id, body) VALUES (?, 0, ?, NULL, ?)')
      .run(cycleId, row.type, JSON.stringify(row));
    if (result.changes !== 1) throw new Error(`cycle ${cycleId} already open`);
    return newCycle(cycleId, workId, parentCycleId);
  }

  /**
   * Append one event. Throws before writing if apply could not classify it: a bad row would make
   * the whole log unloadable. Returns false, and writes nothing, for a redelivered result or
   * verdict (same type and run ID): those are the only events the spec dedups, so only those
   * carry run_id into the unique index. A redelivered claim is stored and apply decides.
   */
  append(cycleId: string, event: Event): boolean {
    requireId(cycleId, 'cycle ID');
    // Validate the serialised body, not the object: sparse arrays, toJSON, array-with-props and
    // inherited fields all pass a check on the object yet serialise to something apply reads
    // differently. What is checked here is exactly the bytes that go into the row.
    const body = JSON.stringify(event);
    const parsed: unknown = body === undefined ? undefined : JSON.parse(body);
    if (!isEvent(parsed)) throw new Error(`unclassifiable event: ${body}`);
    if (!this.exists(cycleId)) throw new Error(`cycle ${cycleId} not open`);
    const dedupKey = parsed.type === 'developer_result' || parsed.type === 'verdict' ? parsed.runId : null;
    return this.insert(cycleId, parsed.type, dedupKey, body);
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
  private insert(cycleId: string, type: string, runId: string | null, body: string): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events (cycle_id, seq, type, run_id, body)
         SELECT ?, COALESCE(MAX(seq), -1) + 1, ?, ?, ? FROM events WHERE cycle_id = ?`,
      )
      .run(cycleId, type, runId, body, cycleId);
    return result.changes === 1;
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
