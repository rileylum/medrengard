// Ticket 07-d: the owner's accept and cancel commands in main.ts. Offline: the store is seeded,
// or stub CLIs play every role, so no test here makes a paid call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Event } from '../src/lifecycle.ts';
import { EventStore } from '../src/store.ts';
import { jobRecord } from '../src/developer.ts';
import { reviewerStub } from './stub-cli.ts';
import { runDir } from '../src/layout.ts';
import { holder, kill } from './lock-holder.ts';
import { develop } from '../src/developer.ts';
import { claude, cliAdapter } from '../src/runtime/cli-adapter.ts';

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

// sweep-terminal-escapes: `Error:` and the top-level stderr message print a thrown message, which can
// quote a name with control characters in it. Here the names come from a workflow module.
test('refusals on stderr show control characters only as visible escapes', () => {
  const missing = withWorkflow(`import { ownerCheck } from ${JSON.stringify(WORKFLOWS)};
export const workflow = { ...ownerCheck, stages: { ...ownerCheck.stages, CHECK: { ...ownerCheck.stages.CHECK, run: [{ name: 'lint', command: ['sh', { file: '\\u001b[2J\\u009b.sh' }] }] } } };\n`, { writer: 'claude', reviewer: 'claude' });
  reviewerStub(missing.bin, 'claude', 'nobody', join(missing.root, 'outside'));
  const r = sf([missing.jobFile], missing.env);
  // 11-a2 (A-132): preflight refuses the missing file before the developer run, so the message
  // reaches stderr, not the run's `Error:` line.
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^stage CHECK names file \\u\{1b\}\[2J\\u\{9b\}\.sh/m);
  assert.doesNotMatch(r.stdout + r.stderr, /[\u001b\u009b]/);
  const refused = withWorkflow(`import { ownerCheck } from ${JSON.stringify(WORKFLOWS)};\nexport const workflow = { ...ownerCheck, start: '\\u001b[2J' };\n`, { writer: 'claude', reviewer: 'claude' });
  const e = sf([refused.jobFile], refused.env);
  assert.equal(e.status, 2, e.stdout + e.stderr);
  assert.match(e.stderr, /^workflow refused.*\\u\{1b\}\[2J/m);
  assert.doesNotMatch(e.stdout + e.stderr, /\u001b/);
});

// Ticket 10-e: the job file's grants reach verify, so the grant stage holds the value.
test('main.ts gives a grant stage the grant the job file names', () => {
  const field = (k: string) => `$(sed -n 's/.*"${k}": "\\(.*\\)".*/\\1/p' "$SF_REQUEST")`;
  const script = `out=${field('outputDir')}; echo ${field('head')} > "$out/head"; printf %s "$GH_TOKEN" > "$out/token"`;
  const { root, bin, env, jobFile, runsDir, repo } = withWorkflow(`import { ownerCheck } from ${JSON.stringify(WORKFLOWS)};
export const workflow = { ...ownerCheck, stages: { ...ownerCheck.stages, REVIEW: { ...ownerCheck.stages.REVIEW, transitions: { PASS: 'MERGE', FAIL: 'ESCALATED' } },
  MERGE: { kind: 'command', run: [{ name: 'merge', command: ['sh', '-c', ${JSON.stringify(script)}] }], network: true, grants: ['github'], transitions: { PASS: 'OWNER' } } } };\n`, { writer: 'claude', reviewer: 'claude' });
  writeFileSync(join(root, 'gh-token'), 'main-grant-value\n');
  const spec = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...spec, repo, grants: { github: { variable: 'GH_TOKEN', file: 'gh-token' } } }));
  reviewerStub(bin, 'claude', 'nobody', join(root, 'outside'));
  const r = sf([jobFile], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: OWNER$/m);
  const head = /^Head: ([0-9a-f]{40})$/m.exec(r.stdout)![1]!;
  assert.equal(readFileSync(join(runsDir, 'evidence', head, 'MERGE', 'output', 'token'), 'utf8'), 'main-grant-value');
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

