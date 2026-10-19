// Ticket 07-d: the owner's accept and cancel commands in main.ts. Offline: the store is seeded,
// or stub CLIs play every role, so no test here makes a paid call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Event } from '../src/lifecycle.ts';
import { EventStore } from '../src/store.ts';
import { reviewerStub } from './stub-cli.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-main-');
test.after(() => rmSync(dir, { recursive: true, force: true }));
// Every child inherits it: the owner's personal config (10-b) must never reach a test.
process.env.XDG_CONFIG_HOME = join(dir, 'xdg');

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

test('the run command refuses arguments after the job file and writes nothing (07-d adversarial minor)', () => {
  const { root, jobFile, db } = scratch();
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const called = join(root, 'called');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch ${called}\nexit 1\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  for (const args of [[jobFile, 'cancel'], [jobFile, 'accept', H]]) {
    const r = sf(args, env);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /usage/);
  }
  assert.ok(!existsSync(db), 'no store was made');
  assert.ok(!existsSync(called), 'no runtime CLI was spawned');
});

test('a job naming a parent that is no longer ESCALATED is refused before any run, saying to remove the field (07-d adversarial minor)', () => {
  const { root, repo, runsDir, jobFile, db } = scratch();
  seed(db, 'c1', ESCALATE);
  seed(db, 'c2', ESCALATE, 'c1');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const called = join(root, 'called');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch ${called}\nexit 1\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const child = join(root, 'child.json');
  writeFileSync(child, JSON.stringify({ workId: 'w', ticket: 'x', repo, runsDir, parentCycleId: 'c1', checks: [], runtime: { developer: 'claude', standard: 'claude', adversarial: 'claude' } }));
  assert.equal(sf(['cancel', jobFile]).status, 0);
  const r = sf([child], env);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /parentCycleId c1 is CANCELLED, not ESCALATED; remove parentCycleId from .*child\.json/);
  assert.ok(!existsSync(called), 'no runtime CLI was spawned');
  const store = new EventStore(db);
  assert.deepEqual(store.cycles('w').map((c) => c.stage), ['CANCELLED', 'CANCELLED']);
  store.close();
});

// Ticket 09-b: the job file names a workflow module; runtimes are keyed by role.
const WORKFLOWS = join(import.meta.dirname, 'workflows.ts');
/** scratch(), with the job file naming a workflow module written next to it, and a stub claude. */
function withWorkflow(moduleSource: string, runtime: Record<string, string>) {
  const s = scratch();
  writeFileSync(join(s.root, 'flow.ts'), moduleSource);
  writeFileSync(s.jobFile, JSON.stringify({ workId: 'w', ticket: 'x', repo: s.repo, runsDir: s.runsDir, checks: [{ name: 'ok', command: ['true'] }], runtime, workflow: 'flow.ts' }));
  const bin = join(s.root, 'bin');
  mkdirSync(bin);
  return { ...s, bin, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}
/** A claude that only records that it was spawned. */
function spawnMarker(bin: string, root: string) {
  const marker = join(root, 'spawned');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch ${marker}\nexit 1\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  return marker;
}

test('main.ts runs the workflow the job file names to its human stage, and accept settles it', () => {
  const { root, bin, env, jobFile } = withWorkflow(`export { ownerCheck as workflow } from ${JSON.stringify(WORKFLOWS)};\n`, { writer: 'claude', reviewer: 'claude' });
  reviewerStub(bin, 'claude', 'nobody', join(root, 'outside'));
  const first = sf([jobFile], env);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /^Stage: OWNER$/m);
  assert.match(first.stdout, /^reviewer [0-9a-f]{7}: PASS$/m);
  const head = /^Head: ([0-9a-f]{40})$/m.exec(first.stdout)![1]!;
  assert.ok(first.stdout.includes(`node ${MAIN} accept ${jobFile} ${head}`), first.stdout);
  const accepted = sf(['accept', jobFile, head], env);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(accepted.stdout, /^Stage: ACCEPTED$/m);
});

// Ticket 10-c: the job's workflow folder reaches verify, so a file argument beside flow.ts runs.
test('main.ts runs a command stage file argument from beside the job file\'s workflow', () => {
  const { root, bin, env, jobFile, runsDir } = withWorkflow(`import { ownerCheck } from ${JSON.stringify(WORKFLOWS)};
export const workflow = { ...ownerCheck, stages: { ...ownerCheck.stages, CHECK: { ...ownerCheck.stages.CHECK, run: [{ name: 'lint', command: ['sh', { file: 'lint.sh' }] }] } } };\n`, { writer: 'claude', reviewer: 'claude' });
  writeFileSync(join(root, 'lint.sh'), 'echo linted\n');
  reviewerStub(bin, 'claude', 'nobody', join(root, 'outside'));
  const r = sf([jobFile], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: OWNER$/m);
  const head = /^Head: ([0-9a-f]{40})$/m.exec(r.stdout)![1]!;
  assert.equal(readFileSync(join(runsDir, 'evidence', head, 'CHECK', 'lint.stdout'), 'utf8'), 'linted\n');
});

