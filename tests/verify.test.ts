// Ticket 06-a: the controller runs the job's declared checks in a fresh detached checkout of
// the candidate, stores each check's output and exit against the SHA, and appends one
// verification event. Offline only: the checks are shell programs, the developer is the fixture CLI.
// Ticket 08-a: the checkout has no .git and every check runs inside the sandbox (bwrap by default).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Adapter } from '../src/adapter.ts';
import { EventStore } from '../src/store.ts';
import { claude, cliAdapter, type CliSpec } from '../src/runtime/cli-adapter.ts';
import { develop, type Job } from '../src/developer.ts';
import { verify, type Check, type VerifyOptions } from '../src/verify.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-verify-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...a], { cwd, encoding: 'utf8' }).trim();

const fixture = join(import.meta.dirname, 'fixtures', 'fake-cli.ts');
const flood = join(import.meta.dirname, 'fixtures', 'flood.ts');
const fake = (spec: CliSpec) => cliAdapter({ ...spec, command: process.execPath, args: [fixture, spec.name, 'commit', 'ok'] }, { isolation: 'process-group' });
// The node install running these tests; on this machine it is under ~/.config/nvm, outside /usr,
// so a check that runs node needs it, and the fixture, declared as read paths.
const NODE_PREFIX = dirname(dirname(realpathSync(process.execPath)));
const READ = [NODE_PREFIX, join(import.meta.dirname, 'fixtures')];

/** A developer that runs `write` in its worktree, commits everything, and claims the real head. */
const committing = (write: (worktree: string) => void): Adapter => ({
  name: 'committing',
  async start(req) {
    write(req.cwd);
    git(req.cwd, 'add', '-A');
    git(req.cwd, 'commit', '-q', '-m', 'work');
    return { status: 'completed', claim: { head: git(req.cwd, 'rev-parse', 'HEAD'), artifacts: ['.'] } };
  },
});

let n = 0;
/** A scratch repository taken to VERIFYING by the fixture developer. */
async function verifying(checks: Check[] = [], developer: Adapter = fake(claude)) {
  const root = join(dir, String(n++));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'initial');
  const store = new EventStore(join(root, 'events.sqlite'));
  const runsDir = join(root, 'runs');
  const job: Job = { workId: 'w1', ticket: 'Create done.txt and commit it.', repo, checks };
  const dev = await develop(store, developer, job, { deadlineMs: 20_000, runsDir });
  assert.equal(dev.cycle.stage, 'VERIFYING', dev.cycle.escalation);
  return { root, repo, store, runsDir, job, cycle: dev.cycle, devWorktree: dev.worktree, head: dev.cycle.candidate!.head, base: dev.cycle.candidate!.base };
}
const opts = (extra: Partial<VerifyOptions> = {}): Omit<VerifyOptions, 'runsDir'> => ({ deadlineMs: 20_000, isolation: 'process-group', sandbox: { backend: 'bwrap', read: READ }, ...extra });
const sh = (name: string, script: string): Check => ({ name, command: ['sh', '-c', script] });
const evidence = (evidenceDir: string, name: string) => ({
  stdout: readFileSync(join(evidenceDir, `${name}.stdout`), 'utf8'),
  stderr: readFileSync(join(evidenceDir, `${name}.stderr`), 'utf8'),
  exit: readFileSync(join(evidenceDir, `${name}.exit`), 'utf8'),
});
const results = (cycle: { history: { event: { type: string } }[] }) => {
  const e = cycle.history.at(-1)!.event as { type: string; head: string; checks: { name: string; result: string }[] };
  assert.equal(e.type, 'verification');
  return e;
};

