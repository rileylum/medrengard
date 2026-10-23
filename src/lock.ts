// Ticket 11-f: one process at a time drives or recovers a work (A-105 item 3). Without it, recover
// would call a run gone that a live controller had recorded but not yet launched, and two drivers
// would each start a reviewer run on one cycle. A work, not a cycle: the run command holds it
// before develop opens the cycle, and a work has at most one cycle a run acts on.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { lockFile } from './layout.ts';

/** Another live process holds the work. */
export class Locked extends Error {
  readonly workId: string;
  readonly pid: number;
  constructor(workId: string, pid: number) {
    super(`work ${workId} is held by process ${pid}, which is driving or recovering it`);
    this.workId = workId;
    this.pid = pid;
  }
}

/**
 * When `pid` started, in clock ticks since boot (field 22 of /proc/<pid>/stat), or undefined if no
 * such process. With the PID it names one process: a PID alone may have been reused since.
 */
function startOf(pid: number): string | undefined {
  let stat: string;
  try { stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { return undefined; }
  // The command name, field 2, is in parentheses and may hold spaces; count from after it.
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
}

/**
 * Holds `workId` for this process until the returned function is called; throws Locked while a
 * live process holds it, this one included. A lock left by a process that died, or whose PID now
 * names another process, is taken over. The check and the take share SQLite's write lock, so two
 * processes cannot both take a stale lock: a lock file renamed or unlinked over a stale one can.
 */
export function holdWork(runsDir: string | undefined, workId: string): () => void {
  const path = lockFile(runsDir);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const me = { pid: process.pid, start: startOf(process.pid)! };
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('CREATE TABLE IF NOT EXISTS locks (work_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, start TEXT NOT NULL)');
    db.exec('BEGIN IMMEDIATE');
    try {
      const held = db.prepare('SELECT pid, start FROM locks WHERE work_id = ?').get(workId) as { pid: number; start: string } | undefined;
      if (held && startOf(held.pid) === held.start) throw new Locked(workId, held.pid);
      db.prepare('INSERT OR REPLACE INTO locks (work_id, pid, start) VALUES (?, ?, ?)').run(workId, me.pid, me.start);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    db.close();
  }
  return () => {
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      // Only this holder's row: a lock taken over after this process was judged gone is another's.
      db.prepare('DELETE FROM locks WHERE work_id = ? AND pid = ? AND start = ?').run(workId, me.pid, me.start);
    } finally {
      db.close();
    }
  };
}

// How often a waiting owner command asks again: a held work frees when its driver returns.
const WAIT_POLL_MS = 100;

/**
 * holdWork, retried until `waitMs` has passed, then Locked. For an owner command: like the store's
 * busy timeout, it waits out a driver about to finish, so two overlapping deliveries still meet
 * the store's own answer (StaleLoad, or "already recorded" for one command ID) rather than this lock.
 */
export async function waitForWork(runsDir: string | undefined, workId: string, waitMs: number): Promise<() => void> {
  for (const end = Date.now() + waitMs; ; await new Promise((res) => setTimeout(res, WAIT_POLL_MS))) {
    try {
      return holdWork(runsDir, workId);
    } catch (err) {
      if (!(err instanceof Locked) || Date.now() >= end) throw err;
    }
  }
}
