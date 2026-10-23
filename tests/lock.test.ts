// Ticket 11-f: one process at a time drives or recovers a work (A-105 item 3). A lock whose holder
// died, or whose PID now names another process, is taken over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockFile } from '../src/layout.ts';
import { holdWork, Locked, waitForWork } from '../src/lock.ts';
import { holder, kill } from './lock-holder.ts';

const dir = mkdtempSync(join(tmpdir(), 'sf-lock-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const fresh = () => join(dir, String(n++));

test('a work held by a live process is refused with its PID; another work is free; once the holder dies the lock is taken over', async () => {
  const runsDir = fresh();
  const child = await holder(runsDir, 'w1');
  try {
    assert.throws(() => holdWork(runsDir, 'w1'), (err) => err instanceof Locked && err.pid === child.pid && /w1 .* process \d+/.test(err.message));
    holdWork(runsDir, 'w2')();
  } finally {
    await kill(child);
  }
  const release = holdWork(runsDir, 'w1');
  release();
});

test('released, a work can be held again; one process cannot hold a work twice', () => {
  const runsDir = fresh();
  const release = holdWork(runsDir, 'w1');
  assert.throws(() => holdWork(runsDir, 'w1'), (err) => err instanceof Locked && err.pid === process.pid);
  release();
  holdWork(runsDir, 'w1')();
});

test('a lock whose PID is alive but started at another time (a reused PID) is taken over', () => {
  const runsDir = fresh();
  holdWork(runsDir, 'w0')();
  const db = new DatabaseSync(lockFile(runsDir));
  db.prepare('INSERT INTO locks (work_id, pid, start) VALUES (?, ?, ?)').run('w1', process.pid, '1');
  db.close();
  holdWork(runsDir, 'w1')();
});

test('a release after the lock was taken over leaves the new holder\'s lock in place', async () => {
  const runsDir = fresh();
  const stale = holdWork(runsDir, 'w1');
  // As if this process had died and its PID come back: the row now names another start.
  const db = new DatabaseSync(lockFile(runsDir));
  db.prepare('UPDATE locks SET start = ? WHERE work_id = ?').run('1', 'w1');
  db.close();
  const child = await holder(runsDir, 'w1');
  try {
    stale();
    assert.throws(() => holdWork(runsDir, 'w1'), (err) => err instanceof Locked && err.pid === child.pid);
  } finally {
    await kill(child);
  }
});

test('waitForWork takes a work once its holder dies within the wait, and refuses one still held when the wait ends', async () => {
  const runsDir = fresh();
  const child = await holder(runsDir, 'w1');
  try {
    await assert.rejects(waitForWork(runsDir, 'w1', 200), (err) => err instanceof Locked && err.pid === child.pid);
    setTimeout(() => void kill(child), 300);
    const release = await waitForWork(runsDir, 'w1', 5000);
    release();
  } finally {
    await kill(child);
  }
});
