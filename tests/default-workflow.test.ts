import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Controller, type Artifact, type Options, type Runtime } from '../src/index.ts';
import { defaultWorkflows } from '../workflows/default.ts';

function setup(t: TestContext, reviews = ['FAIL', 'PASS', 'FAIL', 'PASS'], adversarial = ['PASS', 'PASS']) {
  const directory = mkdtempSync(join(tmpdir(), 'factory-default-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = join(directory, 'repository');
  execFileSync('git', ['init', '-q', repository]);
  execFileSync('git', ['-C', repository, '-c', 'user.name=Owner', '-c', 'user.email=owner@test', 'commit', '--allow-empty', '-qm', 'base']);
  let result: unknown;
  let commits = 0;
  const designs: { feedback?: string; head: string }[] = [];
  const runtime: Runtime = {
    async start(request, context) {
      let artifact;
      if (request.agent.role === 'designer') {
        const head = await context.execute(['git', 'rev-parse', 'HEAD']);
        designs.push({ feedback: request.feedback, head: head.stdout.trim() });
        artifact = { kind: 'document', content: designs.length === 1 ? 'Write an answer.' : `Write an answer. ${request.feedback}` };
      }
      else if (request.agent.role === 'developer') {
        assert.match(context.artifacts.findLast(a => a.kind === 'document')!.content!, /^Write an answer\./);
        const run = await context.execute(['sh', '-c', `set -e; printf 'answer ${++commits}' > answer; git add answer; git -c user.name=Stub -c user.email=stub@test commit -qm answer; git rev-parse HEAD`]);
        assert.equal(run.exitCode, 0, run.stderr);
        artifact = { kind: 'commit', sha: run.stdout.trim() };
      } else artifact = { kind: 'verdict', verdict: request.agent.role === 'standard' ? reviews.shift() : adversarial.shift(), subject: context.subject, findings: [] };
      result = { outcome: artifact.kind === 'verdict' ? artifact.verdict : 'done', artifact };
    },
    async result() { return result; }, async cancel() {}, async *events() {},
  };
  const prs: { sha: string; package: Artifact[] }[] = [];
  const options: Options = {
    path: join(directory, 'events.sqlite'), directory: join(directory, 'runs'), repository,
    workflows: defaultWorkflows(['node', '-e', "if(!require('fs').readFileSync('answer','utf8').startsWith('answer ')) process.exit(1)"]),
    agents: Object.fromEntries(['designer', 'developer', 'standard', 'adversarial'].map(role => [role, { runtime: 'stub', role, skills: [], mcpServers: {}, sandbox: { backend: 'bwrap' } }])),
    runtimes: { stub: runtime }, extensions: { pr: async context => {
      prs.push({ sha: context.subject!, package: context.artifacts });
      return { outcome: 'done', artifact: { kind: 'document', subject: context.subject, content: 'https://fake.invalid/pr/1' } };
    } },
  };
  const controller = new Controller(options); t.after(() => controller.close());
  return { controller, prs, designs, repository, commits: () => commits };
}

test('shipped workflow fixes a failed review and opens a PR after an owner-authorized revision', async t => {
  const { controller, prs, commits } = setup(t);
  controller.open('idea', 'design', 'Make an answer');
  const spec = await controller.advance('idea');
  assert.equal(spec.stage, 'approve', spec.reason);
  assert.equal(commits(), 0);
  controller.decide('idea', 'accept', spec.subject!);
  const first = await controller.advance('idea');
  assert.equal(first.stage, 'owner', first.reason);
  assert.equal(first.spent.standard, 2);
  assert.equal(first.spent.adversarial, 1);
  assert.equal(commits(), 2);
  assert.equal((await controller.advance('idea')).spent.standard, 2);
  assert.equal(prs.length, 0);
  assert.throws(() => controller.decide('idea', 'changes', 'stale'), /stale/);
  controller.decide('idea', 'changes', first.subject!);
  assert.deepEqual(Object.keys(controller.state('idea').spent), []);
  const second = await controller.advance('idea');
  assert.equal(second.stage, 'owner', second.reason);
  assert.equal(second.spent.standard, 2);
  assert.equal(second.spent.adversarial, 1);
  assert.equal(commits(), 4);
  assert.notEqual(second.subject, first.subject);
  assert.throws(() => controller.decide('idea', 'accept', first.subject!), /stale/);
  controller.decide('idea', 'accept', second.subject!);
  assert.equal((await controller.advance('idea')).stage, 'DONE');
  assert.equal(prs.length, 1);
  assert.equal(prs[0].sha, second.subject);
  assert.deepEqual(prs[0].package.filter(a => a.subject === second.subject).map(a => [a.stage, a.verdict]), [['check', 'PASS'], ['standard', 'PASS'], ['adversarial', 'PASS']]);
});

for (const gate of ['standard', 'adversarial']) test(`shipped workflow escalates terminal ${gate} failure without another attempt`, async t => {
  const { controller, prs, commits } = setup(t, gate === 'standard' ? ['FAIL', 'FAIL'] : ['PASS'], ['FAIL']);
  controller.open('failure', 'design', 'Make an answer');
  const spec = await controller.advance('failure');
  controller.decide('failure', 'accept', spec.subject!);
  const failed = await controller.advance('failure');
  assert.equal(failed.stage, 'ESCALATED', failed.reason);
  assert.equal(failed.spent.standard, gate === 'standard' ? 2 : 1);
  assert.equal(failed.spent.adversarial ?? 0, gate === 'standard' ? 0 : 1);
  assert.equal(commits(), gate === 'standard' ? 2 : 1);
  assert.equal(failed.artifacts.at(-1)?.verdict, 'FAIL');
  assert.equal(failed.artifacts.at(-1)?.stage, gate);
  const eventCount = controller.events().length;
  await controller.advance('failure');
  assert.equal(controller.events().length, eventCount);
  assert.equal(prs.length, 0);
});

test('automatic workflow handoffs cannot reset budgets in a cycle', () => {
  for (const destinations of [['one'], ['two', 'one']]) {
    const names = ['one', 'two'];
    assert.throws(() => new Controller({ path: ':memory:', directory: tmpdir(), agents: {}, runtimes: {},
      workflows: destinations.map((next, i) => ({ name: names[i], start: 'handoff', stages: {
        handoff: { kind: 'command', command: ['true'], budget: 1, on: { PASS: { workflow: next } } },
      } })),
    }), /handoffs.*cycle/);
  }
});

test('shipped design reads the repository and revises the plan with the owner feedback before development', async t => {
  const { controller, designs, repository, commits } = setup(t, ['PASS'], ['PASS']);
  controller.open('plan', 'design', 'Make an answer');
  const first = await controller.advance('plan');
  controller.decide('plan', 'changes', first.subject!, 'Keep it short.');
  const second = await controller.advance('plan');
  assert.equal(second.stage, 'approve', second.reason);
  assert.notEqual(second.subject, first.subject);
  const base = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.deepEqual(designs, [{ feedback: undefined, head: base }, { feedback: 'Keep it short.', head: base }]);
  assert.throws(() => controller.decide('plan', 'accept', first.subject!), /stale/);
  controller.decide('plan', 'accept', second.subject!);
  assert.equal((await controller.advance('plan')).stage, 'owner');
  assert.equal(commits(), 1);
});
