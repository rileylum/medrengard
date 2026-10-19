// Ticket 10-c: a command stage runs its own commands (`run`) in the sandbox, with its context in
// the file SF_REQUEST names, an outputDir of its own, network off unless it asks, and a SHA-256 of
// each file argument it runs from beside the workflow. Offline: the developer is the fixture CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { EventStore } from '../src/store.ts';
import { claude, cliAdapter } from '../src/runtime/cli-adapter.ts';
import { develop, type Job } from '../src/developer.ts';
import type { Workflow } from '../src/lifecycle.ts';
import { review } from '../src/review.ts';
import { verify, type Check, type VerifyOptions } from '../src/verify.ts';
import { fakeAdapter } from './fake-adapter.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-command-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...a], { cwd, encoding: 'utf8' }).trim();

const fixture = join(import.meta.dirname, 'fixtures', 'fake-cli.ts');
const developer = cliAdapter({ ...claude, command: process.execPath, args: [fixture, claude.name, 'commit', 'ok'] }, { isolation: 'process-group' });
// The node install running these tests is outside /usr on this machine (tests/verify.test.ts).
const NODE_PREFIX = dirname(dirname(realpathSync(process.execPath)));
const sh = (name: string, script: string): Check => ({ name, command: ['sh', '-c', script] });

/** DEV, then LINT and BUILD, two command stages, then a review. */
const twoStages = (lint: Record<string, unknown> = {}, build: Record<string, unknown> = {}) => ({
  name: 'two-stages',
  start: 'DEV',
  stages: {
    DEV: { kind: 'agent', role: 'developer', produces: 'commit', roleText: 'You are the developer for the ticket below.', transitions: { PASS: 'LINT' } },
    LINT: { kind: 'command', ...lint, transitions: { PASS: 'BUILD' } },
    BUILD: { kind: 'command', ...build, transitions: { PASS: 'REVIEW' } },
    REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 1, transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
  },
}) as Workflow;

let n = 0;
/** A scratch repository taken to the workflow's first command stage by the fixture developer. */
async function atCommand(workflow: Workflow, checks: Check[] = []) {
  const root = join(dir, String(n++));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'initial');
  const store = new EventStore(join(root, 'events.sqlite'), workflow);
  const runsDir = join(root, 'runs');
  const job: Job = { workId: 'w1', ticket: 'Create done.txt and commit it.', repo, checks };
  const dev = await develop(store, developer, job, { deadlineMs: 20_000, runsDir });
  assert.equal(workflow.stages[dev.cycle.stage]?.kind, 'command', dev.cycle.escalation);
  const { head, base } = dev.cycle.candidate!;
  return { root, repo, store, runsDir, job, cycleId: dev.cycle.cycleId, head, base };
}
const opts = (runsDir: string, extra: Partial<VerifyOptions> = {}): VerifyOptions =>
  ({ deadlineMs: 20_000, runsDir, isolation: 'process-group', sandbox: { backend: 'bwrap', read: [NODE_PREFIX] }, ...extra });
const checksOf = (c: { history: { event: unknown }[] }) => (c.history.at(-1)!.event as { checks: unknown[] }).checks;

test('a command stage with run runs those commands and not job.checks; one without run runs job.checks', async () => {
  const { store, runsDir, job, cycleId } = await atCommand(twoStages({ run: [sh('lint', 'true')] }), [sh('check', 'true')]);
  const lint = await verify(store, cycleId, job, opts(runsDir));
  assert.equal(lint.cycle.stage, 'BUILD', lint.cycle.escalation);
  assert.deepEqual(checksOf(lint.cycle), [{ name: 'lint', result: 'PASS' }]);
  const build = await verify(store, cycleId, job, opts(runsDir));
  assert.equal(build.cycle.stage, 'REVIEW', build.cycle.escalation);
  assert.deepEqual(checksOf(build.cycle), [{ name: 'check', result: 'PASS' }]);
  store.close();
});

