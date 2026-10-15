// SQLite event store for cycles (ticket 02-a). One append-only table; the state machine in
// lifecycle.ts stays pure and is replayed on load. No leases, no cross-process concurrency.
import { DatabaseSync } from 'node:sqlite';
import { apply, newCycle, type Cycle, type Event } from './lifecycle.ts';

// Row 0 of every cycle is the store's own "open" marker; it is not a lifecycle Event and never
// reaches apply. Keeping it in the same table honours the one-table constraint.
interface OpenRow {
  type: 'open';
  workId: string;
  parentCycleId?: string;
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
    const row: OpenRow = { type: 'open', workId, parentCycleId };
    const inserted = this.insert(cycleId, row.type, null, row);
    if (!inserted) throw new Error(`cycle ${cycleId} already open`);
    return newCycle(cycleId, workId, parentCycleId);
  }

  /**
   * Append one event. Returns false, and writes nothing, when an event of the same type with
   * the same run ID is already stored for this cycle: a redelivered result or verdict must not
   * grow the log. (type, run_id) rather than run_id alone because a claim and its
   * developer_result legitimately share a run ID.
   */
  append(cycleId: string, event: Event): boolean {
    if (!this.exists(cycleId)) throw new Error(`cycle ${cycleId} not open`);
    return this.insert(cycleId, event.type, 'runId' in event ? event.runId : null, event);
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
  private insert(cycleId: string, type: string, runId: string | null, body: object): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events (cycle_id, seq, type, run_id, body)
         SELECT ?, COALESCE(MAX(seq), -1) + 1, ?, ?, ? FROM events WHERE cycle_id = ?`,
      )
      .run(cycleId, type, runId, JSON.stringify(body), cycleId);
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
