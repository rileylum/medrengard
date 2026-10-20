// Ticket 10-e: a grant stage runs only on a reviewed head, must report the head it acted on, and
// its token never reaches the evidence or a reviewer (A-074, A-083). Offline: the developer is the
// fixture CLI and verdicts are appended as a reviewer would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EventStore } from '../src/store.ts';
import { claude, cliAdapter } from '../src/runtime/cli-adapter.ts';
import { develop, type Job } from '../src/developer.ts';
import type { Workflow } from '../src/lifecycle.ts';
import { review } from '../src/review.ts';
import { verify, type VerifyOptions } from '../src/verify.ts';
import { fakeAdapter } from './fake-adapter.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-grants-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...a], { cwd, encoding: 'utf8' }).trim();
const fixture = join(import.meta.dirname, 'fixtures', 'fake-cli.ts');
const developer = cliAdapter({ ...claude, command: process.execPath, args: [fixture, claude.name, 'commit', 'ok'] }, { isolation: 'process-group' });
const NODE_PREFIX = dirname(dirname(realpathSync(process.execPath)));
const TOKEN = 'sf-grant-value-9a7c';

// Reads the request inside the sandbox, as a user's merge command would.
const merge = (script: string) => ({ name: 'merge', command: [process.execPath, '-e', `const fs = require('node:fs'); const r = JSON.parse(fs.readFileSync(process.env.SF_REQUEST, 'utf8')); ${script}`] });
const WRITES_HEAD = `fs.writeFileSync(r.outputDir + '/head', r.head + '\\n');`;
const MERGE = (script: string) => ({ kind: 'command', run: [merge(script)], network: true, grants: ['github'], transitions: { PASS: 'AFTER' } });
const DEV = { kind: 'agent', role: 'developer', produces: 'commit', roleText: 'You are the developer for the ticket below.', transitions: { PASS: 'CHECK' } };
const AFTER = { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 1, transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } };

/** DEV, CHECK, REVIEW, MERGE, AFTER; a REVIEW FAIL goes to FIX, which goes straight to MERGE without a review. */
const reviewed = (script = WRITES_HEAD) => ({
  start: 'DEV',
  stages: {
    DEV, CHECK: { kind: 'command', run: [{ name: 'ok', command: ['true'] }], transitions: { PASS: 'REVIEW' } },
    REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 2, transitions: { PASS: 'MERGE', FAIL: 'FIX' } },
    FIX: { kind: 'agent', role: 'developer', produces: 'commit', roleText: 'You are the developer for the ticket below.', transitions: { PASS: 'MERGE' } },
    MERGE: MERGE(script), AFTER,
  },
}) as unknown as Workflow;

let n = 0;
/** A scratch repository at the workflow's CHECK stage, verified, and a token file outside it. */
async function atReview(workflow: Workflow) {
  const root = join(dir, String(n++));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'initial');
  writeFileSync(join(root, 'gh-token'), `${TOKEN}\n`);
  const store = new EventStore(join(root, 'events.sqlite'), workflow);
  const runsDir = join(root, 'runs');
  const job: Job = { workId: 'w1', ticket: 'Create done.txt and commit it.', repo, checks: [] };
  const dev = await develop(store, developer, job, { deadlineMs: 20_000, runsDir });
  const { cycleId } = dev.cycle;
  const { head, base } = dev.cycle.candidate!;
  const opts: VerifyOptions = { deadlineMs: 20_000, runsDir, isolation: 'process-group', sandbox: { backend: 'bwrap', read: [NODE_PREFIX] }, grants: { github: { variable: 'GH_TOKEN', file: join(root, 'gh-token') } } };
  const checked = await verify(store, cycleId, job, opts);
  assert.equal(checked.cycle.stage, workflow.stages.REVIEW ? 'REVIEW' : 'MERGE', checked.cycle.escalation);
  return { root, repo, store, runsDir, job, cycleId, head, base, opts };
}

test('a grant stage on a head whose last verdict is for an older head escalates with nothing run (A-083 Q3)', async () => {
  const { repo, store, runsDir, job, cycleId, head, base, opts } = await atReview(reviewed());
  store.append(cycleId, { type: 'verdict', runId: 'r1', head, verdict: 'FAIL', findings: ['[minor] x'] });
  // A fix the workflow sends straight to MERGE: no stage has seen the new head.
  const fixed = git(repo, 'commit-tree', `${head}^{tree}`, '-p', head, '-m', 'fix');
  store.append(cycleId, { type: 'claim', runId: 'd2', base, runtime: 'claude' });
  assert.equal(store.append(cycleId, { type: 'developer_result', runId: 'd2', head: fixed, artifacts: [fixed] }).stage, 'MERGE');
  await assert.rejects(verify(store, cycleId, job, opts), new RegExp(`MERGE holds a grant, but the last outcome of CHECK \\(${head}\\), REVIEW \\(${head}\\) is not for the candidate ${fixed}`));
  assert.ok(!existsSync(join(runsDir, 'evidence', fixed, 'MERGE')), 'nothing was written or run');
  store.close();
});

