// Ticket 07-b: one job from nothing to a stage the loop cannot leave, through develop, verify,
// review, review, with one fix after a standard FAIL. Offline the fixture CLI plays the developer
// and scripted adapters the reviewers; live (RUNTIME_SPIKE=1) main.ts runs the real claude once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Adapter, RunRequest } from '../src/adapter.ts';
import { EventStore } from '../src/store.ts';
import { claude, cliAdapter, type CliSpec } from '../src/runtime/cli-adapter.ts';
import type { DeveloperAdapter, Job } from '../src/developer.ts';
import { run, type Adapters, type RunOptions } from '../src/run.ts';
import { resume } from '../src/run.ts';
import { develop } from '../src/developer.ts';
import { checkWorkflow, type Workflow } from '../src/lifecycle.ts';
import { ownerCheck } from './workflows.ts';
import { reviewerStub } from './stub-cli.ts';

const LIVE = process.env.RUNTIME_SPIKE === '1';
mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-run-');
test.after(() => rmSync(dir, { recursive: true, force: true }));
// Every child inherits it: the owner's personal config (10-b) must never reach a test.
process.env.XDG_CONFIG_HOME = join(dir, 'xdg');

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...a], { cwd, encoding: 'utf8' }).trim();

const fixture = join(import.meta.dirname, 'fixtures', 'fake-cli.ts');
const fake = (spec: CliSpec, variant = 'ok') => cliAdapter({ ...spec, command: process.execPath, args: [fixture, spec.name, 'commit', variant] }, { isolation: 'process-group' });

let n = 0;
/** A scratch repository with one commit, a fresh store and a runs directory. */
function scratch() {
  const root = join(dir, String(n++));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  writeFileSync(join(repo, 'AGENTS.md'), '# Scratch rules\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'initial');
  const store = new EventStore(join(root, 'events.sqlite'));
  return { root, repo, store, runsDir: join(root, 'runs'), base: git(repo, 'rev-parse', 'HEAD') };
}
const job = (repo: string, extra: Partial<Job> = {}): Job => ({ workId: 'w1', ticket: 'Create done.txt and commit it.', repo, checks: [{ name: 'file', command: ['sh', '-c', 'test -f done.txt'] }], ...extra });
const opts = (runsDir: string, extra: Partial<RunOptions> = {}): RunOptions => ({ deadlineMs: 20_000, runsDir, isolation: 'process-group', ...extra });

/** A reviewer that answers each run with the next scripted verdict, for whatever candidate SHA the prompt names. */
function scripted(...verdicts: ('PASS' | 'FAIL')[]): Adapter & { requests: RunRequest[] } {
  const requests: RunRequest[] = [];
  return {
    name: 'scripted', requests,
    async start(req) {
      requests.push(req);
      const head = /^Candidate SHA: ([0-9a-f]{40})$/m.exec(req.prompt)?.[1] ?? 'no-sha';
      const v = verdicts.shift();
      if (!v) throw new Error('scripted reviewer: no verdict left');
      return { status: 'completed', claim: { head, verdict: v, findings: v === 'FAIL' ? [`[major] done.txt:1 — ${req.role} finding`] : [] } };
    },
  };
}
/** The fixture developer, with its prompts recorded. */
function recording(inner: Adapter): Adapter & { requests: RunRequest[] } {
  const requests: RunRequest[] = [];
  return { name: inner.name, requests, start(req, signal) { requests.push(req); return inner.start(req, signal); } };
}
const types = (store: EventStore, id: string) => store.events(id).map((e) => e.type);
const adapters = (developer: DeveloperAdapter, standard: Adapter, adversarial: Adapter): Adapters => ({ developer, standard, adversarial });

test('happy path: develop, verify, standard PASS, adversarial PASS end in AWAITING_ACCEPTANCE with the branch to merge', async () => {
  const { repo, store, runsDir, base } = scratch();
  const dev = recording(fake(claude));
  const standard = scripted('PASS');
  const adversarial = scripted('PASS');
  const r = await run(store, adapters(dev, standard, adversarial), job(repo), opts(runsDir));
  assert.equal(r.cycle.stage, 'AWAITING_ACCEPTANCE', r.cycle.escalation ?? r.error);
  assert.equal(r.error, undefined);
  assert.deepEqual([r.cycle.budgets.STANDARD_REVIEW ?? 0, r.cycle.budgets.ADVERSARIAL_REVIEW ?? 0], [1, 1]);
  assert.equal(r.cycle.runs.length, 1);
  assert.deepEqual(types(store, r.cycle.cycleId), ['claim', 'developer_result', 'verification', 'verdict', 'verdict']);
  assert.equal(r.branch, `sf/${r.cycle.cycleId}`);
  assert.equal(r.worktree, join(runsDir, r.cycle.cycleId));
  const head = r.cycle.candidate!.head;
  assert.equal(git(repo, 'rev-parse', r.branch), head);
  assert.equal(r.cycle.candidate!.base, base);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), base);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal(standard.requests[0]!.role, 'standard_reviewer');
  assert.equal(adversarial.requests[0]!.role, 'adversarial_reviewer');
  assert.match(adversarial.requests[0]!.prompt, new RegExp(`^Candidate SHA: ${head}$`, 'm'));
  assert.deepEqual(store.load(r.cycle.cycleId), r.cycle);
  store.close();
});

