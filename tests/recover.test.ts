// Ticket 11-f: recover resolves the started runs a dead controller left (A-105, A-122). It
// receives a finished run under its run ID, fails a gone one, reports a running one, and never
// launches a run. Scripted adapters stand in for `look`; the killed-controller tests use the CLI
// adapter over the fixture CLI under both isolations.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import type { Adapter, Left } from '../src/adapter.ts';
import type { Job } from '../src/developer.ts';
import { cyclePaths, runDir } from '../src/layout.ts';
import { recover, type RecoverOptions } from '../src/recover.ts';
import { claude, cliAdapter, extensionSpec } from '../src/runtime/cli-adapter.ts';
import { readRun } from '../src/runtime/spawn.ts';
import { EventStore } from '../src/store.ts';
import { holder, kill } from './lock-holder.ts';
import { toStandardReview } from './scenarios.ts';
import { ownerCheck } from './workflows.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-recover-');
test.after(() => rmSync(dir, { recursive: true, force: true }));
process.env.XDG_CONFIG_HOME = join(dir, 'xdg');

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...a], { cwd, encoding: 'utf8' }).trim();
const src = (f: string) => JSON.stringify(join(import.meta.dirname, '..', 'src', f));
const fixture = join(import.meta.dirname, 'fixtures', 'fake-cli.ts');
const hasUserSystemd = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0;
const scoped = (t: TestContext) => (hasUserSystemd ? true : (t.skip('no user systemd'), false));

let n = 0;
/** A store with cycle c1 of work w1 in STANDARD_REVIEW and reviewer run sr1 started, with no outcome. */
function reviewing() {
  const root = join(dir, String(n++));
  mkdirSync(root, { recursive: true });
  const store = new EventStore(join(root, 'events.sqlite'));
  store.open('c1', 'w1');
  for (const e of toStandardReview) store.append('c1', e);
  store.append('c1', { type: 'run_started', runId: 'sr1', runtime: 'fake' });
  return { store, runsDir: join(root, 'runs') };
}

/** A scripted adapter whose `look` answers `left`; it records each call and refuses to start a run. */
function looking(left: Left) {
  const calls: { runId: string; runDir: string; stop: boolean }[] = [];
  const adapter: Adapter & { calls: typeof calls } = {
    name: 'fake',
    calls,
    start: () => { throw new Error('recover started a run'); },
    look: async (runId, dir, stop) => { calls.push({ runId, runDir: dir, stop }); return left; },
  };
  return adapter;
}

const job: Job = { workId: 'w1', ticket: 'x', repo: dir };
const options = (runsDir: string, extra: Partial<RecoverOptions> = {}): RecoverOptions => ({ runsDir, adopt: true, stop: false, deadlineMs: 10_000, sandbox: { backend: 'none' }, ...extra });
const pass = { status: 'completed' as const, claim: { head: 'H1', verdict: 'PASS', findings: [] } };

test('a finished reviewer run is received under its run ID; a second recover records nothing', async () => {
  const { store, runsDir } = reviewing();
  const a = looking({ state: 'finished', outcome: pass });
  const [r] = await recover(store, 'w1', (rt) => (rt === 'fake' ? a : undefined), job, options(runsDir));
  assert.deepEqual(r, { cycleId: 'c1', did: 'received', runId: 'sr1', stage: 'ADVERSARIAL_REVIEW' });
  assert.deepEqual(a.calls, [{ runId: 'sr1', runDir: runDir(runsDir, 'sr1'), stop: false }]);
  const last = store.events('c1').at(-1)!;
  assert.equal(last.type, 'verdict');
  assert.equal((last as { runId: string }).runId, 'sr1');
  assert.equal((last as { runtime?: string }).runtime, 'fake');
  const length = store.events('c1').length;
  assert.deepEqual(await recover(store, 'w1', () => a, job, options(runsDir)), [{ cycleId: 'c1', did: 'nothing', stage: 'ADVERSARIAL_REVIEW' }]);
  assert.equal(store.events('c1').length, length);
  store.close();
});

test('with adopt off, a finished run is run_failed and the cycle escalates (A-105 exactly)', async () => {
  const { store, runsDir } = reviewing();
  const [r] = await recover(store, 'w1', () => looking({ state: 'finished', outcome: pass }), job, options(runsDir, { adopt: false }));
  assert.deepEqual(r, { cycleId: 'c1', did: 'failed', runId: 'sr1', stage: 'ESCALATED' });
  assert.match(store.load('c1')!.escalation ?? '', /controller died; adoption is off/);
  store.close();
});