// sweep-terminal-escapes: findings, heads and reasons are agent text; a raw ESC or BEL would let an
// agent erase the owner's screen, print a fake stage or write the clipboard (OSC 52).
test('agent text with terminal escapes reaches stdout and stderr only as visible escapes', () => {
  for (const marker of ['EXT:esc-verdict', 'EXT:esc-head', 'EXT:esc-dispute']) {
    const { root, jobFile } = scratch();
    copyFileSync(join(import.meta.dirname, 'fixtures', 'ext-runtime.ts'), join(root, 'ext-runtime.ts'));
    const job = JSON.parse(readFileSync(jobFile, 'utf8'));
    writeFileSync(jobFile, JSON.stringify({ ...job, ticket: marker, runtimes: { ext: { module: 'ext-runtime.ts' } }, runtime: { developer: 'ext', standard: 'ext', adversarial: 'ext' } }));
    const r = sf([jobFile]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^Stage: ESCALATED$/m, marker);
    assert.doesNotMatch(r.stdout + r.stderr, /[\u0007\u001b\u009b\u202e]/, marker);
    // The one line break in the text is shown, not obeyed: no line of its own starts with "fake".
    assert.doesNotMatch(r.stdout, /^fake/m, marker);
    assert.match(r.stdout, /\\u\{1b\}\[2JStage: AWAITING_ACCEPTANCE\\u\{1b\}\]52;c;cm0gLXJmIH4=\\u\{7\}/, marker);
    assert.equal(r.stdout.match(/^Stage: /gm)?.length, 1, marker);
    if (marker === 'EXT:esc-verdict') assert.match(r.stdout, /^ {2}- \\u\{1b\}\[2J/m);
    // 10,000 characters of claimed head, in a claim or a dispute, are cut to 64 before the escalation names them.
    else assert.ok(r.stdout.length < 2_000, r.stdout);
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

// sweep-lazy-runtimes (A-075): a runtime's module is read when a role selects it, not when the config loads.
/** A personal config naming runtime `old`, whose module is missing. */
function brokenRuntime(root: string) {
  const xdg = join(root, 'xdg');
  mkdirSync(join(xdg, 'software_factory'), { recursive: true });
  writeFileSync(join(xdg, 'software_factory', 'config.json'), JSON.stringify({ runtimes: { old: { module: 'gone.ts' } } }));
  return { xdg, gone: join(xdg, 'software_factory', 'gone.ts') };
}

test('a personal runtime whose module is missing blocks neither a run nor cancel of a job that does not use it', () => {
  const { root, jobFile } = scratch();
  const { xdg } = brokenRuntime(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  reviewerStub(bin, 'claude', 'nobody', join(root, 'outside'));
  const env = { ...process.env, XDG_CONFIG_HOME: xdg, PATH: `${bin}:${process.env.PATH}` };
  const r = sf([jobFile], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: AWAITING_ACCEPTANCE$/m);
  const cancelled = sf(['cancel', jobFile], env);
  assert.equal(cancelled.status, 0, cancelled.stdout + cancelled.stderr);
  assert.match(cancelled.stdout, /^Stage: CANCELLED$/m);
});

test('a role whose runtime module is missing is refused before any cycle opens, naming runtimes.<name> and the path', () => {
  const { root, jobFile, db } = scratch();
  const { xdg, gone } = brokenRuntime(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const marker = spawnMarker(bin, root);
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...job, runtime: { developer: 'old', standard: 'claude', adversarial: 'claude' } }));
  const r = sf([jobFile], { ...process.env, XDG_CONFIG_HOME: xdg, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(`^runtimes\\.old: cannot read module ${gone}: ENOENT`, 'm'));
  assert.ok(!existsSync(marker), 'no runtime CLI was spawned');
  assert.ok(!existsSync(db), 'no store was created');
});

test('accept, cancel and events work when a role selects a runtime whose module is missing: they build no adapter', () => {
  const { root, jobFile, db } = scratch();
  const { xdg } = brokenRuntime(root);
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...job, runtime: { developer: 'old', standard: 'claude', adversarial: 'claude' } }));
  const env = { ...process.env, XDG_CONFIG_HOME: xdg };
  seed(db, 'c1', TO_ACCEPTANCE);
  const accepted = sf(['accept', jobFile, H], env);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(accepted.stdout, /^Stage: ACCEPTED$/m);
  seed(db, 'c2', ESCALATE);
  const cancelled = sf(['cancel', jobFile], env);
  assert.equal(cancelled.status, 0, cancelled.stdout + cancelled.stderr);
  assert.match(cancelled.stdout, /^Stage: CANCELLED$/m);
  const events = sf(['events', jobFile], env);
  assert.equal(events.status, 0, events.stdout + events.stderr);
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

// sweep-head-workflow (security finding 1): looking at a candidate with `git switch sf/<id>` must
// not let its workflow run as the owner on the next command.
test('cancel with a candidate branch checked out and no base in the job file refuses, and the candidate workflow never runs', () => {
  const { root, repo, jobFile, db } = scratch();
  const marker = join(root, 'PWNED');
  git(repo, 'switch', '-q', '-c', 'sf/0000-candidate');
  mkdirSync(join(repo, '.factory'));
  writeFileSync(join(repo, '.factory', 'config.json'), JSON.stringify({ workflow: 'flow.ts' }));
  writeFileSync(join(repo, 'flow.ts'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\nexport { ownerCheck as workflow } from ${JSON.stringify(WORKFLOWS)};\n`);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'candidate workflow');
  const r = sf(['cancel', jobFile]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^base [0-9a-f]{40} is on no branch or tag outside sf\/\*/m);
  assert.ok(!existsSync(marker), 'the candidate workflow did not run');
  assert.ok(!existsSync(db), 'no store was created');
});

// sweep-head-workflow review: a feature branch squash-merged and deleted leaves the cycle's base
// only on sf/<cycle>. The refusal names what to do; the tip's mismatched workflow would not.
test('cancel on a cycle whose base only its sf/* branch now holds uses a matching tip, else reports the ref refusal, not a workflow mismatch', () => {
  for (const tip of ['v1', 'v2']) {
    const { root, repo, jobFile } = scratch();
    const flow = (name: string) => `import { ownerCheck } from ${JSON.stringify(WORKFLOWS)};\nexport const workflow = { ...ownerCheck, name: ${JSON.stringify(name)} };\n`;
    git(repo, 'switch', '-q', '-c', 'feat');
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
    git(repo, 'switch', '-q', 'main');
    git(repo, 'merge', '-q', '--squash', 'feat');
    git(repo, 'commit', '-q', '-m', 'squash feat');
    git(repo, 'branch', '-q', '-D', 'feat');
    writeFileSync(join(repo, 'flow.ts'), flow(tip));
    git(repo, 'commit', '-q', '--allow-empty', '-am', `workflow ${tip}`);
    const cancelled = sf(['cancel', jobFile], env);
    if (tip === 'v1') {
      assert.equal(cancelled.status, 0, cancelled.stdout + cancelled.stderr);
      assert.match(cancelled.stdout, /^Stage: CANCELLED$/m);
    } else {
      assert.equal(cancelled.status, 2, cancelled.stdout + cancelled.stderr);
      assert.match(cancelled.stderr, /^base [0-9a-f]{40} is on no branch or tag outside sf\/\*/m);
    }
  }
});

// Ticket 11-a: main.ts runs only as a program, so code and tests can call main in-process.
test('importing main.ts runs nothing; main(argv) is exported and refuses bad arguments with usage', async () => {
  const { main } = await import('../src/main.ts');
  await new Promise((done) => setImmediate(done));
  assert.equal(process.exitCode, undefined);
  await assert.rejects(main([]), /^Error: usage: /);
  await assert.rejects(main(['accept', 'job.json']), /^Error: usage: /);
});

// Ticket 11-a2 (A-129, A-131): accept drives the cycle on, so a grant stage after the human stage
// runs in the same command, and a refusal writes nothing.
/** ownerCheck with a grant stage MERGE after OWNER, run by main.ts to OWNER. */
function atOwnerBeforeGrant(script: string, afterMerge = `'ACCEPTED'`, ownerFail = `'ESCALATED'`) {
  const s = withWorkflow(`import { ownerCheck } from ${JSON.stringify(WORKFLOWS)};
export const workflow = { ...ownerCheck, stages: { ...ownerCheck.stages, OWNER: { kind: 'human', transitions: { PASS: 'MERGE', FAIL: ${ownerFail} } },
  FINAL: { kind: 'human', transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
  MERGE: { kind: 'command', run: [{ name: 'merge', command: ['sh', '-c', ${JSON.stringify(script)}] }], network: true, grants: ['github'], transitions: { PASS: ${afterMerge}, FAIL: 'ESCALATED' } } } };\n`, { writer: 'claude', reviewer: 'claude' });
  writeFileSync(join(s.root, 'gh-token'), 'main-grant-value\n');
  const spec = JSON.parse(readFileSync(s.jobFile, 'utf8'));
  writeFileSync(s.jobFile, JSON.stringify({ ...spec, grants: { github: { variable: 'GH_TOKEN', file: 'gh-token' } } }));
  reviewerStub(s.bin, 'claude', 'nobody', join(s.root, 'outside'));
  const first = sf([s.jobFile], s.env);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /^Stage: OWNER$/m);
  const head = /^Head: ([0-9a-f]{40})$/m.exec(first.stdout)![1]!;
  const cycleId = /^Cycle: (\S+)$/m.exec(first.stdout)![1]!;
  return { ...s, head, cycleId };
}
const field = (k: string) => `$(sed -n 's/.*"${k}": "\\(.*\\)".*/\\1/p' "$SF_REQUEST")`;
const MERGES = `out=${field('outputDir')}; echo ${field('head')} > "$out/head"; printf %s "$GH_TOKEN" > "$out/token"`;
const rows = (db: string, cycleId: string) => {
  const raw = new DatabaseSync(db);
  try { return (raw.prepare('SELECT type FROM events WHERE cycle_id = ? ORDER BY seq').all(cycleId) as { type: string }[]).map((r) => r.type); } finally { raw.close(); }
};

test('accept runs the grant stage after the human stage, and the cycle ends ACCEPTED (11-a2)', () => {
  const { env, jobFile, runsDir, head, db, cycleId } = atOwnerBeforeGrant(MERGES);
  const r = sf(['accept', jobFile, head], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: ACCEPTED$/m);
  assert.ok(r.stdout.includes(`merge --no-ff ${head}`), r.stdout);
  assert.equal(readFileSync(join(runsDir, 'evidence', head, 'MERGE', 'output', 'token'), 'utf8'), 'main-grant-value');
  assert.deepEqual(rows(db, cycleId).slice(-2), ['accept', 'verification']);
});

test('a grant stage that fails after accept escalates the cycle, and accept exits 1 with the escalation (11-a2)', () => {
  const { env, jobFile, head } = atOwnerBeforeGrant('exit 3');
  const r = sf(['accept', jobFile, head], env);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: ESCALATED$/m);
  assert.match(r.stdout, /^Escalation: /m);
  assert.doesNotMatch(r.stdout, /merge --no-ff/);
});

test('accept refuses, writing nothing, when the grant stage it leads to would fail preflight (11-a2)', () => {
  const { env, jobFile, head, db, cycleId } = atOwnerBeforeGrant(MERGES);
  const before = rows(db, cycleId);
  const spec = JSON.parse(readFileSync(jobFile, 'utf8'));
  delete spec.grants;
  writeFileSync(jobFile, JSON.stringify(spec));
  const r = sf(['accept', jobFile, head], env);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^stage MERGE asks for grant github, which no personal or job file gives$/m);
  assert.deepEqual(rows(db, cycleId), before);
});

test('accept under the default workflow builds no adapter: a runtime nobody registered does not stop it (11-a2)', () => {
  const { jobFile, db } = scratch();
  seed(db, 'c1', TO_ACCEPTANCE);
  const spec = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...spec, runtime: { developer: 'nosuch', standard: 'nosuch', adversarial: 'nosuch' } }));
  const r = sf(['accept', jobFile, H]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, `Cycle: c1\nStage: ACCEPTED\n\nTo merge:\n  git -C ${spec.repo} merge --no-ff ${H}\n`);
});

test('accept that drives on to a further human stage prints the next steps and exits 0 (11-a2 standard 1)', () => {
  const { env, jobFile, head } = atOwnerBeforeGrant(MERGES, `'FINAL'`);
  const r = sf(['accept', jobFile, head], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: FINAL$/m);
  assert.ok(r.stdout.includes(`accept ${jobFile} ${head}`), r.stdout);
  assert.doesNotMatch(r.stdout, /^To merge:$/m);
});


// Ticket 11-d (A-123 item 1, A-132): the owner's FAIL names its SHA; owner commands carry a command ID;
// two accepts decided on one load cannot both land.
test('request-changes records the owner\'s FAIL for exactly the candidate head, and refuses as accept does', () => {
  const { jobFile, db } = scratch();
  const refused = (args: string[], why: RegExp) => {
    const r = sf(args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, '', args.join(' '));
    assert.match(r.stderr, why, args.join(' '));
  };
  refused(['request-changes', jobFile, H], /no open cycle/);
  seed(db, 'c1', TO_ACCEPTANCE.slice(0, 3));
  refused(['request-changes', jobFile, H], /c1 is STANDARD_REVIEW, not AWAITING_ACCEPTANCE/);
  const store = new EventStore(db);
  for (const e of TO_ACCEPTANCE.slice(3)) store.append('c1', e);
  store.close();
  refused(['request-changes', jobFile, 'c'.repeat(40)], new RegExp(`not the candidate head ${H}`));
  refused(['request-changes', jobFile], /usage/);
  assert.deepEqual(look(db, 'c1'), { stage: 'AWAITING_ACCEPTANCE', events: 5 });
  // The default workflow sends the owner's FAIL to ESCALATED.
  const ok = sf(['request-changes', jobFile, H, '--command-id', 'gh:7']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^Stage: ESCALATED$/m);
  const after = new EventStore(db);
  assert.deepEqual(after.events('c1').at(-1), { type: 'request_changes', head: H, source: 'owner', commandId: 'gh:7' });
  after.close();
});

test('owner commands take --source and --command-id in either order, each once; a bad command ID is refused', () => {
  const { jobFile, db } = scratch();
  seed(db, 'c1', TO_ACCEPTANCE);
  for (const args of [
    ['accept', jobFile, H, '--command-id', 'x', '--command-id', 'y'],
    ['accept', jobFile, H, '--command-id'],
    ['accept', jobFile, H, '--commandid', 'x'],
    ['cancel', jobFile, '--source', 'a', '--source', 'b'],
  ]) {
    const r = sf(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /usage/, args.join(' '));
  }
  for (const bad of ['', 'two\nlines']) {
    const r = sf(['accept', jobFile, H, '--command-id', bad]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^--command-id must be one line of printable text$/m);
  }
  assert.equal(look(db, 'c1').events, 5);
  const ok = sf(['accept', jobFile, H, '--command-id', 'cli:1', '--source', 'bot']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const store = new EventStore(db);
  assert.deepEqual(store.events('c1').at(-1), { type: 'accept', head: H, source: 'bot', commandId: 'cli:1' });
  store.close();
});

test('two overlapping accepts before a grant stage: one runs the grant stage once, the other writes nothing (A-132)', async () => {
  for (let round = 0; round < 2; round++) {
    const { env, jobFile, head, db, cycleId } = atOwnerBeforeGrant(MERGES);
    // Both commands load the cycle and pass preflight under the held lock, then queue on it together.
    const lock = new DatabaseSync(db);
    lock.exec('BEGIN IMMEDIATE');
    const accept = () => new Promise<{ code: number | null; out: string }>((done) => {
      const child = spawn(process.execPath, [MAIN, 'accept', jobFile, head], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => done({ code, out }));
    });
    const both = Promise.all([accept(), accept()]);
    await new Promise((r) => setTimeout(r, 2500));
    lock.exec('COMMIT');
    lock.close();
    const results = (await both).sort((a, b) => (a.code ?? 9) - (b.code ?? 9));
    assert.equal(results[0]!.code, 0, results[0]!.out);
    assert.match(results[0]!.out, /^Stage: ACCEPTED$/m);
    assert.equal(results[1]!.code, 2, results[1]!.out);
    assert.match(results[1]!.out, new RegExp(`cycle ${cycleId} moved since it was loaded: \\d+ events, not \\d+; nothing was written; run the command again`));
    // The review's verdict, the accept, then MERGE's verification: the grant stage ran once.
    assert.deepEqual(rows(db, cycleId).slice(-3), ['verdict', 'accept', 'verification']);
    assert.deepEqual(rows(db, cycleId).filter((t) => t === 'accept'), ['accept']);
    assert.equal(look(db, cycleId).stage, 'ACCEPTED');
  }
});

test('decideAt appends with the load its refusals checked, not a later one (11-d standard 1)', async () => {
  const { decideAt } = await import('../src/main.ts');
  const { acceptEvent } = await import('../src/decide.ts');
  const { jobFile, db } = scratch();
  seed(db, 'c1', TO_ACCEPTANCE);
  // Another writer lands between the decision's load and decideAndDrive's own load.
  await assert.rejects(decideAt(jobFile, (store, workId, where) => {
    const decided = acceptEvent(store, workId, H, 'owner', where);
    const other = new EventStore(db);
    other.append('c1', { type: 'head_changed', head: H });
    other.close();
    return decided;
  }), /^Error: cycle c1 moved since it was loaded: 6 events, not 5; nothing was written; run the command again$/);
  assert.deepEqual(look(db, 'c1'), { stage: 'AWAITING_ACCEPTANCE', events: 6 });
});

// 11-d standard 2 (A-141): a command delivered twice is recorded once and driven once.
test('two overlapping deliveries of one command ID: the accept is recorded once and the grant stage runs once', async () => {
  const { env, jobFile, head, db, cycleId } = atOwnerBeforeGrant(MERGES);
  const lock = new DatabaseSync(db);
  lock.exec('BEGIN IMMEDIATE');
  const accept = () => new Promise<{ code: number | null; out: string }>((done) => {
    const child = spawn(process.execPath, [MAIN, 'accept', jobFile, head, '--command-id', 'same'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });
  const both = Promise.all([accept(), accept()]);
  await new Promise((r) => setTimeout(r, 2500));
  lock.exec('COMMIT');
  lock.close();
  const results = await both;
  const all = results.map((r) => r.out).join('\n---\n');
  for (const r of results) assert.equal(r.code, 0, r.out);
  // The duplicate may write before or after the first has driven the cycle, so its own Stage line
  // can say MERGE or ACCEPTED; only the writer drives on and prints the merge lines.
  const dup = results.filter((r) => /^Already recorded: command same$/m.test(r.out));
  const writer = results.filter((r) => !/^Already recorded:/m.test(r.out));
  assert.equal(dup.length, 1, all);
  assert.equal(writer.length, 1, all);
  assert.match(writer[0]!.out, /^Stage: ACCEPTED$/m);
  assert.match(writer[0]!.out, /^To merge:$/m);
  assert.doesNotMatch(dup[0]!.out, /^To merge:$/m);
  assert.deepEqual(rows(db, cycleId).slice(-3), ['verdict', 'accept', 'verification']);
  assert.equal(look(db, cycleId).stage, 'ACCEPTED');
});

test('request-changes drives on into the stage the owner\'s FAIL leads to, as accept does', () => {
  const { env, jobFile, head, db, cycleId, runsDir } = atOwnerBeforeGrant(MERGES, `'ACCEPTED'`, `'MERGE'`);
  const r = sf(['request-changes', jobFile, head], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: ACCEPTED$/m);
  assert.deepEqual(rows(db, cycleId).slice(-2), ['request_changes', 'verification']);
  assert.equal(readFileSync(join(runsDir, 'evidence', head, 'MERGE', 'output', 'token'), 'utf8'), 'main-grant-value');
});

test('two overlapping deliveries of one request-changes command ID: the FAIL is recorded once (11-d standard 3)', async () => {
  const { jobFile, db } = scratch();
  seed(db, 'c1', TO_ACCEPTANCE);
  const lock = new DatabaseSync(db);
  lock.exec('BEGIN IMMEDIATE');
  const send = () => new Promise<{ code: number | null; out: string }>((done) => {
    const child = spawn(process.execPath, [MAIN, 'request-changes', jobFile, H, '--command-id', 'same'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });
  const both = Promise.all([send(), send()]);
  await new Promise((r) => setTimeout(r, 2500));
  lock.exec('COMMIT');
  lock.close();
  const results = await both;
  const all = results.map((r) => r.out).join('\n---\n');
  for (const r of results) assert.equal(r.code, 0, r.out);
  assert.equal(results.filter((r) => /^Already recorded: command same$/m.test(r.out)).length, 1, all);
  assert.equal(results.filter((r) => /^Escalation: AWAITING_ACCEPTANCE FAIL: owner requested changes$/m.test(r.out)).length, 1, all);
  assert.deepEqual(look(db, 'c1'), { stage: 'ESCALATED', events: 6 });
});

// Ticket 11-d2 (A-114, A-139): retry, overrule and route on an escalated cycle, driven on as accept is.
const MARK = 'owner-ruling-7f3a';
/**
 * Live run 1 as a stub claude: the standard reviewer FAILs unless its prompt holds the owner's
 * ruling, the fix run disputes, and the adversarial reviewer PASSes unless its prompt holds the
 * ruling, which is for the standard review alone.
 */
function liveRunOneStub(bin: string) {
  writeFileSync(join(bin, 'claude'), [
    '#!/bin/sh',
    'p=$(cat)',
    `reply() { esc=$(printf %s "$1" | sed 's/"/\\\\"/g'); printf '{"type":"result","is_error":false,"result":"%s"}\\n' "$esc"; }`,
    'h=$(printf %s "$p" | sed -n "s/^Candidate SHA: //p")',
    'pass() { reply "{\\"head\\":\\"$h\\",\\"verdict\\":\\"PASS\\",\\"findings\\":[]}"; exit 0; }',
    'fail() { reply "{\\"head\\":\\"$h\\",\\"verdict\\":\\"FAIL\\",\\"findings\\":[\\"README.md:1 the check printed exit 0\\"]}"; exit 0; }',
    `case "$p" in *"You are the standard reviewer"*) case "$p" in *"${MARK}"*) pass;; *) fail;; esac;; esac`,
    `case "$p" in *"You are the adversarial reviewer"*) case "$p" in *"${MARK}"*) fail;; *) pass;; esac;; esac`,
    'case "$p" in *"fixing review findings"*) reply "{\\"head\\":\\"$(git rev-parse HEAD)\\",\\"artifacts\\":[],\\"dispute\\":\\"the finding is wrong\\"}"; exit 0;; esac',
    'echo done > done.txt && git add done.txt && git -c user.name=s -c user.email=s@example.invalid commit -qm done',
    'reply "{\\"head\\":\\"$(git rev-parse HEAD)\\",\\"artifacts\\":[\\"done.txt\\"]}"',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'claude'), 0o755);
}
/** A scratch job run by the stub until it escalates. */
function escalated(stub: (bin: string, root: string) => void, checks?: unknown) {
  const s = scratch();
  const bin = join(s.root, 'bin');
  mkdirSync(bin);
  stub(bin, s.root);
  if (checks) writeFileSync(s.jobFile, JSON.stringify({ ...JSON.parse(readFileSync(s.jobFile, 'utf8')), checks }));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const first = sf([s.jobFile], env);
  assert.equal(first.status, 1, first.stdout + first.stderr);
  assert.match(first.stdout, /^Stage: ESCALATED$/m);
  const head = /^Head: ([0-9a-f]{40})$/m.exec(first.stdout)![1]!;
  const cycleId = /^Cycle: (\S+)$/m.exec(first.stdout)![1]!;
  return { ...s, bin, env, head, cycleId, first };
}

test('live run 1: a reviewer FAIL, a developer dispute, then overrule reruns the review on the same head and the cycle reaches AWAITING_ACCEPTANCE (11-d2)', () => {
  const { env, jobFile, head, cycleId, db, first } = escalated(liveRunOneStub);
  assert.match(first.stdout, /^Escalation: developer disputes the findings on [0-9a-f]{40}: the finding is wrong$/m);
  assert.match(first.stdout, /^Reviews: standard 1, adversarial 0$/m);
  const r = sf(['overrule', jobFile, head, '--reason', `${MARK}: the check prints what it observed`], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: AWAITING_ACCEPTANCE$/m);
  assert.match(r.stdout, new RegExp(`^Head: ${head}$`, 'm'));
  // The refund: the rerun counts again, so standard stays at 1.
  assert.match(r.stdout, /^Reviews: standard 1, adversarial 1$/m);
  assert.match(r.stdout, new RegExp(`^owner overrule ${head.slice(0, 7)}: ${MARK}: the check prints what it observed$`, 'm'));
  assert.doesNotMatch(r.stdout, /^Escalation:/m);
  assert.ok(r.stdout.includes(`accept ${jobFile} ${head}`), r.stdout);
  assert.deepEqual(rows(db, cycleId).slice(-6), ['dispute', 'owner_decision', 'run_started', 'verdict', 'run_started', 'verdict']);
});

test('retry reruns the stage the cycle escalated from, with the job\'s checks as they are now (11-d2)', () => {
  const { env, jobFile, head, cycleId, db, first } = escalated((bin, root) => reviewerStub(bin, 'claude', 'nobody', join(root, 'outside')), [{ name: 'ok', command: ['false'] }]);
  assert.match(first.stdout, /^Escalation: VERIFYING FAIL: required check failed or missing$/m);
  writeFileSync(jobFile, JSON.stringify({ ...JSON.parse(readFileSync(jobFile, 'utf8')), checks: [{ name: 'ok', command: ['true'] }] }));
  const r = sf(['retry', jobFile, head, '--reason', 'the check was wrong', '--command-id', 'r1'], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: AWAITING_ACCEPTANCE$/m);
  assert.match(r.stdout, /^verification [0-9a-f]{7}: ok PASS$/m);
  // A later delivery finds no escalated cycle, as a late accept finds no human stage (11-d); an
  // overlapping one is the store's to drop by its command ID.
  const again = sf(['retry', jobFile, head, '--reason', 'the check was wrong', '--command-id', 'r1'], env);
  assert.equal(again.status, 2, again.stdout + again.stderr);
  assert.match(again.stderr, /^no escalated cycle for work w in /m);
  assert.equal(rows(db, cycleId).filter((t) => t === 'owner_decision').length, 1);
});

test('route to the human stage is accept with risk: nothing runs, then accept settles it (11-d2)', () => {
  const { env, jobFile, head, cycleId, db } = escalated((bin, root) => reviewerStub(bin, 'claude', 'nobody', join(root, 'outside')), [{ name: 'ok', command: ['false'] }]);
  // The runtime is gone: route to a human stage builds no adapter.
  const spec = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...spec, runtime: { developer: 'nosuch', standard: 'nosuch', adversarial: 'nosuch' } }));
  const r = sf(['route', jobFile, head, 'AWAITING_ACCEPTANCE', '--reason', 'a known failure; shipping with it'], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: AWAITING_ACCEPTANCE$/m);
  assert.match(r.stdout, new RegExp(`^owner route to AWAITING_ACCEPTANCE ${head.slice(0, 7)}: a known failure; shipping with it$`, 'm'));
  assert.ok(r.stdout.includes(`accept ${jobFile} ${head}`), r.stdout);
  const a = sf(['accept', jobFile, head], env);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.match(a.stdout, /^Stage: ACCEPTED$/m);
  assert.deepEqual(rows(db, cycleId).slice(-3), ['verification', 'owner_decision', 'accept']);
});

test('a move\'s reason reaches the terminal only escaped: a control character in it cannot drive the owner\'s terminal (11-d2, adversarial)', () => {
  const { env, jobFile, head } = escalated((bin, root) => reviewerStub(bin, 'claude', 'nobody', join(root, 'outside')), [{ name: 'ok', command: ['false'] }]);
  const r = sf(['route', jobFile, head, 'AWAITING_ACCEPTANCE', '--reason', 'shipping \u001b[2Jwith it'], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.includes('\u001b'), false, r.stdout);
  assert.match(r.stdout, new RegExp(`^owner route to AWAITING_ACCEPTANCE ${head.slice(0, 7)}: shipping \\\\u\\{1b\\}\\[2Jwith it$`, 'm'));
});

test('a move is refused, writing nothing, without a reason, for another head, an unknown stage, a cycle with a child, or what preflight refuses (11-d2)', () => {
  const { env, jobFile, head, cycleId, db } = escalated((bin, root) => reviewerStub(bin, 'claude', 'nobody', join(root, 'outside')), [{ name: 'ok', command: ['false'] }]);
  const before = rows(db, cycleId);
  const refused = (args: string[], why: RegExp) => {
    const r = sf(args, env);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, '', args.join(' '));
    assert.match(r.stderr, why, args.join(' '));
  };
  refused(['retry', jobFile, head], /usage/);
  refused(['route', jobFile, head, '--reason', 'x'], /usage/);
  refused(['retry', jobFile, head, '--reason', ''], /^a move needs a reason$/m);
  refused(['retry', jobFile, head, '--reason', 'x', '--reason', 'y'], /usage/);
  refused(['overrule', jobFile, 'c'.repeat(40), '--reason', 'x'], new RegExp(`move refused: ${'c'.repeat(40)} is not the candidate head ${head}`));
  refused(['overrule', jobFile, head, '--reason', 'x'], /move refused: the cycle has no verdict to overrule/);
  refused(['route', jobFile, head, 'NOPE', '--reason', 'x'], /move refused: NOPE is not a workflow stage/);
  // VERIFYING runs a check, so the move builds the adapters first.
  const spec = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...spec, runtime: { ...spec.runtime, standard: 'nosuch' } }));
  refused(['retry', jobFile, head, '--reason', 'x'], /nosuch/);
  writeFileSync(jobFile, JSON.stringify(spec));
  assert.deepEqual(rows(db, cycleId), before);
  // Start over was chosen: the child holds the parent.
  const store = new EventStore(db);
  store.open('child', 'w', cycleId);
  store.append('child', { type: 'cancel' });
  store.close();
  refused(['retry', jobFile, head, '--reason', 'x'], new RegExp(`cycle ${cycleId} is the parent of cycle child`));
  assert.deepEqual(rows(db, cycleId), before);
});

// Ticket 11-f: `recover <job.json>` records what the work's started runs left and launches nothing.
test('recover: no store is nothing to do; a reviewer run that left nothing is failed and the cycle escalates; extra words are refused', () => {
  const { jobFile, db } = scratch();
  const none = sf(['recover', jobFile]);
  assert.equal(none.status, 0, none.stdout + none.stderr);
  assert.match(none.stdout, /^No event store at .*: nothing to recover$/m);
  seed(db, 'c1', [...TO_ACCEPTANCE.slice(0, 3), { type: 'run_started', runId: 'std9', runtime: 'claude' }]);
  const r = sf(['recover', jobFile]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Cycle c1: run std9 failed; now ESCALATED$/m);
  assert.equal(look(db, 'c1').stage, 'ESCALATED');
  const again = sf(['recover', jobFile]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /^Cycle c1: no started run waiting; ESCALATED$/m);
  assert.equal(look(db, 'c1').events, 5);
  assert.equal(sf(['recover', jobFile, 'now']).status, 2);
});

test('recover clears the failed unit of a run under its runsDir, by the run folder\'s name (parked 04-e, 11-e)', async (t) => {
  if (spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status !== 0) return void t.skip('no user systemd');
  const { jobFile, runsDir } = scratch();
  const runId = `test-${process.pid}-main-recover`;
  mkdirSync(join(runsDir, 'runs', runId), { recursive: true });
  const show = () => spawnSync('systemctl', ['--user', 'show', `sf-${runId}.scope`, '-p', 'ActiveState', '-p', 'LoadState'], { encoding: 'utf8' }).stdout;
  try {
    spawnSync('systemd-run', ['--user', '--scope', '-q', `--unit=sf-${runId}`, '-p', 'RuntimeMaxSec=1', '--', 'sleep', '30']);
    for (const end = Date.now() + 3000; Date.now() < end && !/^ActiveState=failed$/m.test(show()); ) await new Promise((res) => setTimeout(res, 50));
    seed(join(runsDir, 'events.sqlite'), 'c1', TO_ACCEPTANCE.slice(0, 3));
    const r = sf(['recover', jobFile]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^Cleared empty units: sf-${runId}\\.scope$`, 'm'));
    assert.match(show(), /^LoadState=not-found$/m);
  } finally {
    spawnSync('systemctl', ['--user', 'reset-failed', `sf-${runId}.scope`]);
  }
});

