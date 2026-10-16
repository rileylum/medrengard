// Ticket 05-a: one READY ticket in a scratch repository produces a commit in an isolated
// worktree, observed through develop()'s return value and store.load(). Offline the fixture CLI
// plays the developer; live (RUNTIME_SPIKE=1) the real claude and pi do, once each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventStore } from '../src/store.ts';
import { claude, claudeDeveloper, cliAdapter, pi, piDeveloper, type CliSpec } from '../src/runtime/cli-adapter.ts';
import { develop, type Job } from '../src/developer.ts';
import { fakeAdapter } from './fake-adapter.ts';

const LIVE = process.env.RUNTIME_SPIKE === '1';
// On disk, not tmpdir(): /tmp is RAM-backed here and worktrees must never land there.
mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-developer-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...a], { cwd, encoding: 'utf8' }).trim();

let n = 0;
/** A scratch repository with one commit, a fresh store and a runs directory. */
function scratch() {
  const root = join(dir, String(n++));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'initial');
  const store = new EventStore(join(root, 'events.sqlite'));
  return { repo, store, runsDir: join(root, 'runs'), base: git(repo, 'rev-parse', 'HEAD') };
}

const fixture = join(import.meta.dirname, 'fixtures', 'fake-cli.ts');
const fake = (spec: CliSpec, variant = 'ok') => cliAdapter({ ...spec, command: process.execPath, args: [fixture, spec.name, 'commit', variant] }, { isolation: 'process-group' });
const job = (repo: string, extra: Partial<Job> = {}): Job => ({ workId: 'w1', ticket: 'Create done.txt and commit it.', repo, ...extra });

for (const spec of [claude, pi]) {
  test(`${spec.name} fixture: develop opens a cycle, makes a worktree from the base and reaches VERIFYING on the committed head`, async () => {
    const { repo, store, runsDir, base } = scratch();
    const { cycle, worktree, branch } = await develop(store, fake(spec), job(repo), { deadlineMs: 20_000, runsDir });
    assert.equal(cycle.stage, 'VERIFYING', cycle.escalation);
    assert.equal(worktree, join(runsDir, cycle.cycleId));
    assert.equal(branch, `sf/${cycle.cycleId}`);
    assert.equal(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), branch);
    assert.deepEqual(cycle.candidate, { head: git(worktree, 'rev-parse', 'HEAD'), base });
    assert.notEqual(cycle.candidate!.head, base);
    assert.equal(cycle.runs[0]!.runtime, spec.name);
    assert.equal(cycle.runs[0]!.runId, (store.events(cycle.cycleId)[0] as { runId: string }).runId);
    assert.deepEqual(store.load(cycle.cycleId), cycle);
    // The branch is visible from the repository; its HEAD and working tree are untouched.
    assert.equal(git(repo, 'rev-parse', branch), cycle.candidate!.head);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), base);
    assert.equal(git(repo, 'status', '--porcelain'), '');
    assert.ok(existsSync(join(worktree, 'done.txt')));
    store.close();
  });
}

test('job.base selects the commit the worktree starts from, not the repository HEAD', async () => {
  const { repo, store, runsDir, base } = scratch();
  writeFileSync(join(repo, 'later.txt'), 'later\n');
  git(repo, 'add', 'later.txt');
  git(repo, 'commit', '-q', '-m', 'later');
  const { cycle, worktree } = await develop(store, fake(claude), job(repo, { base }), { deadlineMs: 20_000, runsDir });
  assert.equal(cycle.stage, 'VERIFYING', cycle.escalation);
  assert.equal(cycle.candidate!.base, base);
  assert.equal(git(worktree, 'rev-parse', 'HEAD~1'), base);
  assert.ok(!existsSync(join(worktree, 'later.txt')));
  store.close();
});

test('a claim whose head is not the branch tip, the base, unknown, or abbreviated escalates and names the SHA', async () => {
  for (const variant of ['first', 'base', 'nocommit', 'bogus', 'short', 'empty', 'orphan']) {
    const { repo, store, runsDir } = scratch();
    const { cycle, worktree } = await develop(store, fake(claude, variant), job(repo), { deadlineMs: 20_000, runsDir });
    assert.equal(cycle.stage, 'ESCALATED', variant);
    const last = cycle.history.at(-1)!.event;
    assert.equal(last.type, 'run_failed', variant);
    const claimed = variant === 'bogus' ? 'a'.repeat(40) : variant === 'short' ? git(worktree, 'rev-parse', 'HEAD').slice(0, 7) : variant === 'first' || variant === 'base' ? git(worktree, 'rev-parse', 'HEAD~1') : git(worktree, 'rev-parse', 'HEAD');
    assert.match(cycle.escalation ?? '', new RegExp(`run failed: commit ${claimed}`), variant);
    if (variant === 'short') assert.match(cycle.escalation ?? '', /not the full SHA/);
    if (variant === 'empty') assert.match(cycle.escalation ?? '', /no changes against the base/);
    if (variant === 'orphan') assert.match(cycle.escalation ?? '', /not descended from the base/);
    store.close();
  }
});