test('two command stages on one head keep each other evidence, each under evidence/<head>/<stage>/', async () => {
  const { store, runsDir, job, cycleId, head } = await atCommand(twoStages({ run: [sh('same', 'echo lint')] }, { run: [sh('same', 'echo build')] }));
  const lint = await verify(store, cycleId, job, opts(runsDir));
  const build = await verify(store, cycleId, job, opts(runsDir));
  assert.equal(build.cycle.stage, 'REVIEW', build.cycle.escalation);
  assert.equal(lint.evidenceDir, join(runsDir, 'evidence', head, 'LINT'));
  assert.equal(build.evidenceDir, join(runsDir, 'evidence', head, 'BUILD'));
  assert.equal(readFileSync(join(lint.evidenceDir, 'same.stdout'), 'utf8'), 'lint\n');
  assert.equal(readFileSync(join(build.evidenceDir, 'same.stdout'), 'utf8'), 'build\n');
  store.close();
});

test('the reviewer prompt lists every command stage verified on the head, as <stage>/<name>, with its evidence', async () => {
  const { store, runsDir, job, cycleId, head } = await atCommand(twoStages({ run: [sh('same', 'echo from-lint')] }, { run: [sh('same', 'echo from-build')] }));
  await verify(store, cycleId, job, opts(runsDir));
  await verify(store, cycleId, job, opts(runsDir));
  const reviewer = fakeAdapter({ outcome: { status: 'completed', claim: { head, verdict: 'PASS', findings: [] } } });
  const c = await review(store, reviewer, cycleId, job, { deadlineMs: 20_000, runsDir });
  assert.equal(c.stage, 'ACCEPTED', c.escalation);
  const prompt = reviewer.requests[0]!.prompt;
  assert.match(prompt, /^LINT\/same: PASS$/m);
  assert.match(prompt, /^BUILD\/same: PASS$/m);
  assert.match(prompt, /EVIDENCE LINT\/same\.stdout ====\nfrom-lint$/m);
  assert.match(prompt, /EVIDENCE BUILD\/same\.stdout ====\nfrom-build$/m);
  store.close();
});

// Reads the request the way a user's command would, from inside the sandbox.
const NODE_READ = `const fs = require('node:fs'); const r = JSON.parse(fs.readFileSync(process.env.SF_REQUEST, 'utf8'));`;
const node = (name: string, script: string): Check => ({ name, command: [process.execPath, '-e', `${NODE_READ} ${script}`] });

for (const backend of ['bwrap', 'none']) {
  test(`under ${backend}, SF_REQUEST names request.json with every field, and diffFile holds the base-to-head diff`, async () => {
    const { repo, store, runsDir, job, cycleId, head, base } = await atCommand(twoStages({ run: [node('request', 'process.stdout.write(JSON.stringify(r))'), node('diff', 'process.stdout.write(fs.readFileSync(r.diffFile))')] }));
    const r = await verify(store, cycleId, job, opts(runsDir, { sandbox: { backend, read: [NODE_PREFIX] } }));
    assert.equal(r.cycle.stage, 'BUILD', r.cycle.escalation);
    const stageDir = join(runsDir, 'evidence', head, 'LINT');
    const request = { cycleId, workId: 'w1', stage: 'LINT', head, base, ticket: 'Create done.txt and commit it.', diffFile: join(stageDir, 'diff.patch'), outputDir: join(stageDir, 'output') };
    assert.deepEqual(JSON.parse(readFileSync(join(r.evidenceDir, 'request.stdout'), 'utf8')), request);
    assert.deepEqual(JSON.parse(readFileSync(join(stageDir, 'request.json'), 'utf8')), request);
    const diff = readFileSync(join(r.evidenceDir, 'diff.stdout'), 'utf8');
    assert.match(diff, /^\+\+\+ b\/done\.txt$/m);
    assert.equal(diff, `${git(repo, 'diff', '--text', base, head)}\n`);
    store.close();
  });
}