test('a running run is reported and left; with stop it is ended and run_failed', async () => {
  const { store, runsDir } = reviewing();
  const length = store.events('c1').length;
  assert.deepEqual(await recover(store, 'w1', () => looking({ state: 'running' }), job, options(runsDir)), [{ cycleId: 'c1', did: 'running', runId: 'sr1', stage: 'STANDARD_REVIEW' }]);
  assert.equal(store.events('c1').length, length);
  const a = looking({ state: 'stopped' });
  const [r] = await recover(store, 'w1', () => a, job, options(runsDir, { stop: true }));
  assert.equal(a.calls[0]!.stop, true);
  assert.deepEqual(r, { cycleId: 'c1', did: 'failed', runId: 'sr1', stage: 'ESCALATED' });
  assert.match(store.load('c1')!.escalation ?? '', /stopped by recover/);
  store.close();
});

test('a gone run, or one whose adapter cannot look, is run_failed and the cycle escalates', async () => {
  for (const a of [looking({ state: 'gone' }), { name: 'fake', start: () => { throw new Error('recover started a run'); } } as Adapter]) {
    const { store, runsDir } = reviewing();
    const [r] = await recover(store, 'w1', () => a, job, options(runsDir));
    assert.deepEqual(r, { cycleId: 'c1', did: 'failed', runId: 'sr1', stage: 'ESCALATED' });
    assert.match(store.load('c1')!.escalation ?? '', /controller died; the run left no exit/);
    store.close();
  }
});

test('a run whose runtime is not in the registry is refused, and nothing is recorded', async () => {
  const { store, runsDir } = reviewing();
  const length = store.events('c1').length;
  const [r] = await recover(store, 'w1', () => undefined, job, options(runsDir));
  assert.equal(r!.did, 'refused');
  assert.match(r!.reason ?? '', /run sr1: runtime fake is not in the registry/);
  assert.equal(store.events('c1').length, length);
  store.close();
});

test('a work held by a live process is reported locked with its PID, and nothing is recorded', async () => {
  const { store, runsDir } = reviewing();
  const child = await holder(runsDir, 'w1');
  try {
    const length = store.events('c1').length;
    assert.deepEqual(await recover(store, 'w1', () => looking({ state: 'gone' }), job, options(runsDir)), [{ cycleId: 'c1', did: 'locked', pid: child.pid }]);
    assert.equal(store.events('c1').length, length);
  } finally {
    await kill(child);
  }
  store.close();
});

test('a cycle the store cannot replay is reported, and the work\'s other cycle is still recovered', async () => {
  const root = join(dir, String(n++));
  mkdirSync(root, { recursive: true });
  const store = new EventStore(join(root, 'events.sqlite'));
  store.open('c0', 'w1');
  store.append('c0', { type: 'claim', runId: 'd0', base: 'B1', runtime: 'fake' });
  store.append('c0', { type: 'run_failed', runId: 'd0', reason: 'x' });
  store.open('c1', 'w1', 'c0');
  for (const e of toStandardReview) store.append('c1', e);
  store.append('c1', { type: 'run_started', runId: 'sr1', runtime: 'fake' });
  const db = new DatabaseSync(join(root, 'events.sqlite'));
  db.prepare("UPDATE events SET stage = 'ACCEPTED' WHERE cycle_id = 'c0' AND seq = 1").run();
  db.close();
  const out = await recover(store, 'w1', () => looking({ state: 'finished', outcome: pass }), job, options(join(root, 'runs')));
  assert.equal(out.length, 2);
  assert.equal(out[0]!.cycleId, 'c0');
  assert.equal(out[0]!.did, 'refused');
  assert.match(out[0]!.reason ?? '', /replays to/);
  assert.deepEqual(out[1], { cycleId: 'c1', did: 'received', runId: 'sr1', stage: 'ADVERSARIAL_REVIEW' });
  store.close();
});

test('cycles with no started run waiting, at VERIFYING, ESCALATED or settled, are left untouched and nothing is looked at', async () => {
  const root = join(dir, String(n++));
  mkdirSync(root, { recursive: true });
  const store = new EventStore(join(root, 'events.sqlite'));
  store.open('c1', 'w1');
  store.append('c1', toStandardReview[0]!);
  store.append('c1', toStandardReview[1]!);
  const a = looking({ state: 'gone' });
  assert.deepEqual(await recover(store, 'w1', () => a, job, options(join(root, 'runs'))), [{ cycleId: 'c1', did: 'nothing', stage: 'VERIFYING' }]);
  store.open('c2', 'w2');
  store.append('c2', { type: 'cancel' });
  assert.deepEqual(await recover(store, 'w2', () => a, job, options(join(root, 'runs'))), []);
  assert.deepEqual(a.calls, []);
  store.close();
});