test('develop refuses a second open cycle for the work and an unknown base before anything is launched', async () => {
  const { repo, store, runsDir } = scratch();
  const adapter = fakeAdapter('hang');
  const first = develop(store, adapter, job(repo), { deadlineMs: 500, runsDir });
  // Wait for the first run to be claimed, then the second must be refused by open, not by apply.
  await new Promise((r) => setTimeout(r, 100));
  await assert.rejects(develop(store, fakeAdapter('hang'), job(repo), { deadlineMs: 500, runsDir }), /already has an open cycle/);
  assert.equal(readdirSync(runsDir).length, 1);
  assert.equal(adapter.requests.length, 1);
  const { cycle } = await first;
  assert.equal(cycle.stage, 'ESCALATED');
  await assert.rejects(develop(store, fakeAdapter('hang'), job(repo, { workId: 'w2', base: 'no-such-ref' }), { deadlineMs: 500, runsDir }), /no-such-ref/);
  assert.equal(readdirSync(runsDir).length, 1);
  store.close();
});

test('a worktree that cannot be made cancels the cycle it opened, so the work is not blocked', async () => {
  const { repo, store, runsDir } = scratch();
  writeFileSync(runsDir, 'not a directory\n');
  const adapter = fakeAdapter('hang');
  await assert.rejects(develop(store, adapter, job(repo), { deadlineMs: 500, runsDir }), /EEXIST|git worktree add/);
  assert.equal(adapter.requests.length, 0);
  // The cycle it opened is CANCELLED, not left QUEUED behind the one-open-cycle guard: the next
  // develop for the same work must open.
  rmSync(runsDir);
  const { cycle } = await develop(store, fake(claude), job(repo), { deadlineMs: 20_000, runsDir });
  assert.equal(cycle.stage, 'VERIFYING', cycle.escalation);
  store.close();
});

test('the prompt carries the ticket, the branch rules and the claim instruction; cwd is the worktree', async () => {
  const { repo, store, runsDir } = scratch();
  const adapter = fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['r'] } } });
  const { cycle, worktree } = await develop(store, adapter, job(repo, { ticket: 'TICKET BODY HERE' }), { deadlineMs: 5000, runsDir });
  const [req] = adapter.requests;
  assert.equal(req!.cwd, worktree);
  assert.equal(req!.role, 'developer');
  assert.match(req!.prompt, /TICKET BODY HERE/);
  assert.match(req!.prompt, /```json\n\{"head": "<full commit sha>", "artifacts": \["<paths>"\]\}\n```/);
  assert.match(req!.prompt, /do not push/i);
  // 'H1' is not a commit: the accept hook escalates it.
  assert.equal(cycle.stage, 'ESCALATED');
  assert.match(cycle.escalation ?? '', /commit H1 /);
  store.close();
});

test('developer specs: claude gets a worktree-scoped allow list, pi gets its tools back', () => {
  const c = claudeDeveloper('/var/tmp/x/wt');
  assert.equal(c.name, 'claude');
  assert.ok(c.args.includes('--allowedTools'));
  assert.ok(c.args.includes('Edit(//var/tmp/x/wt/**)'), c.args.join(' '));
  assert.ok(c.args.includes('Bash(git commit:*)'));
  assert.ok(!c.args.includes('--tools'));
  assert.ok(!c.args.includes('--dangerously-skip-permissions'));
  assert.equal(piDeveloper.name, 'pi');
  assert.ok(!piDeveloper.args.includes('--no-tools'));
  assert.deepEqual(piDeveloper.args.slice(piDeveloper.args.indexOf('--tools'), piDeveloper.args.indexOf('--tools') + 2), ['--tools', 'read,edit,write,bash']);
  assert.equal(c.parse, claude.parse);
  assert.equal(piDeveloper.parse, pi.parse);
});

// Two paid runs with tools on; a 120 s deadline each.
for (const name of ['claude', 'pi'] as const) {
  test(`live ${name}: a real developer run commits in the worktree and reaches VERIFYING`, { timeout: 150_000 }, async (t) => {
    if (!LIVE) return void t.skip('RUNTIME_SPIKE is not set');
    const { repo, store, runsDir } = scratch();
    const ticket = 'Create a file named HELLO.md containing exactly the line "hello from the factory" and commit it with the message "add HELLO.md".';
    const { cycle, worktree } = await develop(store, name === 'pi' ? cliAdapter(piDeveloper) : (wt) => cliAdapter(claudeDeveloper(wt)), { workId: 'w1', ticket, repo }, { deadlineMs: 120_000, runsDir });
    assert.equal(cycle.stage, 'VERIFYING', cycle.escalation);
    assert.equal(cycle.runs[0]!.runtime, name);
    assert.equal(git(worktree, 'show', 'HEAD:HELLO.md').trim(), 'hello from the factory');
    store.close();
  });
}