test('passing checks run in a fresh checkout of the head with no .git and move the cycle to STANDARD_REVIEW', async () => {
  const { repo, store, runsDir, job, cycle, devWorktree, head, base } = await verifying([sh('file', 'test -f done.txt')]);
  // The head is known only after the developer ran; verify reads job.checks at call time.
  job.checks!.push(sh('nogit', 'test ! -e .git'), sh('out', 'echo checked; echo warn >&2'));
  // Left behind by the developer after the claim: a fresh checkout must not see it.
  writeFileSync(join(devWorktree, 'junk.txt'), 'junk\n');
  // Default isolation and sandbox: each check in its own systemd scope, inside bwrap.
  const r = await verify(store, cycle.cycleId, job, { deadlineMs: 20_000, runsDir });
  assert.equal(r.cycle.stage, 'STANDARD_REVIEW', r.cycle.escalation);
  assert.deepEqual(r.cycle.candidate, { head, base });
  assert.deepEqual(results(r.cycle), { type: 'verification', head, checks: [{ name: 'file', result: 'PASS' }, { name: 'nogit', result: 'PASS' }, { name: 'out', result: 'PASS' }] });
  assert.deepEqual(store.load(cycle.cycleId), r.cycle);
  // The checkout: the head's files and nothing else, not the developer's tree, no git state.
  assert.equal(r.worktree, join(runsDir, `${cycle.cycleId}-verify`));
  assert.ok(!existsSync(join(r.worktree, '.git')));
  assert.deepEqual(readdirSync(r.worktree).sort(), git(repo, 'ls-tree', '--name-only', head).split('\n').sort());
  assert.ok(!existsSync(join(r.worktree, 'junk.txt')));
  assert.deepEqual(git(repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)?.length, 2, 'only the repository and the developer worktree are registered');
  // The developer's worktree and the repository are untouched.
  assert.ok(existsSync(join(devWorktree, 'junk.txt')));
  assert.equal(git(devWorktree, 'rev-parse', 'HEAD'), head);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), base);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  // Evidence keyed by SHA.
  assert.equal(r.evidenceDir, join(runsDir, 'evidence', head));
  assert.deepEqual(readdirSync(r.evidenceDir).sort(), ['file.exit', 'file.stderr', 'file.stdout', 'nogit.exit', 'nogit.stderr', 'nogit.stdout', 'out.exit', 'out.stderr', 'out.stdout']);
  assert.deepEqual(evidence(r.evidenceDir, 'out'), { stdout: 'checked\n', stderr: 'warn\n', exit: 'exit 0\n' });
  store.close();
});

test('a fresh checkout does not see an untracked file in the developer worktree, so a check that depends on it fails', async () => {
  const { store, runsDir, job, cycle, devWorktree } = await verifying([sh('junk', 'test -f junk.txt')]);
  writeFileSync(join(devWorktree, 'junk.txt'), 'junk\n');
  const r = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.equal(r.cycle.stage, 'ESCALATED');
  assert.deepEqual(results(r.cycle).checks, [{ name: 'junk', result: 'FAIL' }]);
  store.close();
});

test('a failing exit, a missing binary, a timeout and an overflow are recorded, every check runs, and the cycle escalates', async () => {
  const { store, runsDir, job, cycle, head } = await verifying([
    sh('bad', 'echo partial; echo broken >&2; exit 3'),
    { name: 'absent', command: ['/nonexistent/sf-no-such-binary', '--version'] },
    sh('slow', 'sleep 30'),
    { name: 'flood', command: [process.execPath, flood] },
    sh('good', 'true'),
  ]);
  const started = Date.now();
  const r = await verify(store, cycle.cycleId, job, { ...opts({ deadlineMs: 1000, maxOutputBytes: 65536, graceMs: 300 }), runsDir });
  assert.ok(Date.now() - started < 10_000);
  assert.equal(r.cycle.stage, 'ESCALATED');
  assert.match(r.cycle.escalation ?? '', /required check failed or missing/);
  assert.deepEqual(results(r.cycle), {
    type: 'verification',
    head,
    checks: [
      { name: 'bad', result: 'FAIL' }, { name: 'absent', result: 'MISSING' }, { name: 'slow', result: 'FAIL' },
      { name: 'flood', result: 'FAIL' }, { name: 'good', result: 'PASS' },
    ],
  });
  assert.deepEqual(evidence(r.evidenceDir, 'bad'), { stdout: 'partial\n', stderr: 'broken\n', exit: 'exit 3\n' });
  const absent = evidence(r.evidenceDir, 'absent');
  assert.match(absent.exit, /^missing: /);
  assert.equal(evidence(r.evidenceDir, 'slow').exit, 'timeout\n');
  const fl = evidence(r.evidenceDir, 'flood');
  assert.equal(fl.exit, 'overflow\n');
  assert.equal(fl.stdout, '');
  assert.match(fl.stderr, /stdout exceeded 65536 bytes/);
  assert.equal(evidence(r.evidenceDir, 'good').exit, 'exit 0\n');
  store.close();
});