// Killed controllers: a child process starts the run and SIGKILLs itself once the run is going.

/** A scratch repository with one commit, and where its store and runs go. */
function scratch() {
  const root = join(dir, String(n++));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'initial');
  return { repo, db: join(root, 'events.sqlite'), runsDir: join(root, 'runs'), base: git(repo, 'rev-parse', 'HEAD') };
}

/** Runs `body` in a child controller and waits for it to have SIGKILLed itself. */
function killedController(body: string, input: object): void {
  const script = `import { readFileSync } from 'node:fs';
const o = JSON.parse(readFileSync(0, 'utf8'));
${body}`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { input: JSON.stringify(input), timeout: 30_000, encoding: 'utf8' });
  assert.equal(r.signal, 'SIGKILL', `controller did not die as planned: ${r.stderr}`);
}

// The child dies once a run folder exists: the run has started and the controller is in `bounded`.
const DIE_WITH_A_RUN = `import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
setInterval(() => { const d = join(o.runsDir, 'runs'); if (existsSync(d) && readdirSync(d).length > 0) process.kill(process.pid, 'SIGKILL'); }, 20);`;

async function finished(dir: string): Promise<void> {
  for (const end = Date.now() + 15_000; Date.now() < end; await new Promise((res) => setTimeout(res, 50))) if (readRun(dir)) return;
  assert.fail(`the run in ${dir} never wrote exit`);
}

/** The fixture CLI behind a delay, so the controller dies while the run is going. */
const slow = (kase: string) => `sleep 1; exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)} claude ${kase}`;

for (const isolation of ['process-group', 'cgroup'] as const) {
  test(`${isolation}: a developer run that finished after its controller was SIGKILLed is received; its head lands on sf/<cycleId>`, async (t) => {
    if (isolation === 'cgroup' && !scoped(t)) return;
    const { repo, db, runsDir } = scratch();
    const j: Job = { workId: 'w1', ticket: 'Create done.txt and commit it.', repo };
    killedController(`import { develop } from ${src('developer.ts')};
import { EventStore } from ${src('store.ts')};
import { claude, cliAdapter } from ${src('runtime/cli-adapter.ts')};
${DIE_WITH_A_RUN}
develop(new EventStore(o.db), cliAdapter({ ...claude, command: 'sh', args: ['-c', o.shell] }, { isolation: o.isolation }), o.job, { deadlineMs: 20000, runsDir: o.runsDir, sandbox: { backend: 'none' } });`,
    { db, runsDir, job: j, shell: slow('commit'), isolation });
    const store = new EventStore(db);
    const [{ cycleId }] = store.cycles('w1');
    const runId = store.load(cycleId!)!.runs[0]!.runId;
    await finished(runDir(runsDir, runId));
    const parse = cliAdapter({ ...claude, command: 'false', args: [] }, { isolation });
    const [r] = await recover(store, 'w1', () => parse, j, options(runsDir));
    assert.deepEqual(r, { cycleId, did: 'received', runId, stage: 'VERIFYING' });
    const head = store.load(cycleId!)!.candidate!.head;
    assert.equal(git(repo, 'rev-parse', `refs/heads/sf/${cycleId}`), head);
    assert.deepEqual(await recover(store, 'w1', () => parse, j, options(runsDir)), [{ cycleId, did: 'nothing', stage: 'VERIFYING' }]);
    store.close();
  });

  test(`${isolation}: a reviewer run that finished after its controller was SIGKILLed is received as its verdict`, async (t) => {
    if (isolation === 'cgroup' && !scoped(t)) return;
    const { db, runsDir } = scratch();
    const seeded = new EventStore(db);
    seeded.open('c1', 'w1');
    for (const e of toStandardReview) seeded.append('c1', e);
    seeded.close();
    killedController(`import { execute } from ${src('controller.ts')};
import { EventStore } from ${src('store.ts')};
import { claude, cliAdapter } from ${src('runtime/cli-adapter.ts')};
${DIE_WITH_A_RUN}
execute(new EventStore(o.db), 'c1', cliAdapter({ ...claude, command: 'sh', args: ['-c', o.shell] }, { isolation: o.isolation }), { role: 'standard_reviewer', prompt: o.prompt, cwd: o.cwd }, { deadlineMs: 20000, runsDir: o.runsDir });`,
    { db, runsDir, cwd: dirname(db), shell: slow('echo-prompt'), isolation, prompt: '```json\n{"head":"H1","verdict":"PASS","findings":[]}\n```' });
    const store = new EventStore(db);
    const runId = store.load('c1')!.runs.at(-1)!.runId;
    await finished(runDir(runsDir, runId));
    const parse = () => cliAdapter({ ...claude, command: 'false', args: [] }, { isolation });
    const [r] = await recover(store, 'w1', parse, job, options(runsDir));
    assert.deepEqual(r, { cycleId: 'c1', did: 'received', runId, stage: 'ADVERSARIAL_REVIEW' });
    const length = store.events('c1').length;
    assert.deepEqual(await recover(store, 'w1', parse, job, options(runsDir)), [{ cycleId: 'c1', did: 'nothing', stage: 'ADVERSARIAL_REVIEW' }]);
    assert.equal(store.events('c1').length, length);
    store.close();
  });
}