test('a standard FAIL runs the fix, verifies the new head and reviews it again: PASS PASS end in AWAITING_ACCEPTANCE with standard 2', async () => {
  const { repo, store, runsDir } = scratch();
  const dev = recording(fake(claude));
  const standard = scripted('FAIL', 'PASS');
  const adversarial = scripted('PASS');
  const r = await run(store, adapters(dev, standard, adversarial), job(repo), opts(runsDir));
  assert.equal(r.cycle.stage, 'AWAITING_ACCEPTANCE', r.cycle.escalation ?? r.error);
  assert.deepEqual([r.cycle.budgets.STANDARD_REVIEW ?? 0, r.cycle.budgets.ADVERSARIAL_REVIEW ?? 0], [2, 1]);
  assert.equal(r.cycle.runs.length, 2);
  assert.deepEqual(types(store, r.cycle.cycleId), ['claim', 'developer_result', 'verification', 'verdict', 'claim', 'developer_result', 'verification', 'verdict', 'verdict']);
  const [first, second] = store.events(r.cycle.cycleId).filter((e) => e.type === 'verification') as { head: string }[];
  const head = r.cycle.candidate!.head;
  assert.notEqual(first!.head, second!.head);
  assert.equal(second!.head, head);
  assert.equal(dev.requests.length, 2);
  assert.match(dev.requests[1]!.prompt, new RegExp(`commit ${first!.head} FAILED`));
  assert.match(dev.requests[1]!.prompt, /standard_reviewer finding/);
  assert.equal(standard.requests.length, 2);
  assert.match(standard.requests[1]!.prompt, new RegExp(`^Candidate SHA: ${head}$`, 'm'));
  assert.match(adversarial.requests[0]!.prompt, new RegExp(`^Candidate SHA: ${head}$`, 'm'));
  assert.equal(git(repo, 'rev-parse', r.branch), head);
  store.close();
});

test('an adversarial FAIL, a second standard FAIL and a failing check each stop in ESCALATED with the lifecycle counters', async () => {
  {
    const { repo, store, runsDir } = scratch();
    const r = await run(store, adapters(fake(claude), scripted('PASS'), scripted('FAIL')), job(repo), opts(runsDir));
    assert.equal(r.cycle.stage, 'ESCALATED');
    assert.equal(r.error, undefined);
    assert.deepEqual([r.cycle.budgets.STANDARD_REVIEW ?? 0, r.cycle.budgets.ADVERSARIAL_REVIEW ?? 0], [1, 1]);
    assert.match(r.cycle.escalation ?? '', /ADVERSARIAL_REVIEW FAIL/);
    assert.deepEqual((r.cycle.history.at(-1)!.event as { findings?: string[] }).findings, ['[major] done.txt:1 — adversarial_reviewer finding']);
    store.close();
  }
  {
    const { repo, store, runsDir } = scratch();
    const adversarial = scripted('PASS');
    const r = await run(store, adapters(fake(claude), scripted('FAIL', 'FAIL'), adversarial), job(repo), opts(runsDir));
    assert.equal(r.cycle.stage, 'ESCALATED');
    assert.deepEqual([r.cycle.budgets.STANDARD_REVIEW ?? 0, r.cycle.budgets.ADVERSARIAL_REVIEW ?? 0], [2, 0]);
    assert.match(r.cycle.escalation ?? '', /STANDARD_REVIEW FAIL at budget limit/);
    assert.equal(r.cycle.runs.length, 2);
    assert.equal(adversarial.requests.length, 0);
    store.close();
  }
  {
    const { repo, store, runsDir } = scratch();
    const standard = scripted('PASS');
    const r = await run(store, adapters(fake(claude), standard, scripted('PASS')), job(repo, { checks: [{ name: 'nope', command: ['sh', '-c', 'test -f missing.txt'] }] }), opts(runsDir));
    assert.equal(r.cycle.stage, 'ESCALATED');
    assert.match(r.cycle.escalation ?? '', /required check failed/);
    assert.deepEqual(types(store, r.cycle.cycleId), ['claim', 'developer_result', 'verification']);
    assert.equal(standard.requests.length, 0);
    store.close();
  }
});

