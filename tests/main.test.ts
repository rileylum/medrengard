// Ticket 07-d: the owner's accept and cancel commands in main.ts. Offline: the store is seeded,
// or stub CLIs play every role, so no test here makes a paid call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Event } from '../src/lifecycle.ts';
import { EventStore } from '../src/store.ts';
import { reviewerStub } from './stub-cli.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-main-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const MAIN = join(import.meta.dirname, '..', 'src', 'main.ts');
const H = 'a'.repeat(40);
const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...a], { cwd, encoding: 'utf8' }).trim();

let n = 0;
/** A scratch repository, a runs directory and a job file for work `w`. */
function scratch() {
  const root = join(dir, String(n++));
  const repo = join(root, 'repo');
  const runsDir = join(root, 'runs');
  mkdirSync(repo, { recursive: true });
  mkdirSync(runsDir);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'initial');
  const jobFile = join(root, 'job.json');
  writeFileSync(jobFile, JSON.stringify({ workId: 'w', ticket: 'x', repo, runsDir, checks: [{ name: 'ok', command: ['true'] }], runtime: { developer: 'claude', standard: 'claude', adversarial: 'claude' } }));
  return { root, repo, runsDir, jobFile, db: join(runsDir, 'events.sqlite') };
}
const sf = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8', timeout: 60_000, env });

const TO_ACCEPTANCE: Event[] = [
  { type: 'claim', runId: 'dev1', base: 'b'.repeat(40), runtime: 'fake' },
  { type: 'developer_result', runId: 'dev1', head: H, artifacts: ['x'] },
  { type: 'verification', head: H, checks: [{ name: 'ok', result: 'PASS' }] },
  { type: 'verdict', runId: 'std1', head: H, verdict: 'PASS', findings: [] },
  { type: 'verdict', runId: 'adv1', head: H, verdict: 'PASS', findings: [] },
];
const ESCALATE: Event[] = [
  { type: 'claim', runId: 'dev1', base: 'b'.repeat(40), runtime: 'fake' },
  { type: 'run_failed', runId: 'dev1', reason: 'timeout' },
];
function seed(db: string, cycleId: string, events: Event[], parent?: string) {
  const store = new EventStore(db);
  store.open(cycleId, 'w', parent);
  for (const e of events) store.append(cycleId, e);
  store.close();
}
function look(db: string, cycleId: string) {
  const store = new EventStore(db);
  try { return { stage: store.load(cycleId)!.stage, events: store.events(cycleId).length }; } finally { store.close(); }
}

test('main.ts end to end: accept frees the work ID, cancel frees it again, merge lines name the SHA (07-d)', () => {
  const { root, jobFile } = scratch();
  const bin = join(root, 'bin');
  mkdirSync(bin);
  // No role matches the target, so the stub claude commits as the developer and passes as both reviewers.
  reviewerStub(bin, 'claude', 'nobody', join(root, 'outside'));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };

  const first = sf([jobFile], env);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /^Stage: AWAITING_ACCEPTANCE$/m);
  const head = /^Head: ([0-9a-f]{40})$/m.exec(first.stdout)![1]!;
  const cycle1 = /^Cycle: (\S+)$/m.exec(first.stdout)![1]!;
  assert.ok(first.stdout.includes(`node ${MAIN} accept ${jobFile} ${head}`), first.stdout);
  assert.match(first.stdout, new RegExp(`merge --no-ff ${head}$`, 'm'));
  assert.doesNotMatch(first.stdout, /merge --no-ff sf\//);

  // Before 07-d this was the dead end: the finished cycle holds the work ID.
  const blocked = sf([jobFile], env);
  assert.equal(blocked.status, 2, blocked.stdout + blocked.stderr);
  assert.match(blocked.stderr, new RegExp(`already has an open cycle ${cycle1}`));

  const accepted = sf(['accept', jobFile, head]);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(accepted.stdout, new RegExp(`^Cycle: ${cycle1}$`, 'm'));
  assert.match(accepted.stdout, /^Stage: ACCEPTED$/m);
  assert.match(accepted.stdout, new RegExp(`merge --no-ff ${head}$`, 'm'));

  const second = sf([jobFile], env);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const cycle2 = /^Cycle: (\S+)$/m.exec(second.stdout)![1]!;
  assert.notEqual(cycle2, cycle1);

  const cancelled = sf(['cancel', jobFile]);
  assert.equal(cancelled.status, 0, cancelled.stdout + cancelled.stderr);
  assert.match(cancelled.stdout, new RegExp(`^Cycle: ${cycle2}$`, 'm'));
  assert.match(cancelled.stdout, /^Stage: CANCELLED$/m);

  const third = sf([jobFile], env);
  assert.equal(third.status, 0, third.stdout + third.stderr);
  assert.notEqual(/^Cycle: (\S+)$/m.exec(third.stdout)![1]!, cycle2);
});

