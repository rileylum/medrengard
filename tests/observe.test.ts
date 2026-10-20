// Ticket 10-d: `observe` follows a job's stream and acts through the real owner's commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { observe, type Observer } from '../src/kits/observe.ts';
import { EventStore } from '../src/store.ts';
import { commentOnly } from './fixtures/comment-observer.ts';
import { base, comment, repo, toAcceptance } from './kits/observe-shared.ts';

const dir = mkdtempSync('/var/tmp/software_factory/sf-observe-');
test.after(() => rmSync(dir, { recursive: true, force: true }));
process.env.XDG_CONFIG_HOME = join(dir, 'xdg');

function job(workId: string) {
  const root = mkdtempSync(join(dir, 'job-'));
  const runsDir = join(root, 'runs');
  mkdirSync(runsDir);
  const jobFile = join(root, 'job.json');
  writeFileSync(jobFile, JSON.stringify({ workId, ticket: 'x', repo, base, runsDir, checks: [] }));
  return { jobFile, db: join(runsDir, 'events.sqlite') };
}
const settle = async (until: () => boolean) => {
  for (let i = 0; i < 100 && !until(); i++) await new Promise((r) => setTimeout(r, 100));
};

test('observe runs a real accept for the comment-only example, recorded with the observer\'s source', async () => {
  const j = job('w');
  const store = new EventStore(j.db);
  store.open('c1', 'w', undefined, base);
  for (const e of toAcceptance(comment)) store.append('c1', e);
  store.close();
  const stage = () => { const s = new EventStore(j.db); try { return s.load('c1')!.stage; } finally { s.close(); } };
  const ac = new AbortController();
  const running = observe(j.jobFile, 'observer:comments', commentOnly(repo), { signal: ac.signal });
  await settle(() => stage() === 'ACCEPTED');
  ac.abort();
  await running;
  const s = new EventStore(j.db);
  assert.equal(s.load('c1')!.stage, 'ACCEPTED');
  assert.deepEqual(s.events('c1').at(-1), { type: 'accept', head: comment, source: 'observer:comments' });
  s.close();
  assert.equal(execFileSync('git', ['-C', repo, 'rev-parse', comment], { encoding: 'utf8' }).trim(), comment);
});

test('observe waits for a store that does not exist yet, hands lines over in order from after, and rejects when the observer throws', async () => {
  const j = job('w');
  const seen: number[] = [];
  const observer: Observer = (line) => {
    seen.push(line.seq);
    if ((line.event as { type: string }).type === 'verification') throw new Error('stop here');
  };
  const running = observe(j.jobFile, 'observer:test', observer, { after: 2 });
  await new Promise((r) => setTimeout(r, 700));
  const store = new EventStore(j.db);
  store.open('c1', 'w', undefined, base);
  for (const e of toAcceptance(comment)) store.append('c1', e);
  store.close();
  await assert.rejects(running, /stop here/);
  // pos 1 is the open marker and 2 the claim; the verification at 4 stops it.
  assert.deepEqual(seen, [3, 4]);
});

test('observe stops when the signal aborts, with no store', async () => {
  const j = job('w');
  const ac = new AbortController();
  const running = observe(j.jobFile, 'observer:test', () => {}, { signal: ac.signal });
  setTimeout(() => ac.abort(), 300);
  await running;
});