test('a stage that throws escalates the cycle with reject_dispatch naming the stage, returns the error, and calls nothing after it', async () => {
  const { repo, store, runsDir } = scratch();
  const standard = scripted('PASS');
  // preflight refuses a bad check name before develop, so the job changes after it: verify keeps
  // its own check as a backstop and throws before it checks anything out.
  const j = job(repo);
  const inner = fake(claude);
  const developer: Adapter = { name: inner.name, async start(req, signal) { const r = await inner.start(req, signal); j.checks = [{ name: '../x', command: ['true'] }]; return r; } };
  const r = await run(store, adapters(developer, standard, scripted('PASS')), j, opts(runsDir));
  assert.equal(r.cycle.stage, 'ESCALATED');
  assert.match(r.error ?? '', /VERIFYING: .*not a file stem/);
  const last = r.cycle.history.at(-1)!.event;
  assert.equal(last.type, 'reject_dispatch');
  assert.match((last as { reason: string }).reason, /^VERIFYING: /);
  assert.match(r.cycle.escalation ?? '', /dispatch rejected: VERIFYING/);
  assert.deepEqual(types(store, r.cycle.cycleId), ['claim', 'developer_result', 'reject_dispatch']);
  assert.equal(standard.requests.length, 0);
  assert.ok(existsSync(r.worktree), 'the worktree is kept for the owner');
  assert.deepEqual(store.load(r.cycle.cycleId), r.cycle);
  store.close();
});

test('a develop failure propagates: develop cancelled what it opened and the loop has nothing to record', async () => {
  const { repo, store, runsDir } = scratch();
  await assert.rejects(run(store, adapters(fake(claude), scripted('PASS'), scripted('PASS')), job(repo, { base: 'no-such-ref' }), opts(runsDir)), /no-such-ref/);
  store.close();
});

// Ticket 08-a: the sandbox is checked before develop, so a job that could never verify spends no developer run.
test('a sandbox that cannot start throws before develop opens a cycle (08-a)', async () => {
  const { repo, store, runsDir } = scratch();
  const developer = recording(fake(claude));
  for (const sandbox of [{ backend: 'nope' }, { backend: 'bwrap', read: [join(runsDir, 'no-such-dir')] }]) {
    await assert.rejects(run(store, adapters(developer, scripted('PASS'), scripted('PASS')), job(repo), opts(runsDir, { sandbox: sandbox as RunOptions['sandbox'] })), /backend|does not exist/);
  }
  assert.equal(developer.requests.length, 0);
  assert.equal(git(repo, 'branch', '--list', 'sf/*'), '');
  store.close();
});

test('main.ts: the job file names the sandbox, read paths are relative to it, and a sandbox that cannot start exits 2 with nothing run (08-a)', () => {
  const { root, repo, runsDir } = scratch();
  const main = join(import.meta.dirname, '..', 'src', 'main.ts');
  // main.ts builds the real adapters by name. Stubs first on PATH: if the sandbox check ever
  // stops running before develop, the stub records the call instead of a paid claude run.
  const bin = join(root, 'bin');
  const called = join(root, 'cli-called');
  mkdirSync(bin);
  for (const cli of ['claude', 'pi']) {
    writeFileSync(join(bin, cli), `#!/bin/sh\ntouch ${called}\nexit 1\n`);
    chmodSync(join(bin, cli), 0o755);
  }
  const write = (sandbox: unknown) => {
    const jobFile = join(root, 'job.json');
    writeFileSync(jobFile, JSON.stringify({ workId: 'w-main', ticket: 'x', repo, runsDir, checks: [], runtime: { developer: 'claude', standard: 'claude', adversarial: 'claude' }, sandbox }));
    return spawnSync(process.execPath, [main, jobFile], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  };
  const relative = write({ backend: 'bwrap', read: ['tools'] });
  assert.equal(relative.status, 2, relative.stderr);
  assert.match(relative.stderr, new RegExp(`${join(root, 'tools')}.*does not exist`));
  assert.equal(relative.stdout, '');
  const unknown = write({ backend: 'docker' });
  assert.equal(unknown.status, 2, unknown.stderr);
  assert.match(unknown.stderr, /backend/);
  assert.equal(git(repo, 'branch', '--list', 'sf/*'), '');
  assert.ok(!existsSync(called), 'no runtime CLI was spawned');
});

test('main.ts prints the sandbox backend: bwrap by default, none only when the job file says so (08-a)', () => {
  const { root, repo, runsDir } = scratch();
  const main = join(import.meta.dirname, '..', 'src', 'main.ts');
  // A stub claude that fails at once: the developer run fails, the cycle escalates, main prints its summary.
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(bin, 'claude'), 0o755);
  for (const [n, sandbox, printed] of [[1, undefined, 'bwrap'], [2, { backend: 'none' }, 'none']] as const) {
    const jobFile = join(root, `job-${n}.json`);
    writeFileSync(jobFile, JSON.stringify({ workId: `w-print-${n}`, ticket: 'x', repo, runsDir, checks: [], runtime: { developer: 'claude', standard: 'claude', adversarial: 'claude' }, sandbox }));
    const r = spawnSync(process.execPath, [main, jobFile], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, new RegExp(`^Sandbox: ${printed}$`, 'm'));
  }
});