test('main.ts refuses a workflow checkWorkflow refuses, before any run and before the store exists', () => {
  const { root, bin, env, jobFile, db } = withWorkflow(`import { ownerCheck } from ${JSON.stringify(WORKFLOWS)};\nexport const workflow = { ...ownerCheck, start: 'NOWHERE' };\n`, { writer: 'claude', reviewer: 'claude' });
  const marker = spawnMarker(bin, root);
  const r = sf([jobFile], env);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /workflow refused.*NOWHERE/);
  assert.ok(!existsSync(marker), 'no runtime CLI was spawned');
  assert.ok(!existsSync(db), 'no store was created');
});

test('main.ts refuses a workflow module with no workflow export', () => {
  const { root, bin, env, jobFile } = withWorkflow('export const flow = {};\n', { writer: 'claude', reviewer: 'claude' });
  const marker = spawnMarker(bin, root);
  const r = sf([jobFile], env);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /flow\.ts has no named export workflow/);
  assert.ok(!existsSync(marker));
});

test('main.ts refuses a job with no runtime for one of the workflow\'s roles, before any run', () => {
  const { root, bin, env, jobFile } = withWorkflow(`export { ownerCheck as workflow } from ${JSON.stringify(WORKFLOWS)};\n`, { writer: 'claude' });
  const marker = spawnMarker(bin, root);
  const r = sf([jobFile], env);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /runtime\.reviewer/);
  assert.ok(!existsSync(marker));
});

// Ticket 10-a: a runtime the job file adds, as a module relative to the job file.
test('a job naming an extension runtime runs from open to AWAITING_ACCEPTANCE, and every outcome event records it and its module hash', () => {
  const { root, jobFile, db } = scratch();
  // Beside the job file and named plainly: a path climbing past / resolves the same from any folder (10-b standard 1).
  const ext = join(root, 'ext-runtime.ts');
  copyFileSync(join(import.meta.dirname, 'fixtures', 'ext-runtime.ts'), ext);
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...job, runtimes: { ext: { module: 'ext-runtime.ts' } }, runtime: { developer: 'ext', standard: 'ext', adversarial: 'ext' } }));
  const r = sf([jobFile]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: AWAITING_ACCEPTANCE$/m);
  const cycleId = /^Cycle: (\S+)$/m.exec(r.stdout)![1]!;
  const store = new EventStore(db);
  try {
    const hash = createHash('sha256').update(readFileSync(ext)).digest('hex');
    const outcomes = store.events(cycleId).filter((e) => ['developer_result', 'verdict', 'dispute', 'run_failed'].includes(e.type)) as Record<string, unknown>[];
    assert.deepEqual(outcomes.map((e) => [e.type, e.runtime, e.moduleHash]), [
      ['developer_result', 'ext', hash],
      ['verdict', 'ext', hash],
      ['verdict', 'ext', hash],
    ]);
  } finally {
    store.close();
  }
});

// Ticket 10-b: a runtime the personal file adds resolves against the personal file, not the job file.
test('a personal-layer extension runtime, relative to the personal file, runs a job to AWAITING_ACCEPTANCE', () => {
  const { root, jobFile } = scratch();
  const xdg = join(root, 'xdg');
  const own = join(xdg, 'software_factory');
  mkdirSync(own, { recursive: true });
  // Beside the personal file only: a path climbing past / would resolve the same from anywhere.
  copyFileSync(join(import.meta.dirname, 'fixtures', 'ext-runtime.ts'), join(own, 'ext.ts'));
  writeFileSync(join(own, 'config.json'), JSON.stringify({ runtimes: { ext: { module: 'ext.ts' } } }));
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...job, runtime: { developer: 'ext', standard: 'ext', adversarial: 'ext' } }));
  const r = sf([jobFile], { ...process.env, XDG_CONFIG_HOME: xdg });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: AWAITING_ACCEPTANCE$/m);
});

