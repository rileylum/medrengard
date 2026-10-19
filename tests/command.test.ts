// Ticket 10-c: a command stage runs its own commands (`run`) in the sandbox, with its context in
// the file SF_REQUEST names, an outputDir of its own, network off unless it asks, and a SHA-256 of
// each file argument it runs from beside the workflow. Offline: the developer is the fixture CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EventStore } from '../src/store.ts';
import { claude, cliAdapter } from '../src/runtime/cli-adapter.ts';
import { develop, type Job } from '../src/developer.ts';
import type { Workflow } from '../src/lifecycle.ts';
import { verify, type Check, type VerifyOptions } from '../src/verify.ts';

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
