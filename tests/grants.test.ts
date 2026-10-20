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