// 11-f standard 2: the work's lock waits 5 s, but a drive (a fix or review run) takes minutes. A
// delivery still waiting when the wait ends gets the store's answer, not the lock's.
const SLOW_MERGES = `sleep 7; ${MERGES}`;
const deliver = (jobFile: string, head: string, env: NodeJS.ProcessEnv, extra: string[] = []) => new Promise<{ code: number | null; out: string }>((done) => {
  const child = spawn(process.execPath, [MAIN, 'accept', jobFile, head, ...extra], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.on('close', (code) => done({ code, out }));
});

test('a command ID delivered again while its first delivery drives past the lock wait is "Already recorded", exit 0 (11-f, standard 2)', async () => {
  const { env, jobFile, head, db, cycleId } = atOwnerBeforeGrant(SLOW_MERGES);
  const lock = new DatabaseSync(db);
  lock.exec('BEGIN IMMEDIATE');
  const both = Promise.all([deliver(jobFile, head, env, ['--command-id', 'same']), deliver(jobFile, head, env, ['--command-id', 'same'])]);
  await new Promise((r) => setTimeout(r, 2500));
  lock.exec('COMMIT');
  lock.close();
  const results = await both;
  const all = results.map((r) => r.out).join('\n---\n');
  for (const r of results) assert.equal(r.code, 0, all);
  assert.equal(results.filter((r) => /^Already recorded: command same$/m.test(r.out)).length, 1, all);
  assert.deepEqual(rows(db, cycleId).filter((t) => t === 'accept'), ['accept']);
  assert.equal(look(db, cycleId).stage, 'ACCEPTED');
});

test('of two different accepts, the one still waiting when the other drives past the lock wait gets "run the command again", not the lock (11-f, standard 2)', async () => {
  const { env, jobFile, head, db, cycleId } = atOwnerBeforeGrant(SLOW_MERGES);
  const lock = new DatabaseSync(db);
  lock.exec('BEGIN IMMEDIATE');
  const both = Promise.all([deliver(jobFile, head, env), deliver(jobFile, head, env)]);
  await new Promise((r) => setTimeout(r, 2500));
  lock.exec('COMMIT');
  lock.close();
  const results = (await both).sort((a, b) => (a.code ?? 9) - (b.code ?? 9));
  assert.equal(results[0]!.code, 0, results[0]!.out);
  assert.equal(results[1]!.code, 2, results[1]!.out);
  assert.match(results[1]!.out, new RegExp(`cycle ${cycleId} moved since it was loaded: \\d+ events, not \\d+; nothing was written; run the command again`));
  assert.deepEqual(rows(db, cycleId).filter((t) => t === 'accept'), ['accept']);
});

// Ticket 11-f2: resume drives the work's open cycle on from its stage, and only there: a human stage
// or an escalated cycle is the owner's, and a started run with no outcome is recover's.
test('resume at a human stage prints the next steps and drives nothing; on an escalated cycle it prints the owner\'s moves', () => {
  const { jobFile, db } = scratch();
  seed(db, 'c0', ESCALATE);
  const esc = sf(['resume', jobFile]);
  assert.equal(esc.status, 1, esc.stdout + esc.stderr);
  assert.match(esc.stdout, /^Stage: ESCALATED$/m);
  assert.match(esc.stdout, /^Escalation: run failed: timeout$/m);
  // No candidate (a dead developer run): no move can name one, so only a new cycle or cancel.
  assert.doesNotMatch(esc.stdout, / (retry|overrule|route) /);
  assert.match(esc.stdout, /parentCycleId c0/);
  assert.match(esc.stdout, new RegExp(`^  node \\S+ cancel ${jobFile}$`, 'm'));
  assert.equal(look(db, 'c0').events, ESCALATE.length);
  seed(db, 'c1', TO_ACCEPTANCE, 'c0');
  const human = sf(['resume', jobFile]);
  assert.equal(human.status, 0, human.stdout + human.stderr);
  assert.match(human.stdout, /^Stage: AWAITING_ACCEPTANCE$/m);
  assert.ok(human.stdout.includes(`accept ${jobFile} ${H}`), human.stdout);
  assert.equal(look(db, 'c1').events, TO_ACCEPTANCE.length);
  assert.equal(sf(['resume', jobFile, 'now']).status, 2);
});

test('resume refuses a cycle with a started run and no outcome, saying to run recover, and with no cycle says there is nothing to resume', () => {
  const { jobFile, db } = scratch();
  const none = sf(['resume', jobFile]);
  assert.equal(none.status, 2, none.stdout + none.stderr);
  assert.match(none.stderr, /^nothing to resume for work w in /m);
  seed(db, 'c1', [...TO_ACCEPTANCE.slice(0, 3), { type: 'run_started', runId: 'std9', runtime: 'claude' }]);
  const r = sf(['resume', jobFile]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /run std9 started and has no outcome; run recover/);
  assert.equal(look(db, 'c1').events, 4);
});

test('resume drives a cycle left at VERIFYING to its human stage, refusing first a changed ticket and a work another process holds', async () => {
  const { root, repo, runsDir, jobFile, db } = scratch();
  const bin = join(root, 'bin');
  mkdirSync(bin);
  reviewerStub(bin, 'claude', 'nobody', join(root, 'outside'));
  const store = new EventStore(db);
  const dev = cliAdapter({ ...claude, command: join(bin, 'claude') }, { isolation: 'process-group' });
  const opened = await develop(store, dev, { workId: 'w', ticket: 'x', repo, checks: [{ name: 'ok', command: ['true'] }] }, { deadlineMs: 20_000, runsDir });
  store.close();
  assert.equal(opened.cycle.stage, 'VERIFYING', opened.cycle.escalation);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  writeFileSync(jobFile, JSON.stringify({ ...job, ticket: 'y' }));
  const changed = sf(['resume', jobFile], env);
  assert.equal(changed.status, 2, changed.stdout + changed.stderr);
  assert.match(changed.stderr, /the job's ticket changed since the cycle opened/);
  writeFileSync(jobFile, JSON.stringify(job));
  const child = await holder(runsDir, 'w');
  try {
    const locked = sf(['resume', jobFile], env);
    assert.equal(locked.status, 2, locked.stdout + locked.stderr);
    assert.match(locked.stderr, new RegExp(`^work w is held by process ${child.pid}`, 'm'));
  } finally {
    await kill(child);
  }
  // Nothing appended, not only no stage moved (11-f2 standard 2).
  assert.deepEqual(look(db, opened.cycle.cycleId), { stage: 'VERIFYING', events: opened.cycle.history.length });
  const r = sf(['resume', jobFile], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Stage: AWAITING_ACCEPTANCE$/m);
  assert.match(r.stdout, /^verification [0-9a-f]{7}: ok PASS$/m);
});

// 11-f adversarial minor 4: a timer runs recover and reads its exit code. 1 is "try again": a run
// still going, a work another process holds, or a cycle recover refused.
test('recover exits 1 while a run is still going, the work is held, or a cycle is refused, and 0 once every run has an outcome', async () => {
  const { jobFile, db, runsDir } = scratch();
  seed(db, 'c1', [...TO_ACCEPTANCE.slice(0, 3), { type: 'run_started', runId: 'std9', runtime: 'claude' }]);
  // A run whose controller died while it ran: its stdout is still held for writing, and no exit.
  const folder = runDir(runsDir, 'std9');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'stdin'), 'p');
  const out = openSync(join(folder, 'stdout'), 'w');
  const run = spawn('sleep', ['30'], { detached: true, stdio: ['ignore', out, 'ignore'] });
  closeSync(out);
  run.unref();
  try {
    const going = sf(['recover', jobFile]);
    assert.equal(going.status, 1, going.stdout + going.stderr);
    assert.match(going.stdout, /^Cycle c1: run std9 still running; --stop ends it$/m);
  } finally {
    process.kill(run.pid!, 'SIGKILL');
  }
  const child = await holder(runsDir, 'w');
  try {
    const held = sf(['recover', jobFile]);
    assert.equal(held.status, 1, held.stdout + held.stderr);
    assert.match(held.stdout, new RegExp(`^Cycle c1: skipped; process ${child.pid} holds the work$`, 'm'));
  } finally {
    await kill(child);
  }
  const other = scratch();
  seed(other.db, 'c1', [...TO_ACCEPTANCE.slice(0, 3), { type: 'run_started', runId: 'std8', runtime: 'nobody' }]);
  const refused = sf(['recover', other.jobFile]);
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.stdout, /^Cycle c1: run std8 refused: run std8: runtime nobody is not in the registry$/m);
  const done = sf(['recover', jobFile]);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /^Cycle c1: run std9 failed; now ESCALATED$/m);
});