for (const [left, adopt, reason] of [[undefined, true, /controller died; the run left no exit/], [{ state: 'stopped' }, true, /stopped by recover/], [{ state: 'finished', outcome: { status: 'completed', claim: {} } }, false, /adoption is off/]] as const) test(`a developer run failed by recover (${left?.state ?? 'gone'}${adopt ? '' : ', adopt off'}): the clone's branch tip is pinned under refs/sf-recovery/<runId>, then run_failed`, async () => {
  const { repo, db, runsDir, base } = scratch();
  const j: Job = { workId: 'w1', ticket: 'x', repo };
  // An in-process adapter: the run dies with its controller and leaves no folder (parked 05-b).
  killedController(`import { develop } from ${src('developer.ts')};
import { EventStore } from ${src('store.ts')};
develop(new EventStore(o.db), { name: 'gone', start: () => process.kill(process.pid, 'SIGKILL') }, o.job, { deadlineMs: 20000, runsDir: o.runsDir, sandbox: { backend: 'none' } });`,
  { db, runsDir, job: j });
  const store = new EventStore(db);
  const [{ cycleId }] = store.cycles('w1');
  const runId = store.load(cycleId!)!.runs[0]!.runId;
  assert.equal(existsSync(runDir(runsDir, runId)), false);
  const adapter: Adapter = left === undefined ? { name: 'gone', start: () => { throw new Error('recover started a run'); } } : looking(left as Left);
  const [r] = await recover(store, 'w1', () => adapter, j, options(runsDir, { adopt, stop: left?.state === 'stopped' }));
  assert.deepEqual(r, { cycleId, did: 'failed', runId, stage: 'ESCALATED' });
  assert.match(store.load(cycleId!)!.escalation ?? '', reason);
  assert.equal(git(cyclePaths(runsDir, cycleId!).clone, 'rev-parse', `refs/sf-recovery/${runId}`), base);
  assert.deepEqual(readdirSync(runsDir).filter((e) => e === 'runs'), []);
  store.close();
});

// Standard 1: a cycle a driver no longer runs is the owner's, whatever runs it still lists.
test('an ESCALATED cycle with a started run and no outcome is left untouched: nothing is looked at or recorded', async () => {
  const { store, runsDir } = reviewing();
  store.append('c1', { type: 'base_changed', base: 'B2' });
  assert.equal(store.load('c1')!.stage, 'ESCALATED');
  const length = store.events('c1').length;
  const a = looking({ state: 'finished', outcome: pass });
  for (let i = 0; i < 2; i++) assert.deepEqual(await recover(store, 'w1', () => a, job, options(runsDir, { stop: true })), [{ cycleId: 'c1', did: 'nothing', stage: 'ESCALATED' }]);
  assert.deepEqual(a.calls, []);
  assert.equal(store.events('c1').length, length);
  store.close();
});

test('a gone developer run with no clone is failed, and the result says no tip was pinned', async () => {
  const root = join(dir, String(n++));
  mkdirSync(root, { recursive: true });
  const store = new EventStore(join(root, 'events.sqlite'));
  store.open('c1', 'w1');
  store.append('c1', toStandardReview[0]!);
  const [r] = await recover(store, 'w1', () => looking({ state: 'gone' }), { ...job, repo: root }, options(join(root, 'runs')));
  assert.deepEqual(r, { cycleId: 'c1', did: 'failed', runId: 'dev1', stage: 'ESCALATED', reason: 'no branch tip pinned: no clone' });
  store.close();
});