test('a command can write outputDir and the checkout, and not its own evidence, another stage evidence or anything else', async () => {
  const root = join(dir, `writes${n}`);
  mkdirSync(root);
  const outside = join(root, 'forged');
  // Paths from the request: the head is not known until the developer has run.
  const writes = node('writes', `const path = require('node:path'); const own = path.dirname(r.outputDir); const targets = {
    output: path.join(r.outputDir, 'x'), checkout: 'new-file.txt', request: process.env.SF_REQUEST, own: path.join(own, 'forged'),
    other: path.join(own, '..', 'LINT', 'lint.stdout'), outside: ${JSON.stringify(outside)} };
    for (const [k, p] of Object.entries(targets)) { try { fs.writeFileSync(p, 'forged\\n'); console.log(k); } catch {} }`);
  const { store, runsDir, job, cycleId, head } = await atCommand(twoStages({ run: [sh('lint', 'echo lint')] }, { run: [writes] }));
  await verify(store, cycleId, job, opts(runsDir));
  const r = await verify(store, cycleId, job, opts(runsDir));
  assert.equal(r.cycle.stage, 'REVIEW', r.cycle.escalation);
  const own = join(runsDir, 'evidence', head, 'BUILD');
  assert.equal(readFileSync(join(own, 'writes.stdout'), 'utf8'), 'output\ncheckout\n', readFileSync(join(own, 'writes.stderr'), 'utf8'));
  assert.equal(readFileSync(join(own, 'output', 'x'), 'utf8'), 'forged\n');
  assert.equal(readFileSync(join(runsDir, 'evidence', head, 'LINT', 'lint.stdout'), 'utf8'), 'lint\n');
  assert.equal(JSON.parse(readFileSync(join(own, 'request.json'), 'utf8')).stage, 'BUILD');
  assert.ok(!existsSync(join(own, 'forged')));
  assert.ok(!existsSync(outside));
  store.close();
});