// 11-f2 standard 1, minors 1 and 2: a cycle the store cannot replay is skipped by cancel and resume,
// and each says so, so the owner never reads "cancelled" or "nothing to resume" over it.
function divergedChild() {
  const s = scratch();
  seed(s.db, 'c0', ESCALATE);
  seed(s.db, 'c1', TO_ACCEPTANCE, 'c0');
  const raw = new DatabaseSync(s.db);
  raw.prepare("UPDATE events SET stage = 'ACCEPTED' WHERE cycle_id = 'c1' AND seq = 1").run();
  raw.close();
  return s;
}

test('cancel names a cycle the store cannot replay, with the reason, and exits 1 though it cancelled the others', () => {
  const { jobFile, db } = divergedChild();
  const r = sf(['cancel', jobFile]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^Cycle c1: not cancelled; the store cannot replay it: cycle c1 row 1 \(claim\) was recorded at ACCEPTED/m);
  assert.equal(look(db, 'c0').stage, 'CANCELLED');
});

test('resume names a cycle the store cannot replay, with the reason: alone it is refused, beside an escalated one it is listed', () => {
  const { jobFile } = divergedChild();
  const beside = sf(['resume', jobFile]);
  assert.equal(beside.status, 1, beside.stdout + beside.stderr);
  assert.match(beside.stdout, /^Cycle c1: not resumed; the store cannot replay it: cycle c1 row 1/m);
  const alone = scratch();
  seed(alone.db, 'c1', TO_ACCEPTANCE);
  const raw = new DatabaseSync(alone.db);
  raw.prepare("UPDATE events SET stage = 'ACCEPTED' WHERE cycle_id = 'c1' AND seq = 1").run();
  raw.close();
  const r = sf(['resume', alone.jobFile]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^nothing to resume for work w in .*; cycle c1: the store cannot replay it: cycle c1 row 1/m);
});