test('a cycle whose recovery throws (an adapter that cannot be built, a workflow mismatch) is refused, and the work\'s other cycles still run', async () => {
  const root = join(dir, String(n++));
  mkdirSync(root, { recursive: true });
  const store = new EventStore(join(root, 'events.sqlite'));
  store.open('c0', 'w1');
  store.append('c0', toStandardReview[0]!);
  store.append('c0', { type: 'run_failed', runId: 'dev1', reason: 'x' });
  store.open('c1', 'w1', 'c0');
  for (const e of toStandardReview) store.append('c1', e);
  store.append('c1', { type: 'run_started', runId: 'sr1', runtime: 'fake' });
  const out = await recover(store, 'w1', () => { throw new Error('cgroup isolation needs systemd-run --user --scope'); }, job, options(join(root, 'runs')));
  assert.deepEqual(out, [{ cycleId: 'c0', did: 'nothing', stage: 'ESCALATED' }, { cycleId: 'c1', did: 'refused', reason: 'cgroup isolation needs systemd-run --user --scope' }]);
  store.close();
  // Opened under the default workflow, recovered by a store that runs another: each cycle is
  // refused with the mismatch, and nothing is looked at or recorded.
  const other = new EventStore(join(root, 'events.sqlite'), ownerCheck);
  const a = looking({ state: 'finished', outcome: pass });
  const mismatched = await recover(other, 'w1', () => a, job, options(join(root, 'runs')));
  assert.deepEqual(mismatched.map((r) => r.did), ['refused', 'refused']);
  assert.match(mismatched[1]!.reason ?? '', /was opened under workflow/);
  assert.deepEqual(a.calls, []);
  assert.equal(other.events('c1').length, toStandardReview.length + 1);
  other.close();
});

// 11-f adversarial minors 1 and 5 (11-f2): the run folder keeps what the launch knew, so recover
// records what the live controller would have: a timeout past the deadline, the module run.

/** Runs `adapter` as reviewer run sr1 to its end with no controller watching, leaving its folder. */
async function ranUnwatched(adapter: Adapter, runsDir: string, deadlineMs: number, prompt = '') {
  await adapter.start({ runId: 'sr1', role: 'standard_reviewer', prompt, cwd: dirname(runsDir), runDir: runDir(runsDir, 'sr1'), deadlineMs }, new AbortController().signal);
}

test('a run that finished past its deadline with no controller watching is recorded as a timeout, as a live controller would', async () => {
  const { store, runsDir } = reviewing();
  const prompt = '```json\n{"head":"H1","verdict":"PASS","findings":[]}\n```';
  // slow sleeps 1 s before the run answers: past a 300 ms deadline.
  await ranUnwatched(cliAdapter({ ...claude, command: 'sh', args: ['-c', slow('echo-prompt')] }, { isolation: 'process-group' }), runsDir, 300, prompt);
  const parse = cliAdapter({ ...claude, command: 'false', args: [] }, { isolation: 'process-group' });
  const [r] = await recover(store, 'w1', () => parse, job, options(runsDir));
  // Received: the outcome is the run's, a timeout, as the live controller's bound would give it.
  assert.deepEqual(r, { cycleId: 'c1', did: 'received', runId: 'sr1', stage: 'ESCALATED' });
  assert.match(store.load('c1')!.escalation ?? '', /run failed: timeout/);
  store.close();
});

test('an adopted outcome records the module hash the run was launched with, not the one at recovery', async () => {
  const { store, runsDir } = reviewing();
  const mod = join(dirname(runsDir), 'ext.ts');
  const answer = (note: string) => `// ${note}\nprocess.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ status: 'completed', claim: { head: 'H1', verdict: 'PASS', findings: [] } })));\n`;
  writeFileSync(mod, answer('as launched'));
  const launched = cliAdapter(extensionSpec('fake', mod), { isolation: 'process-group' });
  await ranUnwatched(launched, runsDir, 10_000);
  writeFileSync(mod, answer('edited while the controller was down'));
  const now = cliAdapter(extensionSpec('fake', mod), { isolation: 'process-group' });
  assert.notEqual(now.moduleHash, launched.moduleHash);
  const [r] = await recover(store, 'w1', () => now, job, options(runsDir));
  assert.deepEqual(r, { cycleId: 'c1', did: 'received', runId: 'sr1', stage: 'ADVERSARIAL_REVIEW' });
  assert.equal((store.events('c1').at(-1) as { moduleHash?: string }).moduleHash, launched.moduleHash);
  store.close();
});
