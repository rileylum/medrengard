// Ticket 11-c (A-136): a store reads a cycle opened under another workflow, but every function
// that acts on a cycle reads its stage table from the store's own workflow, so each refuses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Adapter } from '../src/adapter.ts';
import { receive } from '../src/controller.ts';
import { acceptEvent } from '../src/decide.ts';
import { fix, type Job } from '../src/developer.ts';
import { review } from '../src/review.ts';
import { decideAndDrive, drive } from '../src/run.ts';
import { EventStore } from '../src/store.ts';
import { verify } from '../src/verify.ts';
import { ownerCheck } from './workflows.ts';

const dir = mkdtempSync(join(tmpdir(), 'sf-drivable-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const MISMATCH = /cycle c1 was opened under workflow owner-check \([0-9a-f]{12}\), this store runs default/;

test('every function that acts on a cycle refuses one opened under another workflow, before starting a run', async () => {
  const path = join(dir, 'events.sqlite');
  const opened = new EventStore(path, ownerCheck);
  opened.open('c1', 'w1');
  opened.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
  opened.append('c1', { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] });
  opened.close();

  const store = new EventStore(path);
  assert.equal(store.load('c1')!.stage, 'CHECK');
  let started = 0;
  const adapter: Adapter = { async start() { started++; return { status: 'failed', reason: 'never' }; } };
  const job: Job = { workId: 'w1', ticket: 't', repo: dir };
  const opts = { deadlineMs: 5_000, runsDir: dir, isolation: 'process-group' as const, sandbox: { backend: 'none' as const } };
  const calls: [string, () => unknown][] = [
    ['drive', () => drive(store, 'c1', { developer: adapter }, job, opts)],
    ['decideAndDrive', () => decideAndDrive(store, 'c1', { type: 'cancel' }, async () => { throw new Error('ready called'); })],
    ['verify', () => verify(store, 'c1', job, opts)],
    ['review', () => review(store, adapter, 'c1', job, opts)],
    ['fix', () => fix(store, adapter, 'c1', job, opts)],
    ['receive', () => receive(store, 'c1', 'r1', 'reviewer', { status: 'completed', verdict: { head: 'H1', verdict: 'PASS' } })],
    ['acceptEvent', () => acceptEvent(store, 'w1', 'H1', 'owner', { runsDir: dir, file: 'job.json' })],
  ];
  for (const [name, call] of calls) await assert.rejects(async () => call(), MISMATCH, name);
  assert.equal(started, 0);
  // Nothing was written: decideAndDrive's cancel would otherwise settle the cycle.
  assert.equal(store.load('c1')!.stage, 'CHECK');
  store.close();
});