test('a grant stage on a head no reviewer passed escalates with nothing run (A-083 Q3)', async () => {
  const unreviewed = { start: 'DEV', stages: { DEV, CHECK: { kind: 'command', run: [{ name: 'ok', command: ['true'] }], transitions: { PASS: 'MERGE' } }, MERGE: MERGE(WRITES_HEAD), AFTER } } as unknown as Workflow;
  const { store, runsDir, job, cycleId, head, opts } = await atReview(unreviewed);
  await assert.rejects(verify(store, cycleId, job, opts), new RegExp(`MERGE holds a grant, but no PASS verdict is for the candidate ${head}`));
  assert.ok(!existsSync(join(runsDir, 'evidence', head, 'MERGE')));
  store.close();
});

/** At MERGE on a reviewed head. */
async function atMerge(script: string) {
  const s = await atReview(reviewed(script));
  assert.equal(s.store.append(s.cycleId, { type: 'verdict', runId: 'r1', head: s.head, verdict: 'PASS' }).stage, 'MERGE');
  return s;
}

for (const [what, script, found] of [
  ['a missing', '', /no head file/],
  ['a different', `fs.writeFileSync(r.outputDir + '/head', '${'a'.repeat(40)}\\n');`, new RegExp(`head file names "${'a'.repeat(40)}"`)],
  ['the token as', `fs.writeFileSync(r.outputDir + '/head', process.env.GH_TOKEN);`, /head file names "\[grant github\]"/],
  // Followed, a symlink would have the controller read any file the owner can.
  ['a symlink as', `fs.writeFileSync(r.outputDir + '/real', r.head); fs.symlinkSync(r.outputDir + '/real', r.outputDir + '/head');`, /outputDir\/head is not a regular file/],
] as const) {
  test(`${what} output/head records a FAIL head check, with what was found, and escalates (A-083 Q4)`, async () => {
    const { store, job, cycleId, head, opts } = await atMerge(script);
    const r = await verify(store, cycleId, job, opts);
    assert.equal(r.cycle.stage, 'ESCALATED');
    const v = r.cycle.history.at(-1)!.event;
    assert.deepEqual(v.type === 'verification' && v.checks, [{ name: 'merge', result: 'PASS' }, { name: 'head', result: 'FAIL' }]);
    const stdout = readFileSync(join(r.evidenceDir, 'head.stdout'), 'utf8');
    assert.match(stdout, found);
    assert.match(stdout, new RegExp(`candidate is ${head}`));
    assert.ok(!stdout.includes(TOKEN), stdout);
    store.close();
  });
}

test('the right output/head passes, and a printed token reaches the evidence and the next reviewer only as [grant github]', async () => {
  const { store, runsDir, job, cycleId, head, opts } = await atMerge(`${WRITES_HEAD} console.log('token ' + process.env.GH_TOKEN); console.error(process.env.GH_TOKEN + '!');`);
  const r = await verify(store, cycleId, job, opts);
  assert.equal(r.cycle.stage, 'AFTER', r.cycle.escalation);
  assert.equal(readFileSync(join(r.evidenceDir, 'merge.stdout'), 'utf8'), 'token [grant github]\n');
  assert.equal(readFileSync(join(r.evidenceDir, 'merge.stderr'), 'utf8'), '[grant github]!\n');
  assert.ok(!existsSync(join(r.evidenceDir, 'head.stdout')), 'a passing head check leaves no evidence, as the tree check');
  const reviewer = fakeAdapter({ outcome: { status: 'completed', claim: { head, verdict: 'PASS', findings: [] } } });
  const c = await review(store, reviewer, cycleId, job, { deadlineMs: 20_000, runsDir });
  assert.equal(c.stage, 'ACCEPTED', c.escalation);
  const prompt = reviewer.requests[0]!.prompt;
  assert.match(prompt, /EVIDENCE MERGE\/merge\.stdout ====\ntoken \[grant github\]$/m);
  assert.ok(!prompt.includes(TOKEN));
  store.close();
});

test('a command that locks outputDir still has its head read and its verification recorded (10-e standard 1)', async () => {
  const { store, job, cycleId, opts } = await atMerge(`${WRITES_HEAD} fs.chmodSync(r.outputDir, 0);`);
  const r = await verify(store, cycleId, job, opts);
  assert.equal(r.cycle.stage, 'AFTER', r.cycle.escalation);
  store.close();
});

test('an empty grant file is refused before the stage folder is touched', async () => {
  const { root, store, runsDir, job, cycleId, head, opts } = await atMerge(WRITES_HEAD);
  writeFileSync(join(root, 'gh-token'), '\n');
  await assert.rejects(verify(store, cycleId, job, opts), /grant github: file .*gh-token is empty/);
  assert.ok(!existsSync(join(runsDir, 'evidence', head, 'MERGE')));
  store.close();
});