test('an unknown binary, by path or by PATH name, is MISSING under cgroup isolation too (06-b, parked 06-a minor)', async () => {
  const { store, runsDir, job, cycle } = await verifying([
    { name: 'abs', command: ['/nonexistent/sf-no-such-binary', '--version'] },
    { name: 'path', command: ['sf-no-such-binary-on-path'] },
    sh('ok', 'true'),
  ]);
  const r = await verify(store, cycle.cycleId, job, { deadlineMs: 20_000, runsDir });
  assert.deepEqual(results(r.cycle).checks, [{ name: 'abs', result: 'MISSING' }, { name: 'path', result: 'MISSING' }, { name: 'ok', result: 'PASS' }]);
  assert.match(evidence(r.evidenceDir, 'abs').exit, /^missing: .*sf-no-such-binary/);
  assert.match(evidence(r.evidenceDir, 'path').exit, /^missing: .*sf-no-such-binary-on-path/);
  store.close();
});

test('no declared checks: the event is appended with no checks and the cycle escalates (missing evidence is never PASS)', async () => {
  const { store, runsDir, job, cycle } = await verifying([]);
  const r = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.equal(r.cycle.stage, 'ESCALATED');
  assert.deepEqual(results(r.cycle).checks, []);
  assert.ok(existsSync(r.worktree));
  assert.deepEqual(readdirSync(r.evidenceDir), []);
  store.close();
});

test('a stale -verify worktree from before 08-a and stale evidence for the head are replaced, not reused', async () => {
  const { repo, store, runsDir, job, cycle, head, base } = await verifying([sh('file', 'test -f done.txt')]);
  const stale = join(runsDir, `${cycle.cycleId}-verify`);
  git(repo, 'worktree', 'add', '-q', '--detach', stale, base);
  writeFileSync(join(stale, 'leftover.txt'), 'x\n');
  // Evidence from an earlier verification of this SHA with another check list must go too.
  mkdirSync(join(runsDir, 'evidence', head), { recursive: true });
  writeFileSync(join(runsDir, 'evidence', head, 'old.exit'), 'exit 0\n');
  const r = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.equal(r.cycle.stage, 'STANDARD_REVIEW', r.cycle.escalation);
  assert.ok(!existsSync(join(stale, '.git')));
  assert.ok(existsSync(join(stale, 'done.txt')));
  assert.ok(!existsSync(join(stale, 'leftover.txt')));
  assert.doesNotMatch(git(repo, 'worktree', 'list', '--porcelain'), new RegExp(`${cycle.cycleId}-verify`), 'the old registration is pruned');
  assert.deepEqual(readdirSync(r.evidenceDir).sort(), ['file.exit', 'file.stderr', 'file.stdout']);
  // Deleted by hand but still registered with git: the next verification must still get a checkout.
  rmSync(stale, { recursive: true });
  const again = await verifying([sh('file', 'test -f done.txt')]);
  rmSync(join(again.runsDir, `${again.cycle.cycleId}-verify`), { recursive: true, force: true });
  git(again.repo, 'worktree', 'add', '-q', '--detach', join(again.runsDir, `${again.cycle.cycleId}-verify`), again.base);
  rmSync(join(again.runsDir, `${again.cycle.cycleId}-verify`), { recursive: true });
  const r2 = await verify(again.store, again.cycle.cycleId, again.job, { ...opts(), runsDir: again.runsDir });
  assert.equal(r2.cycle.stage, 'STANDARD_REVIEW', r2.cycle.escalation);
  again.store.close();
  store.close();
});

test('verify outside VERIFYING, or with a bad check name, throws before anything is written', async () => {
  const { store, runsDir, job, cycle } = await verifying([sh('ok', 'true')]);
  const before = store.events(cycle.cycleId).length;
  for (const bad of [[sh('a b', 'true')], [sh('../x', 'true')], [sh('..', 'true')], [sh('', 'true')], [sh('dup', 'true'), sh('dup', 'true')]]) {
    await assert.rejects(verify(store, cycle.cycleId, { ...job, checks: bad }, { ...opts(), runsDir }), /check name/);
  }
  assert.ok(!existsSync(join(runsDir, `${cycle.cycleId}-verify`)));
  assert.ok(!existsSync(join(runsDir, 'evidence')));
  assert.equal(store.events(cycle.cycleId).length, before);
  // Now verify for real, then a second call finds STANDARD_REVIEW and throws.
  const r = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.equal(r.cycle.stage, 'STANDARD_REVIEW');
  await assert.rejects(verify(store, cycle.cycleId, job, { ...opts(), runsDir }), /STANDARD_REVIEW/);
  await assert.rejects(verify(store, 'no-such-cycle', job, { ...opts(), runsDir }), /not open/);
  assert.equal(store.events(cycle.cycleId).length, before + 1);
  store.close();
});