// 11-f2 standard 2: each cycle keeps the job its own base gave it. The repository layer may set the
// checks, so a child opened at a later base is resumed under that base's layers, not the first one's.
test('resume reads the layers at the resumed cycle\'s own base: a child opened where the repository\'s checks changed is driven, not refused', () => {
  const { root, repo, runsDir, jobFile, db } = scratch();
  const bin = join(root, 'bin');
  mkdirSync(bin);
  reviewerStub(bin, 'claude', 'nobody', join(root, 'outside'));
  const layer = (name: string) => {
    mkdirSync(join(repo, '.factory'), { recursive: true });
    writeFileSync(join(repo, '.factory', 'config.json'), JSON.stringify({ checks: [{ name, command: ['true'] }] }));
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', `checks ${name}`);
    return git(repo, 'rev-parse', 'HEAD');
  };
  const B0 = layer('a');
  const B1 = layer('b');
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  delete job.checks;
  writeFileSync(jobFile, JSON.stringify(job));
  const store = new EventStore(db);
  store.open('c0', 'w', undefined, B0, jobRecord({ workId: 'w', ticket: 'x', repo, checks: [{ name: 'a', command: ['true'] }] }));
  for (const e of ESCALATE) store.append('c0', e);
  store.open('c1', 'w', 'c0', B1, jobRecord({ workId: 'w', ticket: 'x', repo, checks: [{ name: 'b', command: ['true'] }] }));
  store.append('c1', { type: 'claim', runId: 'dev1', base: B0, runtime: 'claude' });
  store.append('c1', { type: 'developer_result', runId: 'dev1', head: B1, artifacts: ['.factory/config.json'] });
  store.close();
  const r = sf(['resume', jobFile], { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  assert.doesNotMatch(r.stderr, /changed since the cycle opened/);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^verification [0-9a-f]{7}: b PASS$/m);
  assert.match(r.stdout, /^Stage: AWAITING_ACCEPTANCE$/m);
});

// 11-f2 standard 2: the store refuses a move on a cycle with a child, so resume does not offer one.
test('resume on an escalated parent whose child the store cannot replay offers only cancel', () => {
  const { jobFile } = divergedChild();
  const r = sf(['resume', jobFile]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^Cycle c1: not resumed;/m);
  assert.doesNotMatch(r.stdout, / (retry|overrule|route) /);
  assert.match(r.stdout, new RegExp(`^  node \\S+ cancel ${jobFile}$`, 'm'));
});

// 11-f2 standard 3: cycle IDs are random UUIDs, so ID order is not age. A child whose ID sorts
// before its parent's is still the cycle the owner moves on.
test('resume reports the escalated cycle with no child, whatever the ID order, and offers its moves', () => {
  const { jobFile, db } = scratch();
  seed(db, 'z0', ESCALATE);
  seed(db, 'a1', ESCALATE, 'z0');
  const r = sf(['resume', jobFile]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^Cycle: a1$/m);
  assert.match(r.stdout, /parentCycleId a1/);
});

test('cancel names the work\'s only cycle when the store cannot replay it', () => {
  const { jobFile, db } = scratch();
  seed(db, 'c1', TO_ACCEPTANCE);
  const raw = new DatabaseSync(db);
  raw.prepare("UPDATE events SET stage = 'ACCEPTED' WHERE cycle_id = 'c1' AND seq = 1").run();
  raw.close();
  const r = sf(['cancel', jobFile]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^nothing to cancel for work w in .*; cycle c1: the store cannot replay it: cycle c1 row 1/m);
});

// 11-f2 adversarial: resume offers only the moves the store would take, for the candidate head.
test('resume offers each move the store would take on the escalated cycle, for its candidate head', () => {
  const disputed = scratch();
  seed(disputed.db, 'c1', [
    ...TO_ACCEPTANCE.slice(0, 3),
    { type: 'verdict', runId: 'std1', head: H, verdict: 'FAIL', findings: ['f1'] },
    { type: 'claim', runId: 'dev2', base: 'b'.repeat(40), runtime: 'fake' },
    { type: 'dispute', runId: 'dev2', head: H, reason: 'the finding is wrong' },
  ]);
  const all = sf(['resume', disputed.jobFile]);
  assert.equal(all.status, 1, all.stdout + all.stderr);
  for (const move of ['retry', 'overrule', 'route']) assert.match(all.stdout, new RegExp(`^  node \\S+ ${move} ${disputed.jobFile} ${H}`, 'm'));
  assert.doesNotMatch(all.stdout, /<sha>/);
  const failedReview = scratch();
  seed(failedReview.db, 'c1', [...TO_ACCEPTANCE.slice(0, 3), { type: 'run_started', runId: 'std1', runtime: 'claude' }, { type: 'run_failed', runId: 'std1', reason: 'timeout' }]);
  const some = sf(['resume', failedReview.jobFile]);
  assert.equal(some.status, 1, some.stdout + some.stderr);
  assert.match(some.stdout, new RegExp(`^  node \\S+ retry ${failedReview.jobFile} ${H}`, 'm'));
  assert.match(some.stdout, new RegExp(`^  node \\S+ route ${failedReview.jobFile} ${H} <stage>`, 'm'));
  assert.doesNotMatch(some.stdout, / overrule /);
});

test('resume offers no move on an escalated parent with a candidate when it has a child: the store would refuse each', () => {
  const { jobFile, db } = scratch();
  seed(db, 'c0', [
    ...TO_ACCEPTANCE.slice(0, 3),
    { type: 'verdict', runId: 'std1', head: H, verdict: 'FAIL', findings: ['f1'] },
    { type: 'claim', runId: 'dev2', base: 'b'.repeat(40), runtime: 'fake' },
    { type: 'dispute', runId: 'dev2', head: H, reason: 'the finding is wrong' },
  ]);
  seed(db, 'c1', TO_ACCEPTANCE, 'c0');
  const raw = new DatabaseSync(db);
  raw.prepare("UPDATE events SET stage = 'ACCEPTED' WHERE cycle_id = 'c1' AND seq = 1").run();
  raw.close();
  const r = sf(['resume', jobFile]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^Cycle: c0$/m);
  assert.match(r.stdout, /^The cycle has a child, c1, so it cannot be moved\.$/m);
  assert.doesNotMatch(r.stdout, / (retry|overrule|route) /);
});