test('main.ts runs the developer in the job sandbox: bwrap by default, unconfined only with none (08-c)', () => {
  const { root, repo, runsDir } = scratch();
  const main = join(import.meta.dirname, '..', 'src', 'main.ts');
  // A stub claude that marks its cwd (the clone), tries to write beside the scratch root, and fails.
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch ran\ntouch ${root}/outside-$SF_N\nexit 1\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  for (const [n, sandbox, escaped] of [[1, undefined, false], [2, { backend: 'none' }, true]] as const) {
    const jobFile = join(root, `job-dev-${n}.json`);
    writeFileSync(jobFile, JSON.stringify({ workId: `w-dev-${n}`, ticket: 'x', repo, runsDir, checks: [], runtime: { developer: 'claude', standard: 'claude', adversarial: 'claude' }, sandbox }));
    const r = spawnSync(process.execPath, [main, jobFile], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, SF_N: String(n), PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.status, 1, r.stderr);
    const clone = /^Worktree: (.+)$/m.exec(r.stdout)![1]!;
    assert.ok(existsSync(join(clone, 'ran')), `the stub ran in the clone (${n})`);
    // Under bwrap the environment is cleared too, so the stub's own name for the file is outside-.
    assert.equal(existsSync(join(root, `outside-${n}`)) || existsSync(join(root, 'outside-')), escaped, `sandbox ${n}`);
  }
});