// Ticket 07-b: a check that rewrites a tracked file leaves a checkout that is not the commit. Recorded
// as a failed check with the status as evidence, so the cycle escalates instead of waiting on review.
test('a check that modifies a tracked file records tree: FAIL with the status as evidence and the cycle escalates (07-b, parked 06-c minor)', async () => {
  const { store, runsDir, job, cycle } = await verifying([sh('fmt', 'echo formatted >> README.md'), sh('after', 'true')]);
  const { cycle: c, evidenceDir } = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(results(c).checks, [{ name: 'fmt', result: 'PASS' }, { name: 'after', result: 'PASS' }, { name: 'tree', result: 'FAIL' }]);
  const ev = evidence(evidenceDir, 'tree');
  assert.match(ev.stdout, /^M\tREADME\.md$/m);
  assert.equal(ev.stderr, '');
  assert.equal(ev.exit, 'dirty\n');
  store.close();
});

test('a clean tree after the checks records no tree check; an untracked leftover is not dirt (07-b)', async () => {
  const { store, runsDir, job, cycle } = await verifying([sh('leave', 'echo x > leftover.txt')]);
  const { cycle: c } = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.equal(c.stage, 'STANDARD_REVIEW', c.escalation);
  assert.deepEqual(results(c).checks, [{ name: 'leave', result: 'PASS' }]);
  store.close();
});

test('a declared check named tree is refused before anything is written (07-b)', async () => {
  const { store, runsDir, job, cycle } = await verifying([sh('tree', 'true')]);
  await assert.rejects(verify(store, cycle.cycleId, job, { ...opts(), runsDir }), /tree.*reserved/);
  assert.ok(!existsSync(join(runsDir, `${cycle.cycleId}-verify`)));
  assert.equal(store.load(cycle.cycleId)!.stage, 'VERIFYING');
  store.close();
});

// Ticket 07-c: a check that hides its rewrite behind an index flag is still a tree that is not the commit.
test('a check cannot hide a rewritten tracked file behind skip-worktree or assume-unchanged: there is no index to flag, and the rewrite is tree: FAIL (07-c, 08-a)', async () => {
  for (const flag of ['--skip-worktree', '--assume-unchanged']) {
    const { store, runsDir, job, cycle } = await verifying([sh('evil', `git update-index ${flag} README.md; echo EVIL >> README.md`)]);
    const { cycle: c, evidenceDir } = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
    assert.equal(c.stage, 'ESCALATED', flag);
    assert.deepEqual(results(c).checks, [{ name: 'evil', result: 'PASS' }, { name: 'tree', result: 'FAIL' }], flag);
    const ev = evidence(evidenceDir, 'tree');
    assert.match(ev.stdout, /^M\tREADME\.md$/m, flag);
    assert.equal(ev.exit, 'dirty\n');
    store.close();
  }
});

