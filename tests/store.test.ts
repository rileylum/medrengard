// Ticket 02-a: a cycle's state survives a process restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { apply, newCycle, type Cycle, type Event } from '../src/lifecycle.ts';
import { EventStore } from '../src/store.ts';
import { scenarios } from './scenarios.ts';

const dir = mkdtempSync(join(tmpdir(), 'sf-store-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const dbPath = (name: string) => join(dir, `${name}.sqlite`);

const stage = (c: Cycle) => [c.stage, c.standard, c.adversarial];
// Everything but history: the store drops redelivered events at the door, while apply records
// them as "ignored", so the two histories differ by exactly those entries. Stage and counters are
// what the ticket requires to match.
const state = ({ history: _, ...rest }: Cycle) => rest;

test('events append to one SQLite table keyed by cycle', () => {
  const path = dbPath('append');
  const a = new EventStore(path);
  a.open('c1', 'w1');
  a.open('c2', 'w2');
  a.append('c1', { type: 'claim', runId: 'dev1', base: 'B1' });
  a.append('c2', { type: 'reject_dispatch', reason: 'nope' });
  a.append('c1', { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] });
  a.close();

  const b = new EventStore(path);
  assert.deepEqual(b.events('c1').map((e) => e.type), ['claim', 'developer_result']);
  assert.deepEqual(b.events('c2').map((e) => e.type), ['reject_dispatch']);
  assert.deepEqual(b.events('missing'), []);
  assert.equal(b.load('missing'), undefined);
  assert.throws(() => b.append('missing', { type: 'cancel' }), /not open/);
  b.close();
});

test('opening a cycle twice throws and leaves its log intact', () => {
  const store = new EventStore(dbPath('reopen'));
  store.open('c1', 'w1');
  store.append('c1', { type: 'claim', runId: 'dev1', base: 'B1' });
  assert.throws(() => store.open('c1', 'w1'), /already open/);
  assert.equal(store.events('c1').length, 1);
  assert.deepEqual(stage(store.load('c1')!), ['DEVELOPING', 0, 0]);
  store.close();
});

test('loading a cycle replays every SC scenario (minus the five todo ones) to the same state as the in-memory run', () => {
  const store = new EventStore(dbPath('replay'));
  for (const s of scenarios) {
    const expected = s.events.reduce(apply, newCycle(s.name, 'w1'));
    assert.equal(expected.stage, s.stage, `${s.name} scenario data matches lifecycle tests`);
    store.open(s.name, 'w1');
    for (const e of s.events) store.append(s.name, e);
    assert.deepEqual(state(store.load(s.name)!), state(expected), s.name);
  }
  store.close();
  const reopened = new EventStore(dbPath('replay'));
  for (const s of scenarios) assert.deepEqual(state(reopened.load(s.name)!), state(s.events.reduce(apply, newCycle(s.name, 'w1'))), s.name);
  const child = reopened.open('child', 'w1', 'SC-04');
  assert.equal(child.parentCycleId, 'SC-04');
  assert.deepEqual(reopened.load('child'), child);
  reopened.close();
});

test('a process killed between two events reopens and continues from the last committed event', async () => {
  const path = dbPath('killed');
  const child = spawn(process.execPath, [join(import.meta.dirname, 'fixtures', 'writer.ts'), path], { stdio: ['ignore', 'pipe', 'inherit'] });
  const written = await new Promise<number>((resolve) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      // The writer prints one line per committed event; after the second one it would write a third, so kill it first.
      if (out.includes('2\n')) {
        child.kill('SIGKILL');
        resolve(2);
      }
    });
  });
  await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(written, 2);

  const store = new EventStore(path);
  assert.equal(store.events('c1').length, 2);
  assert.deepEqual(stage(store.load('c1')!), ['VERIFYING', 0, 0]);
  store.append('c1', { type: 'verification', head: 'H1', checks: [{ name: 'tests', result: 'PASS' }] });
  assert.deepEqual(stage(store.load('c1')!), ['STANDARD_REVIEW', 0, 0]);
  store.close();
});

test('a duplicate event with the same run ID written twice changes nothing', () => {
  const store = new EventStore(dbPath('dup'));
  store.open('c1', 'w1');
  const events: Event[] = [
    { type: 'claim', runId: 'dev1', base: 'B1' },
    { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] },
    { type: 'verification', head: 'H1', checks: [{ name: 'tests', result: 'PASS' }] },
    { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' },
  ];
  for (const e of events) assert.equal(store.append('c1', e), true);
  const before = store.load('c1');
  assert.equal(store.append('c1', { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' }), false);
  assert.equal(store.append('c1', { type: 'developer_result', runId: 'dev1', head: 'H2', artifacts: ['r'] }), false);
  assert.deepEqual(store.load('c1'), before);
  assert.equal(store.events('c1').length, events.length);
  store.close();
});