// Ticket 08-e: every reviewer call site in main.ts, both CLIs (08-d adversarial major).
test('main.ts runs both reviewers, claude or pi, in the job sandbox: bwrap by default, unconfined only with none (08-d, 08-e)', () => {
  const { root, repo, runsDir } = scratch();
  const main = join(import.meta.dirname, '..', 'src', 'main.ts');
  let n = 0;
  for (const role of ['standard', 'adversarial'] as const) {
    for (const cli of ['claude', 'pi'] as const) {
      for (const [sandbox, escaped] of [[undefined, false], [{ backend: 'none' }, true]] as const) {
        n++;
        const bin = join(root, `bin-${n}`);
        mkdirSync(bin);
        const outside = join(root, `outside-${n}`);
        // The developer is always claude; the reviewer under test is `cli` in `role`, the other one claude.
        reviewerStub(bin, 'claude', `${role} reviewer`, outside);
        if (cli === 'pi') reviewerStub(bin, 'pi', `${role} reviewer`, outside);
        const runtime = { developer: 'claude', standard: role === 'standard' ? cli : 'claude', adversarial: role === 'adversarial' ? cli : 'claude' };
        const jobFile = join(root, `job-rev-${n}.json`);
        writeFileSync(jobFile, JSON.stringify({ workId: `w-rev-${n}`, ticket: 'x', repo, runsDir: join(runsDir, `r${n}`), checks: [{ name: 'ok', command: ['true'] }], runtime, sandbox }));
        const r = spawnSync(process.execPath, [main, jobFile], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
        const label = `${role} ${cli} ${sandbox ? 'none' : 'bwrap'}: ${r.stdout}${r.stderr}`;
        assert.equal(r.status, 1, label);
        assert.match(r.stdout, /^Stage: ESCALATED$/m, label);
        // The reviewer under test ran: the one before it passed, and its own failure is the escalation.
        assert.match(r.stdout, role === 'standard' ? /^Reviews: standard 0, adversarial 0$/m : /^Reviews: standard 1, adversarial 0$/m, label);
        assert.match(r.stdout, /^Escalation: run failed: /m, label);
        // The CLI named in the job ran, not the other one built in its place (08-e adversarial note).
        assert.match(r.stdout, new RegExp(`stub ${cli} as the ${role} reviewer`), label);
        // In bwrap the stub's write was refused by the read-only root; with none it landed.
        if (!escaped) assert.match(r.stdout, /touch: .*Read-only file system/, label);
        assert.equal(existsSync(outside), escaped, label);
      }
    }
  }
});

// One live run of main.ts: claude as developer and both reviewers, four paid calls, 120 s per stage.
test('live main.ts: a job file runs end to end and prints the stage, branch and head', { timeout: 560_000 }, (t) => {
  if (!LIVE) return void t.skip('RUNTIME_SPIKE is not set');
  const { root, repo, runsDir } = scratch();
  const jobFile = join(root, 'job.json');
  writeFileSync(jobFile, JSON.stringify({
    workId: 'live-1',
    ticket: 'Create a file named HELLO.md containing exactly the line "hello from the factory" and commit it with the message "add HELLO.md".',
    repo, runsDir, deadlineMs: 120_000,
    checks: [{ name: 'hello', command: ['sh', '-c', 'test "$(cat HELLO.md)" = "hello from the factory"'] }],
    runtime: { developer: 'claude', standard: 'claude', adversarial: 'claude' },
  }));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts'), jobFile], { encoding: 'utf8', timeout: 550_000 });
  // The scratch tree is deleted after the run; the printed summary is the record of what the real CLIs did.
  t.diagnostic(r.stdout);
  const stage = /^Stage: (\S+)/m.exec(r.stdout)?.[1];
  assert.ok(stage === 'AWAITING_ACCEPTANCE' || stage === 'ESCALATED', `${r.stdout}\n${r.stderr}`);
  assert.ok(!/^Error: /m.test(r.stdout), r.stdout);
  assert.match(r.stdout, /^Branch: sf\//m);
  assert.match(r.stdout, /^Head: [0-9a-f]{40}$/m);
  assert.match(r.stdout, /^Sandbox: bwrap$/m);
  assert.match(r.stdout, /standard_reviewer .*(PASS|FAIL)/);
  assert.equal(r.status, stage === 'AWAITING_ACCEPTANCE' ? 0 : 1, r.stdout);
});

// Ticket 09-b: the driver runs any workflow by step kind, resumes from a stored stage, and bounds
// its loop by the workflow's budgets.
/** scratch(), with the store running `w`. */
function scratchUnder(w: Workflow) {
  const s = scratch();
  s.store.close();
  return { ...s, store: new EventStore(join(s.root, 'events-wf.sqlite'), w) };
}

test('another workflow runs from open to its own human stage, with its own role names', async () => {
  const { repo, store, runsDir } = scratchUnder(ownerCheck);
  const writer = recording(fake(claude));
  const reviewer = scripted('PASS');
  const r = await run(store, { writer, reviewer }, job(repo), opts(runsDir));
  assert.equal(r.cycle.stage, 'OWNER', r.cycle.escalation);
  assert.equal(r.error, undefined);
  assert.deepEqual(types(store, r.cycle.cycleId), ['claim', 'developer_result', 'verification', 'verdict']);
  assert.deepEqual(reviewer.requests.map((q) => q.role), ['reviewer']);
  assert.deepEqual(writer.requests.map((q) => q.role), ['writer']);
  store.close();
});

test('another workflow: a FAIL at its only review escalates naming the stage', async () => {
  const { repo, store, runsDir } = scratchUnder(ownerCheck);
  const r = await run(store, { writer: fake(claude), reviewer: scripted('FAIL') }, job(repo), opts(runsDir));
  assert.equal(r.cycle.stage, 'ESCALATED');
  assert.match(r.cycle.escalation ?? '', /^REVIEW FAIL/);
  store.close();
});

test('a role with no adapter is refused before any cycle opens or any run starts', async () => {
  const { repo, store, runsDir } = scratchUnder(ownerCheck);
  const writer = recording(fake(claude));
  await assert.rejects(run(store, { writer }, job(repo), opts(runsDir)), /no adapter for role reviewer/);
  assert.deepEqual(store.cycles('w1'), []);
  assert.equal(writer.requests.length, 0);
  store.close();
});

test('resume on a cycle left at VERIFYING runs the checks and continues, with no developer run', async () => {
  const { repo, store, runsDir } = scratch();
  const dev = recording(fake(claude));
  const opened = await develop(store, dev, job(repo), opts(runsDir));
  assert.equal(opened.cycle.stage, 'VERIFYING', opened.cycle.escalation);
  const before = store.events(opened.cycle.cycleId).length;
  const r = await resume(store, opened.cycle.cycleId, adapters(dev, scripted('PASS'), scripted('PASS')), job(repo), opts(runsDir));
  assert.equal(r.cycle.stage, 'AWAITING_ACCEPTANCE', r.cycle.escalation);
  assert.equal(dev.requests.length, 1);
  assert.equal(types(store, r.cycle.cycleId)[before], 'verification');
  assert.equal(r.branch, opened.branch);
  assert.equal(r.worktree, opened.worktree);
  store.close();
});

test('resume refuses an unknown cycle, and returns a settled one without a step', async () => {
  const { repo, store, runsDir } = scratch();
  const none = adapters(fake(claude), scripted(), scripted());
  await assert.rejects(resume(store, 'nope', none, job(repo), opts(runsDir)), /not open/);
  store.open('c1', 'w1');
  store.append('c1', { type: 'cancel' });
  const r = await resume(store, 'c1', none, job(repo), opts(runsDir));
  assert.equal(r.cycle.stage, 'CANCELLED');
  assert.equal(store.events('c1').length, 1);
  store.close();
});

test('the step cap comes from the budgets: five fix loops run past the old cap of 10', async () => {
  const loop: Workflow = { ...ownerCheck, stages: { ...ownerCheck.stages, REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 6, transitions: { PASS: 'OWNER', FAIL: 'DEV' } } } };
  const { repo, store, runsDir } = scratchUnder(loop);
  // A new commit per run: the fixture CLI writes the same file for every fix, which the head guard refuses.
  let n = 0;
  const writer: Adapter = {
    name: 'counter',
    async start(req) {
      writeFileSync(join(req.cwd, 'done.txt'), `${n++}\n`);
      git(req.cwd, 'add', 'done.txt');
      git(req.cwd, 'commit', '-q', '-m', `run ${n}`);
      return { status: 'completed', claim: { head: git(req.cwd, 'rev-parse', 'HEAD'), artifacts: ['done.txt'] } };
    },
  };
  const r = await run(store, { writer, reviewer: scripted('FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'PASS') }, job(repo), opts(runsDir));
  assert.equal(r.cycle.stage, 'OWNER', r.cycle.escalation);
  assert.equal(n, 6);
  store.close();
});

// Ticket 10-c: run hands verify the workflow's folder, and refuses before a paid run without one.
test('a workflow whose command names a file runs it from workflowDir, and without one run throws before the developer starts', async () => {
  const { root, repo, runsDir } = scratch();
  const workflow = {
    name: 'with-file',
    start: 'DEV',
    stages: {
      DEV: { kind: 'agent', role: 'developer', produces: 'commit', roleText: 'You are the developer for the ticket below.', transitions: { PASS: 'LINT' } },
      LINT: { kind: 'command', run: [{ name: 'lint', command: ['sh', { file: 'lint.sh' }] }], transitions: { PASS: 'REVIEW' } },
      REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 1, transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
    },
  } as Workflow;
  const store = new EventStore(join(root, 'with-file.sqlite'), workflow);
  const developer = recording(fake(claude));
  const roles = { developer, reviewer: scripted('PASS') };
  await assert.rejects(run(store, roles, job(repo), opts(runsDir)), /LINT names file lint\.sh, but its workflow has no file of its own/);
  assert.equal(developer.requests.length, 0);
  const workflowDir = join(root, 'flow');
  mkdirSync(workflowDir);
  writeFileSync(join(workflowDir, 'lint.sh'), 'test -f done.txt\n');
  const r = await run(store, roles, job(repo), opts(runsDir, { workflowDir }));
  assert.equal(r.cycle.stage, 'ACCEPTED', r.cycle.escalation);
  const verification = store.events(r.cycle.cycleId).find((e) => e.type === 'verification');
  assert.deepEqual(verification?.type === 'verification' && verification.checks, [{ name: 'lint', result: 'PASS', files: { 'lint.sh': '2519cce2e2d7067d7dcc0dedd9b84ff22cb16549fa711c659336e20c880795c7' } }]);
  store.close();
});

// Ticket 10-e: a grant's value reaches its stage's sandbox alone (A-074, A-083).
const TOKEN = 'sf-grant-value-5d1e';
const NODE_PREFIX = dirname(dirname(realpathSync(process.execPath)));
// Reads the request inside the sandbox, as a user's merge command would.
const merge = (script: string) => ({ name: 'merge', command: [process.execPath, '-e', `const fs = require('node:fs'); const r = JSON.parse(fs.readFileSync(process.env.SF_REQUEST, 'utf8')); ${script}`] });
const WRITES_HEAD = `fs.writeFileSync(r.outputDir + '/head', r.head + '\\n');`;
/** DEV, CHECK, REVIEW, then MERGE holding the github grant. */
const granted = (mergeRun = [merge(WRITES_HEAD)], extra: object = {}, tokenFile = '/nonexistent') => ({
  name: 'granted',
  start: 'DEV',
  stages: {
    DEV: { kind: 'agent', role: 'developer', produces: 'commit', roleText: 'You are the developer for the ticket below.', transitions: { PASS: 'CHECK' } },
    CHECK: { kind: 'command', run: [{ name: 'env', command: ['sh', '-c', 'env; ls -la /proc/self/'] }], transitions: { PASS: 'REVIEW' } },
    REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 1, transitions: { PASS: 'MERGE', FAIL: 'ESCALATED' } },
    MERGE: { kind: 'command', run: mergeRun, network: true, grants: ['github'], transitions: { PASS: 'LATER' }, ...extra },
    // After the grant stage: a leak into a later sandbox would show here.
    LATER: { kind: 'command', run: [{ name: 'env', command: ['sh', '-c', 'env; cat "$0" || echo unreadable', tokenFile] }], transitions: { PASS: 'ACCEPTED' } },
  },
}) as Workflow;
/** A token file outside the repository, and the grants a personal file would give. */
function grantFile(root: string) {
  const file = join(root, 'gh-token');
  writeFileSync(file, `${TOKEN}\n`);
  return { github: { variable: 'GH_TOKEN', file } };
}
/** An adapter that records whether the controller's environment held the token when it started. */
function envWatch(inner: Adapter): Adapter & { requests: RunRequest[]; sawToken: boolean[] } {
  const requests: RunRequest[] = [];
  const sawToken: boolean[] = [];
  return { name: inner.name, requests, sawToken, start(req, signal) { requests.push(req); sawToken.push(Object.values(process.env).some((v) => v?.includes(TOKEN))); return inner.start(req, signal); } };
}

test('only the grant stage sees the grant: not the developer, the check stage or the reviewer, and never the evidence', async () => {
  const { root, repo, runsDir } = scratch();
  const grants = grantFile(root);
  const store = new EventStore(join(root, 'granted.sqlite'), granted([merge(`${WRITES_HEAD} fs.writeFileSync(r.outputDir + '/token', process.env.GH_TOKEN); console.log('token is ' + process.env.GH_TOKEN);`)], {}, grants.github.file));
  const developer = envWatch(fake(claude));
  const reviewer = envWatch(scripted('PASS'));
  const r = await run(store, { developer, reviewer }, job(repo), opts(runsDir, { isolation: 'cgroup', sandbox: { backend: 'bwrap', read: [NODE_PREFIX] }, grants }));
  assert.equal(r.cycle.stage, 'ACCEPTED', r.cycle.escalation);
  const head = r.cycle.candidate!.head;
  const evidence = join(runsDir, 'evidence', head);
  // Delivered: the command wrote what it was given to output/, which is not redacted.
  assert.equal(readFileSync(join(evidence, 'MERGE', 'output', 'token'), 'utf8'), TOKEN);
  assert.equal(readFileSync(join(evidence, 'MERGE', 'merge.stdout'), 'utf8'), 'token is [grant github]\n');
  for (const stage of ['CHECK', 'LATER']) {
    const seen = readFileSync(join(evidence, stage, 'env.stdout'), 'utf8');
    assert.ok(!seen.includes(TOKEN) && !seen.includes('GH_TOKEN'), `${stage}: ${seen}`);
  }
  assert.match(readFileSync(join(evidence, 'LATER', 'env.stdout'), 'utf8'), /^unreadable$/m, 'the token file is not bound into another sandbox');
  assert.deepEqual([...developer.sawToken, ...reviewer.sawToken], [false, false]);
  assert.ok(!reviewer.requests[0]!.prompt.includes(TOKEN));
  assert.ok(!Object.values(process.env).some((v) => v?.includes(TOKEN)), 'the controller environment never holds it');
  const merged = r.cycle.history.find((h) => h.from === 'MERGE')?.event;
  assert.deepEqual(merged?.type === 'verification' && merged.grants, ['github']);
  assert.ok(!JSON.stringify(store.events(r.cycle.cycleId)).includes(TOKEN));
  store.close();
});

test('run refuses a grant the configuration does not give, and any grant under none, before the developer starts (A-083 Q2)', async () => {
  const { root, repo, runsDir } = scratch();
  const store = new EventStore(join(root, 'granted.sqlite'), granted());
  const developer = envWatch(fake(claude));
  const roles = { developer, reviewer: scripted('PASS') };
  await assert.rejects(run(store, roles, job(repo), opts(runsDir)), /stage MERGE asks for grant github, which no personal or job file gives/);
  await assert.rejects(run(store, roles, job(repo), opts(runsDir, { grants: { npm: grantFile(root).github } })), /stage MERGE asks for grant github/);
  await assert.rejects(run(store, roles, job(repo), opts(runsDir, { sandbox: { backend: 'none' }, grants: grantFile(root) })), /stage MERGE holds a grant, which sandbox backend none cannot confine/);
  // One value would silently replace the other.
  const twice = new EventStore(join(root, 'twice.sqlite'), granted(undefined, { grants: ['github', 'npm'] }));
  await assert.rejects(run(twice, roles, job(repo), opts(runsDir, { grants: { ...grantFile(root), npm: grantFile(root).github } })), /stage MERGE: grants github and npm both set GH_TOKEN/);
  twice.close();
  assert.equal(developer.requests.length, 0);
  assert.deepEqual(store.cycles('w1'), []);
  store.close();
});

// sweep-preflight: what a later step would refuse after a paid developer run is refused before it,
// by run and by resume alike.
const writer = (transitions: object) => ({ ...ownerCheck.stages.DEV, transitions }) as Workflow['stages'][string];
const unrunnable: [string, Workflow, RegExp][] = [
  ['a check FAIL back to the developer', { ...ownerCheck, stages: { ...ownerCheck.stages, CHECK: { kind: 'command', budget: 2, transitions: { PASS: 'REVIEW', FAIL: 'DEV' } } } },
    /stage CHECK FAIL enters commit stage DEV/],
  ['a human FAIL back to the developer', { ...ownerCheck, stages: { ...ownerCheck.stages, OWNER: { kind: 'human', transitions: { PASS: 'ACCEPTED', FAIL: 'DEV' } } } },
    /stage OWNER FAIL enters commit stage DEV/],
  ['a second commit stage entered by PASS', { ...ownerCheck, stages: { ...ownerCheck.stages, DEV: writer({ PASS: 'DOCS' }), DOCS: writer({ PASS: 'CHECK' }) } },
    /stage DEV PASS enters commit stage DOCS/],
  ['a review PASS back to the developer', { ...ownerCheck, stages: { ...ownerCheck.stages, REVIEW: { ...ownerCheck.stages.REVIEW, transitions: { PASS: 'DEV', FAIL: 'ESCALATED' } } as Workflow['stages'][string] } },
    /stage REVIEW PASS enters commit stage DEV/],
  ['a review with no command stage before it', { ...ownerCheck, stages: { ...ownerCheck.stages, DEV: writer({ PASS: 'REVIEW' }) } },
    /review stage REVIEW follows commit stage DEV with no command stage between/],
];

test('run refuses a workflow shape the driver cannot run, before the developer starts, though checkWorkflow passes it', async () => {
  const { root, repo, runsDir } = scratch();
  const developer = recording(fake(claude));
  for (const [label, w, reason] of unrunnable) {
    assert.deepEqual(checkWorkflow(w), [], label);
    const store = new EventStore(join(root, `${label}.sqlite`), w);
    await assert.rejects(run(store, { writer: developer, reviewer: scripted('PASS') }, job(repo), opts(runsDir)), reason, label);
    assert.deepEqual(store.cycles('w1'), [], label);
    store.close();
  }
  assert.equal(developer.requests.length, 0);
});

test('run refuses a job check verify would refuse, before the developer starts', async () => {
  const { repo, store, runsDir } = scratch();
  const developer = recording(fake(claude));
  const bad: [Job['checks'], RegExp][] = [
    [[{ name: '../x', command: ['true'] }], /check name "\.\.\/x" is not a file stem/],
    [[{ name: 'tree', command: ['true'] }], /check name tree is reserved/],
    [[{ name: 'a', command: ['true'] }, { name: 'a', command: ['true'] }], /check name a is declared twice/],
    [[{ name: 'a', command: ['true', 1 as unknown as string] }], /check a: every argument must be a string/],
  ];
  for (const [checks, reason] of bad)
    await assert.rejects(run(store, adapters(developer, scripted('PASS'), scripted('PASS')), job(repo, { checks }), opts(runsDir)), reason);
  assert.equal(developer.requests.length, 0);
  assert.deepEqual(store.cycles('w1'), []);
  store.close();
});

test('run refuses a check program that is not installed or is outside the sandbox, job or stage, before the developer starts', async () => {
  const { root, repo, store, runsDir } = scratch();
  const developer = recording(fake(claude));
  const roles = adapters(developer, scripted('PASS'), scripted('PASS'));
  await assert.rejects(run(store, roles, job(repo, { checks: [{ name: 'lint', command: ['sf-no-such-program-7c1d', '.'] }] }), opts(runsDir)),
    /stage VERIFYING check lint: sf-no-such-program-7c1d not found/);
  // Found on PATH, but in a folder the sandbox does not bind: inside it would not run.
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'sf-outside-7c1d'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'sf-outside-7c1d'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    await assert.rejects(run(store, roles, job(repo, { checks: [{ name: 'lint', command: ['sf-outside-7c1d'] }] }), opts(runsDir)),
      new RegExp(`stage VERIFYING check lint: sf-outside-7c1d resolves to ${bin}/sf-outside-7c1d, outside the sandbox; add its directory to sandbox.read`));
  } finally {
    process.env.PATH = path;
  }
  const own = new EventStore(join(root, 'own.sqlite'), { ...ownerCheck, stages: { ...ownerCheck.stages, CHECK: { kind: 'command', run: [{ name: 'fmt', command: ['sf-no-such-program-7c1d'] }], transitions: { PASS: 'REVIEW' } } } });
  await assert.rejects(run(own, { writer: developer, reviewer: scripted('PASS') }, job(repo), opts(runsDir)), /stage CHECK check fmt: sf-no-such-program-7c1d not found/);
  own.close();
  assert.equal(developer.requests.length, 0);
  assert.deepEqual(store.cycles('w1'), []);
  store.close();
});

test('resume refuses what run refuses before a step: a missing grant, no workflowDir, a shape the driver cannot run', async () => {
  const { root, repo, base, runsDir } = scratch();
  const withFile = { ...ownerCheck, stages: { ...ownerCheck.stages, CHECK: { kind: 'command', run: [{ name: 'lint', command: ['sh', { file: 'lint.sh' }] }], transitions: { PASS: 'REVIEW' } } } } as Workflow;
  const cases: [Workflow, Adapters, RegExp][] = [
    [granted(), { developer: fake(claude), reviewer: scripted() }, /stage MERGE asks for grant github, which no personal or job file gives/],
    [withFile, { writer: fake(claude), reviewer: scripted() }, /CHECK names file lint\.sh, but its workflow has no file of its own/],
    [unrunnable[0]![1], { writer: fake(claude), reviewer: scripted() }, unrunnable[0]![2]],
  ];
  for (const [i, [w, roles, reason]] of cases.entries()) {
    const store = new EventStore(join(root, `resume-${i}.sqlite`), w);
    store.open('c1', 'w1', undefined, base);
    // In DEV with a run active, as a crash mid-develop would leave it.
    store.append('c1', { type: 'claim', runId: 'r1', base, runtime: 'fake' });
    await assert.rejects(resume(store, 'c1', roles, job(repo), opts(runsDir)), reason);
    assert.equal(store.events('c1').length, 1);
    store.close();
  }
});