test('a status past 1 MiB is tree evidence, not a throw (07-c)', async () => {
  // 11 000 tracked files with long names, every one rewritten by the check: the porcelain status is about 1.4 MB.
  const { store, runsDir, job } = await verifying();
  const many: import('../src/adapter.ts').Adapter = {
    name: 'many',
    async start(req) {
      mkdirSync(join(req.cwd, 'big'));
      for (let i = 0; i < 11_000; i++) writeFileSync(join(req.cwd, 'big', `${String(i).padStart(5, '0')}-${'n'.repeat(110)}`), 'x\n');
      git(req.cwd, 'add', '-A');
      git(req.cwd, 'commit', '-q', '-m', 'many files');
      return { status: 'completed', claim: { head: git(req.cwd, 'rev-parse', 'HEAD'), artifacts: ['big'] } };
    },
  };
  // A second work item in the same scratch repository: the first one's cycle is still open in VERIFYING.
  const j: Job = { ...job, workId: 'w-many', checks: [sh('fmt', 'for f in big/*; do echo y >> "$f"; done')] };
  const dev = await develop(store, many, j, { deadlineMs: 60_000, runsDir });
  assert.equal(dev.cycle.stage, 'VERIFYING', dev.cycle.escalation);
  const { cycle: c, evidenceDir } = await verify(store, dev.cycle.cycleId, j, { ...opts({ deadlineMs: 120_000 }), runsDir });
  assert.equal(c.stage, 'ESCALATED', c.escalation);
  assert.deepEqual(results(c).checks, [{ name: 'fmt', result: 'PASS' }, { name: 'tree', result: 'FAIL' }]);
  const ev = evidence(evidenceDir, 'tree');
  assert.ok(ev.stdout.length > 1024 * 1024, String(ev.stdout.length));
  assert.equal(ev.stdout.split('\n').filter((l) => l.startsWith('M\tbig/')).length, 11_000);
  store.close();
});

// Ticket 08-a: the parked sandbox class (A-029, A-035). Each test is one parked line from
// docs/work/parked.md; each would pass the attack without the sandbox or with a .git in the checkout.
test('a committed symlink to the developer worktree resolves to nothing inside the sandbox: the same SHA verifies the same (06-a major)', async () => {
  // The candidate commits `mine -> ../<cycleId>`, which outside a sandbox is the developer's worktree next door.
  const { store, runsDir, job, cycle, devWorktree } = await verifying([sh('peek', 'test -f mine/untracked.txt')],
    committing((wt) => { writeFileSync(join(wt, 'done.txt'), 'done\n'); execFileSync('ln', ['-s', `../${basename(wt)}`, join(wt, 'mine')]); }));
  writeFileSync(join(devWorktree, 'untracked.txt'), 'in no commit\n');
  const r = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.deepEqual(results(r.cycle).checks, [{ name: 'peek', result: 'FAIL' }]);
  store.close();
  // Contrast, so the test shows the sandbox and not the checkout doing the work: unconfined, the link resolves.
  const again = await verifying([sh('peek', 'test -f mine/untracked.txt')],
    committing((wt) => { writeFileSync(join(wt, 'done.txt'), 'done\n'); execFileSync('ln', ['-s', `../${basename(wt)}`, join(wt, 'mine')]); }));
  writeFileSync(join(again.devWorktree, 'untracked.txt'), 'in no commit\n');
  const r2 = await verify(again.store, again.cycle.cycleId, again.job, { ...opts({ sandbox: { backend: 'none' } }), runsDir: again.runsDir });
  assert.deepEqual(results(r2.cycle).checks, [{ name: 'peek', result: 'PASS' }]);
  again.store.close();
});

test('a post-checkout hook named by core.hooksPath does not run when the checkout is written (06-a minor)', async () => {
  const { root, repo, store, runsDir, job, cycle } = await verifying([sh('ok', 'true')]);
  const hooks = join(root, 'hooks');
  mkdirSync(hooks);
  writeFileSync(join(hooks, 'post-checkout'), `#!/bin/sh\ntouch ${join(root, 'hook-ran')}\n`);
  chmodSync(join(hooks, 'post-checkout'), 0o755);
  git(repo, 'config', 'core.hooksPath', hooks);
  const r = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.equal(r.cycle.stage, 'STANDARD_REVIEW', r.cycle.escalation);
  assert.ok(!existsSync(join(root, 'hook-ran')));
  store.close();
});

test('a check cannot rewrite an earlier check\'s evidence, the store or the repository (06-a minor, 07-b note)', async () => {
  const { root, repo, store, runsDir, job, cycle, head, base } = await verifying();
  const ev = join(runsDir, 'evidence', head);
  job.checks = [
    sh('first', 'echo honest'),
    sh('forge', `echo forged > ${ev}/first.stdout; echo junk >> ${join(root, 'events.sqlite')}; git -C ${repo} replace ${head} ${base}; git -C ${repo} config core.fileMode false; true`),
  ];
  const r = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.equal(r.cycle.stage, 'STANDARD_REVIEW', r.cycle.escalation);
  assert.equal(evidence(r.evidenceDir, 'first').stdout, 'honest\n');
  assert.equal(git(repo, 'for-each-ref', 'refs/replace'), '');
  assert.equal(git(repo, 'config', '--local', 'core.fileMode'), 'true');
  assert.equal(store.load(cycle.cycleId)!.stage, 'STANDARD_REVIEW', 'the store still replays');
  store.close();
});