for (const network of [true, undefined]) {
  test(`with network ${network}, a command ${network ? 'reaches' : 'cannot reach'} a listener on the host`, async () => {
    const server = createServer((s) => s.end('hello\n'));
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    const { port } = server.address() as { port: number };
    const connect = node('connect', `require('node:net').connect(${port}, '127.0.0.1').on('data', (d) => process.stdout.write(d)).on('error', (e) => { console.log(e.code); process.exitCode = 1; });`);
    const { store, runsDir, job, cycleId } = await atCommand(twoStages({ run: [connect], ...(network === undefined ? {} : { network }) }));
    try {
      const r = await verify(store, cycleId, job, opts(runsDir));
      assert.equal(readFileSync(join(r.evidenceDir, 'connect.stdout'), 'utf8'), network ? 'hello\n' : 'ECONNREFUSED\n');
    } finally {
      server.close();
      store.close();
    }
  });
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

test('a file argument runs a copy of the bytes beside the workflow, and the event records their SHA-256', async () => {
  const workflowDir = join(dir, `wf${n}`);
  mkdirSync(join(workflowDir, 'bin'), { recursive: true });
  const V1 = 'echo v1\n';
  writeFileSync(join(workflowDir, 'lint.sh'), V1);
  writeFileSync(join(workflowDir, 'bin', 'check.sh'), '#!/bin/sh\necho checked\n');
  chmodSync(join(workflowDir, 'bin', 'check.sh'), 0o755);
  // Under none the first command can reach the original, as a change made during the run would.
  const run = [sh('swap', `echo 'echo v2' > '${join(workflowDir, 'lint.sh')}'`), { name: 'lint', command: ['sh', { file: 'lint.sh' }] }, { name: 'check', command: [{ file: 'bin/check.sh' }] }];
  const { store, runsDir, job, cycleId } = await atCommand(twoStages({ run }));
  const r = await verify(store, cycleId, job, opts(runsDir, { sandbox: { backend: 'none' }, workflowDir }));
  assert.equal(r.cycle.stage, 'BUILD', r.cycle.escalation);
  assert.equal(readFileSync(join(r.evidenceDir, 'lint.stdout'), 'utf8'), 'v1\n');
  assert.equal(readFileSync(join(r.evidenceDir, 'check.stdout'), 'utf8'), 'checked\n');
  assert.deepEqual(checksOf(r.cycle), [
    { name: 'swap', result: 'PASS' },
    { name: 'lint', result: 'PASS', files: { 'lint.sh': sha256(V1) } },
    { name: 'check', result: 'PASS', files: { 'bin/check.sh': sha256('#!/bin/sh\necho checked\n') } },
  ]);
  assert.equal(readFileSync(join(r.evidenceDir, 'files', 'lint.sh'), 'utf8'), V1);
  assert.equal(statSync(join(r.evidenceDir, 'files', 'bin', 'check.sh')).mode & 0o777, 0o755);
  store.close();
});

test('a file argument with no workflow directory, or not in it, throws before anything is written', async () => {
  const { store, runsDir, job, cycleId, head } = await atCommand(twoStages({ run: [{ name: 'lint', command: ['sh', { file: 'lint.sh' }] }] }));
  const before = store.events(cycleId).length;
  await assert.rejects(verify(store, cycleId, job, opts(runsDir)), /LINT names file lint\.sh, but its workflow has no file of its own/);
  await assert.rejects(verify(store, cycleId, job, opts(runsDir, { workflowDir: dir })), new RegExp(`LINT names file lint\\.sh, which is not a file in ${dir}`));
  // A directory passes checkWorkflow's path rule; it is not a file to copy and hash.
  mkdirSync(join(dir, 'lint.sh'));
  await assert.rejects(verify(store, cycleId, job, opts(runsDir, { workflowDir: dir })), new RegExp(`LINT names file lint\\.sh, which is not a file in ${dir}`));
  rmSync(join(dir, 'lint.sh'), { recursive: true });
  assert.equal(store.events(cycleId).length, before);
  assert.ok(!existsSync(join(runsDir, 'evidence', head)));
  store.close();
});

test('readRequest reads the file SF_REQUEST names, and refuses one missing a field, naming it', async () => {
  const { readRequest } = await import('../src/kits/request.ts');
  const file = join(dir, `request${n++}.json`);
  const request = { cycleId: 'c', workId: 'w', stage: 'LINT', head: 'h', base: 'b', ticket: 't', diffFile: '/d', outputDir: '/o' };
  writeFileSync(file, JSON.stringify(request));
  const saved = process.env.SF_REQUEST;
  process.env.SF_REQUEST = file;
  try {
    assert.deepEqual(readRequest(), request);
    const { outputDir: _, ...short } = request;
    writeFileSync(file, JSON.stringify(short));
    assert.throws(() => readRequest(), new RegExp(`${file}: outputDir is not a non-empty string`));
    delete process.env.SF_REQUEST;
    assert.throws(() => readRequest(), /SF_REQUEST is not set/);
  } finally {
    if (saved === undefined) delete process.env.SF_REQUEST;
    else process.env.SF_REQUEST = saved;
  }
});

test('job.checks takes string arguments only: a { file } there is refused before anything is written', async () => {
  // checks may come from the repository layer; file arguments are the workflow's, in run.
  const { store, runsDir, job, cycleId, head } = await atCommand(twoStages(), [{ name: 'c', command: ['sh', { file: 'x.sh' }] } as unknown as Check]);
  await assert.rejects(verify(store, cycleId, job, opts(runsDir, { workflowDir: dir })), /check c: every argument must be a string/);
  assert.ok(!existsSync(join(runsDir, 'evidence', head)));
  store.close();
});

test('evidence a command locked in output/ on an earlier run of the stage is cleared, not left to fail every later run', async () => {
  const { store, runsDir, job, cycleId, head } = await atCommand(twoStages({ run: [sh('lint', 'true')] }));
  // As a run killed before the controller could restore access would leave it.
  const locked = join(runsDir, 'evidence', head, 'LINT', 'output', 'locked');
  mkdirSync(locked, { recursive: true });
  writeFileSync(join(locked, 'f'), 'x');
  chmodSync(locked, 0);
  const r = await verify(store, cycleId, job, opts(runsDir));
  assert.equal(r.cycle.stage, 'BUILD', r.cycle.escalation);
  assert.ok(!existsSync(locked));
  store.close();
});

test('diffFile is the plain patch whatever the repository\'s diff settings: no external diff, textconv or colour', async () => {
  const { repo, store, runsDir, job, cycleId, head } = await atCommand(twoStages({ run: [sh('lint', 'true')] }));
  const external = join(dir, `external${n}.sh`);
  writeFileSync(external, '#!/bin/sh\necho EXTERNAL\n');
  chmodSync(external, 0o755);
  git(repo, 'config', 'diff.external', external);
  git(repo, 'config', 'color.diff', 'always');
  writeFileSync(join(repo, '.git', 'info', 'attributes'), '*.txt diff=shout\n');
  git(repo, 'config', 'diff.shout.textconv', 'tr a-z A-Z <');
  await verify(store, cycleId, job, opts(runsDir));
  const patch = readFileSync(join(runsDir, 'evidence', head, 'LINT', 'diff.patch'), 'utf8');
  assert.match(patch, /^\+\+\+ b\/done\.txt$/m);
  assert.doesNotMatch(patch, /EXTERNAL|\x1b/);
  assert.equal(patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n'), readFileSync(join(runsDir, `${cycleId}-verify`, 'done.txt'), 'utf8').trimEnd().split('\n').map((l) => `+${l}`).join('\n'));
  store.close();
});