test('accept writes nothing and exits 2 unless the open cycle awaits acceptance of exactly that SHA (07-d)', () => {
  const { jobFile, db } = scratch();
  const refused = (args: string[], why: RegExp) => {
    const r = sf(args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, '', args.join(' '));
    assert.match(r.stderr, why, args.join(' '));
  };
  refused(['accept', jobFile, H], /no open cycle/);

  // An ESCALATED cycle is not open: accept does not reach it.
  seed(db, 'c0', ESCALATE);
  refused(['accept', jobFile, H], /no open cycle/);
  assert.deepEqual(look(db, 'c0'), { stage: 'ESCALATED', events: 2 });

  // Before acceptance: apply would escalate an accept here, so the command must not send one.
  seed(db, 'c1', TO_ACCEPTANCE.slice(0, 3), 'c0');
  refused(['accept', jobFile, H], /c1 is STANDARD_REVIEW, not AWAITING_ACCEPTANCE/);
  assert.deepEqual(look(db, 'c1'), { stage: 'STANDARD_REVIEW', events: 3 });

  const store = new EventStore(db);
  for (const e of TO_ACCEPTANCE.slice(3)) store.append('c1', e);
  store.close();
  refused(['accept', jobFile, 'c'.repeat(40)], new RegExp(`not the candidate head ${H}`));
  refused(['accept', jobFile, H.slice(0, 7)], new RegExp(`not the candidate head ${H}`));
  refused(['accept', jobFile], /usage/);
  refused(['accept', jobFile, H, 'extra'], /usage/);
  assert.deepEqual(look(db, 'c1'), { stage: 'AWAITING_ACCEPTANCE', events: 5 });

  const ok = sf(['accept', jobFile, H]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.deepEqual(look(db, 'c1'), { stage: 'ACCEPTED', events: 6 });
  refused(['accept', jobFile, H], /no open cycle/);
});

test('cancel takes the open cycle, else every ESCALATED cycle of the work, else refuses (07-d)', () => {
  const { jobFile, db } = scratch();
  const none = sf(['cancel', jobFile]);
  assert.equal(none.status, 2, none.stdout + none.stderr);
  assert.equal(none.stdout, '');
  assert.match(none.stderr, /nothing to cancel/);

  // A parent and its child, both ESCALATED: the store would ask a new cycle to name one of them.
  seed(db, 'c1', ESCALATE);
  seed(db, 'c2', ESCALATE, 'c1');
  const both = sf(['cancel', jobFile]);
  assert.equal(both.status, 0, both.stdout + both.stderr);
  assert.match(both.stdout, /^Cycle: c1$/m);
  assert.match(both.stdout, /^Cycle: c2$/m);
  assert.equal(look(db, 'c1').stage, 'CANCELLED');
  assert.equal(look(db, 'c2').stage, 'CANCELLED');

  // The work starts fresh: no parent needed. An open cycle is the only one cancelled.
  seed(db, 'c3', ESCALATE.slice(0, 1));
  const store = new EventStore(db);
  store.open('other', 'w2');
  store.close();
  const open = sf(['cancel', jobFile]);
  assert.equal(open.status, 0, open.stdout + open.stderr);
  assert.match(open.stdout, /^Cycle: c3$/m);
  assert.doesNotMatch(open.stdout, /^Cycle: c[12]$/m);
  assert.deepEqual(look(db, 'c3'), { stage: 'CANCELLED', events: 2 });
  assert.equal(look(db, 'other').stage, 'QUEUED');

  const usage = sf(['cancel', jobFile, 'extra']);
  assert.equal(usage.status, 2, usage.stdout + usage.stderr);
  assert.match(usage.stderr, /usage/);
});

test('cancel from a second process waits for another connection\'s write lock (07-d, parked 02-a busy timeout)', async () => {
  const { jobFile, db } = scratch();
  seed(db, 'c1', ESCALATE.slice(0, 1));
  const holder = new DatabaseSync(db);
  holder.exec('BEGIN IMMEDIATE');
  const child = spawn(process.execPath, [MAIN, 'cancel', jobFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  // Listen now: a child that fails at once closes before the lock is released.
  const closed = new Promise((r) => child.on('close', r));
  // Hold the lock long enough that a zero busy timeout fails at once.
  await new Promise((r) => setTimeout(r, 1000));
  holder.exec('COMMIT');
  holder.close();
  const code = await closed;
  assert.equal(code, 0, out);
  assert.match(out, /^Stage: CANCELLED$/m);
});