test('a .git pointer swapped in by a check with a rewritten tracked file is tree: FAIL; so is a cleared executable bit (07-b major, 07-b note)', async () => {
  const { store, runsDir, job, cycle } = await verifying([],
    committing((wt) => { writeFileSync(join(wt, 'done.txt'), 'done\n'); writeFileSync(join(wt, 'run.sh'), '#!/bin/sh\n'); chmodSync(join(wt, 'run.sh'), 0o755); }));
  job.checks = [sh('swap', 'printf "gitdir: /nowhere\\n" > .git; echo EVIL >> README.md; chmod -x run.sh')];
  const { cycle: c, evidenceDir } = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.equal(c.stage, 'ESCALATED');
  assert.deepEqual(results(c).checks, [{ name: 'swap', result: 'PASS' }, { name: 'tree', result: 'FAIL' }]);
  const tree = evidence(evidenceDir, 'tree').stdout;
  assert.match(tree, /^M\tREADME\.md$/m);
  assert.match(tree, /^M\trun\.sh$/m);
  store.close();
});

test('a check that runs git finds no repository (08-a, A-035 question 3)', async () => {
  const { store, runsDir, job, cycle } = await verifying([sh('git', 'git rev-parse HEAD')]);
  const r = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.deepEqual(results(r.cycle).checks, [{ name: 'git', result: 'FAIL' }]);
  assert.match(evidence(r.evidenceDir, 'git').stderr, /not a git repository/);
  store.close();
});

test('a check whose binary is outside the sandbox is MISSING and names sandbox.read; declaring the directory makes it run (08-a)', async () => {
  const { store, runsDir, job, cycle } = await verifying([{ name: 'node', command: [process.execPath, '-e', 'process.exit(0)'] }]);
  const r = await verify(store, cycle.cycleId, job, { ...opts({ sandbox: { backend: 'bwrap' } }), runsDir });
  assert.deepEqual(results(r.cycle).checks, [{ name: 'node', result: 'MISSING' }]);
  assert.match(evidence(r.evidenceDir, 'node').exit, /^missing: .*outside the sandbox.*sandbox\.read/);
  store.close();
  const again = await verifying([{ name: 'node', command: [process.execPath, '-e', 'process.exit(0)'] }]);
  const r2 = await verify(again.store, again.cycle.cycleId, again.job, { ...opts({ sandbox: { backend: 'bwrap', read: [NODE_PREFIX] } }), runsDir: again.runsDir });
  assert.deepEqual(results(r2.cycle).checks, [{ name: 'node', result: 'PASS' }]);
  again.store.close();
});

test('a sandbox that cannot start throws before anything is checked out (08-a)', async () => {
  const { store, runsDir, job, cycle } = await verifying([sh('ok', 'true')]);
  await assert.rejects(verify(store, cycle.cycleId, job, { ...opts({ sandbox: { backend: 'bwrap', read: ['/var/tmp/software_factory/sf-no-such-read-dir'] } }), runsDir }), /does not exist/);
  assert.ok(!existsSync(join(runsDir, `${cycle.cycleId}-verify`)));
  assert.equal(store.load(cycle.cycleId)!.stage, 'VERIFYING');
  store.close();
});

test('an untracked .gitattributes planted by a check does not change how the tree is compared: attributes come from the head (08-a)', async () => {
  // Without --attr-source, a planted `notes.txt text` makes git normalise the rewritten CRLF back to LF and call the file clean.
  const { store, runsDir, job, cycle } = await verifying([],
    committing((wt) => { writeFileSync(join(wt, 'done.txt'), 'done\n'); writeFileSync(join(wt, 'notes.txt'), 'a\n'); }));
  job.checks = [sh('crlf', "printf 'a\\r\\n' > notes.txt; echo 'notes.txt text' > .gitattributes")];
  const { cycle: c, evidenceDir } = await verify(store, cycle.cycleId, job, { ...opts(), runsDir });
  assert.equal(c.stage, 'ESCALATED', c.escalation);
  assert.match(evidence(evidenceDir, 'tree').stdout, /^M\tnotes\.txt$/m);
  store.close();
});