// Ticket 10-b (A-078 Q4): accept reads the layers at the base the cycle opened at, not where the ref is now.
test('accept loads a cycle run under a repository workflow after the base branch has moved and changed that workflow', () => {
  const { root, repo, jobFile } = scratch();
  const flow = (name: string) => `import { ownerCheck } from ${JSON.stringify(WORKFLOWS)};\nexport const workflow = { ...ownerCheck, name: ${JSON.stringify(name)} };\n`;
  mkdirSync(join(repo, '.factory'));
  writeFileSync(join(repo, '.factory', 'config.json'), JSON.stringify({ workflow: 'flow.ts' }));
  writeFileSync(join(repo, 'flow.ts'), flow('v1'));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'factory workflow');
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...job, runtime: { writer: 'claude', reviewer: 'claude' } }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  reviewerStub(bin, 'claude', 'nobody', join(root, 'outside'));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const first = sf([jobFile], env);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /^Stage: OWNER$/m);
  const head = /^Head: ([0-9a-f]{40})$/m.exec(first.stdout)![1]!;
  writeFileSync(join(repo, 'flow.ts'), flow('v2'));
  git(repo, 'commit', '-q', '-am', 'workflow v2');
  const accepted = sf(['accept', jobFile, head], env);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(accepted.stdout, /^Stage: ACCEPTED$/m);
  // cancel loads the same way: it gets as far as finding nothing open, not a workflow refusal.
  const cancelled = sf(['cancel', jobFile], env);
  assert.equal(cancelled.status, 2);
  assert.match(cancelled.stderr, /^nothing to cancel for work w /m);
});

test('a repository layer that gives grants or turns the sandbox off stops main.ts with exit 2 before any run and before the store exists', () => {
  for (const [layer, message] of [
    [{ grants: { github: { env: 'GITHUB_TOKEN' } } }, /\.factory\/config\.json at [0-9a-f]{40}: grants come only from the personal or job layer/],
    [{ sandbox: { backend: 'none' } }, /\.factory\/config\.json at [0-9a-f]{40}: sandbox is set only by the personal or job layer/],
  ] as const) {
    const { root, repo, jobFile, db } = scratch();
    mkdirSync(join(repo, '.factory'));
    writeFileSync(join(repo, '.factory', 'config.json'), JSON.stringify(layer));
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'refused layer');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const marker = spawnMarker(bin, root);
    const r = sf([jobFile], { ...process.env, PATH: `${bin}:${process.env.PATH}` });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, message);
    assert.ok(!existsSync(marker), 'no runtime CLI was spawned');
    assert.ok(!existsSync(db), 'no store was created');
  }
});

test('cancel works at the cycle\'s own base when the configuration at the branch tip is refused or broken (10-b standard 1)', () => {
  for (const breakTip of [
    (repo: string) => writeFileSync(join(repo, '.factory', 'config.json'), JSON.stringify({ workflow: 'flow.ts', deadlineMs: 1 })),
    (repo: string) => rmSync(join(repo, 'flow.ts')),
  ]) {
    const { root, repo, jobFile } = scratch();
    mkdirSync(join(repo, '.factory'));
    writeFileSync(join(repo, '.factory', 'config.json'), JSON.stringify({ workflow: 'flow.ts' }));
    writeFileSync(join(repo, 'flow.ts'), `export { ownerCheck as workflow } from ${JSON.stringify(WORKFLOWS)};\n`);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'factory workflow');
    const job = JSON.parse(readFileSync(jobFile, 'utf8'));
    writeFileSync(jobFile, JSON.stringify({ ...job, runtime: { writer: 'claude', reviewer: 'claude' } }));
    const bin = join(root, 'bin');
    mkdirSync(bin);
    reviewerStub(bin, 'claude', 'nobody', join(root, 'outside'));
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const first = sf([jobFile], env);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    breakTip(repo);
    git(repo, 'commit', '-q', '-am', 'tip change');
    const cancelled = sf(['cancel', jobFile], env);
    assert.equal(cancelled.status, 0, cancelled.stdout + cancelled.stderr);
    assert.match(cancelled.stdout, /^Stage: CANCELLED$/m);
  }
});

test('the developer starts from the SHA the layers were read at, though the base ref moves after the read (10-b standard 1)', () => {
  const { root, repo, jobFile, db } = scratch();
  mkdirSync(join(repo, '.factory'));
  writeFileSync(join(repo, '.factory', 'config.json'), JSON.stringify({ workflow: 'flow.ts' }));
  // Imported by loadConfig after it has read the layers: a commit here moves main before develop runs.
  writeFileSync(join(repo, 'flow.ts'), [
    `import { execFileSync } from 'node:child_process';`,
    `execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'moved'], { cwd: ${JSON.stringify(repo)} });`,
    `export { ownerCheck as workflow } from ${JSON.stringify(WORKFLOWS)};`,
  ].join('\n'));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'factory workflow');
  const read = git(repo, 'rev-parse', 'HEAD');
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...job, runtime: { writer: 'claude', reviewer: 'claude' } }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  reviewerStub(bin, 'claude', 'nobody', join(root, 'outside'));
  const r = sf([jobFile], { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.notEqual(git(repo, 'rev-parse', 'HEAD'), read, 'the hook moved main');
  assert.match(r.stdout, new RegExp(`^Base: ${read}$`, 'm'));
  const store = new EventStore(db);
  try {
    const cycleId = /^Cycle: (\S+)$/m.exec(r.stdout)![1]!;
    assert.equal((store.events(cycleId).find((e) => e.type === 'claim') as { base: string }).base, read);
  } finally {
    store.close();
  }
});
