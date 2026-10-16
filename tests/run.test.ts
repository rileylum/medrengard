// Ticket 07-b: one job from nothing to a stage the loop cannot leave, through develop, verify,
// review, review, with one fix after a standard FAIL. Offline the fixture CLI plays the developer
// and scripted adapters the reviewers; live (RUNTIME_SPIKE=1) main.ts runs the real claude once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, RunRequest } from '../src/adapter.ts';
import { EventStore } from '../src/store.ts';
import { claude, cliAdapter, type CliSpec } from '../src/runtime/cli-adapter.ts';
import type { DeveloperAdapter, Job } from '../src/developer.ts';
import { run, type Adapters, type RunOptions } from '../src/run.ts';

const LIVE = process.env.RUNTIME_SPIKE === '1';
mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-run-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

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
  assert.deepEqual([r.cycle.standard, r.cycle.adversarial], [1, 1]);
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
  assert.deepEqual([r.cycle.standard, r.cycle.adversarial], [2, 1]);
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
    assert.deepEqual([r.cycle.standard, r.cycle.adversarial], [1, 1]);
    assert.match(r.cycle.escalation ?? '', /adversarial FAIL/);
    assert.deepEqual((r.cycle.history.at(-1)!.event as { findings?: string[] }).findings, ['[major] done.txt:1 — adversarial_reviewer finding']);
    store.close();
  }
  {
    const { repo, store, runsDir } = scratch();
    const adversarial = scripted('PASS');
    const r = await run(store, adapters(fake(claude), scripted('FAIL', 'FAIL'), adversarial), job(repo), opts(runsDir));
    assert.equal(r.cycle.stage, 'ESCALATED');
    assert.deepEqual([r.cycle.standard, r.cycle.adversarial], [2, 0]);
    assert.match(r.cycle.escalation ?? '', /second standard FAIL/);
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
  // A check name that is not a file stem: verify throws before it checks anything out.
  const r = await run(store, adapters(fake(claude), standard, scripted('PASS')), job(repo, { checks: [{ name: '../x', command: ['true'] }] }), opts(runsDir));
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
