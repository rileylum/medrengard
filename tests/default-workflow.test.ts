import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Controller, type AgentRequest, type Artifact, type Options, type Runtime } from '../src/index.ts';
import { defaultWorkflows, exampleAdversarial, exampleDeveloper, examplePlanner, exampleReviewer } from '../workflows/default.ts';

// Verdict lists are consumed in order; a check of 'FAIL' fails on the current commit.
function setup(t: TestContext, { reviews = ['FAIL', 'PASS', 'FAIL', 'PASS'], adversarial = ['PASS', 'PASS'], checks = [] as string[], deviate = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'factory-default-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = join(directory, 'repository');
  execFileSync('git', ['init', '-q', repository]);
  execFileSync('git', ['-C', repository, '-c', 'user.name=Owner', '-c', 'user.email=owner@test', 'commit', '--allow-empty', '-qm', 'base']);
  let result: unknown;
  let commits = 0;
  const designs: { feedback?: string; head: string }[] = [];
  const developers: AgentRequest[] = [];
  const runtime: Runtime = {
    async start(request, context) {
      let artifact;
      if (request.agent.role === 'designer') {
        const head = await context.execute(['git', 'rev-parse', 'HEAD']);
        designs.push({ feedback: request.feedback, head: head.stdout.trim() });
        artifact = { kind: 'document', content: designs.length === 1 ? 'Write an answer.' : `Write an answer. ${request.feedback}` };
      }
      else if (request.agent.role === 'developer') {
        developers.push(request);
        assert.match(context.artifacts.findLast(a => a.kind === 'document')!.content!, /^Write an answer\./);
        const run = await context.execute(['sh', '-c', `set -e; printf 'answer ${++commits}' > answer; git add answer; git -c user.name=Stub -c user.email=stub@test commit -qm answer; git rev-parse HEAD`]);
        assert.equal(run.exitCode, 0, run.stderr);
        artifact = { kind: 'commit', sha: run.stdout.trim() };
      } else {
        const verdict = (request.agent.role === 'standard' ? reviews : adversarial).shift();
        artifact = { kind: 'verdict', verdict, subject: context.subject, findings: verdict === 'FAIL' ? [`${request.agent.role} finding`] : [] };
      }
      result = { outcome: artifact.kind === 'verdict' ? artifact.verdict : deviate && commits === 1 ? 'deviated' : 'done', artifact };
    },
    async result() { return result; }, async cancel() {}, async *events() {},
  };
  const prs: { sha: string; package: Artifact[] }[] = [];
  const options: Options = {
    path: join(directory, 'events.sqlite'), directory: join(directory, 'runs'), repository,
    workflows: defaultWorkflows(),
    agents: Object.fromEntries(['designer', 'developer', 'standard', 'adversarial'].map(role => [role, { runtime: 'stub', role, skills: [], mcpServers: {}, sandbox: { backend: 'bwrap' } }])),
    runtimes: { stub: runtime }, extensions: {
      check: async context => {
        const verdict = checks.shift() ?? 'PASS';
        return { outcome: verdict, artifact: { kind: 'verdict', verdict, subject: context.subject, findings: [], content: `check ${verdict}` } };
      },
      pr: async context => {
        prs.push({ sha: context.subject!, package: context.artifacts });
        return { outcome: 'done', artifact: { kind: 'document', subject: context.subject, content: 'https://fake.invalid/pr/1' } };
      },
    },
  };
  const controller = new Controller(options); t.after(() => controller.close());
  return { controller, prs, designs, developers, repository, commits: () => commits };
}

async function toOwner(controller: Controller, id: string) {
  controller.open(id, 'design', 'Make an answer');
  const spec = await controller.advance(id);
  assert.equal(spec.stage, 'approve', spec.reason);
  controller.decide(id, 'accept', spec.subject!);
  return controller.advance(id);
}

test('shipped workflow fixes a failed review, takes owner feedback to the developer and opens a PR on the accepted SHA', async t => {
  const { controller, prs, commits, developers } = setup(t);
  const first = await toOwner(controller, 'idea');
  assert.equal(first.stage, 'owner', first.reason);
  assert.equal(first.spent.standard, 2);
  assert.equal(first.spent.adversarial, 1);
  assert.equal(commits(), 2);
  assert.equal((await controller.advance('idea')).spent.standard, 2);
  assert.equal(prs.length, 0);
  assert.throws(() => controller.decide('idea', 'changes', 'stale'), /stale/);
  controller.decide('idea', 'changes', first.subject!, 'Say it louder.');
  assert.deepEqual(Object.keys(controller.state('idea').spent), []);
  const second = await controller.advance('idea');
  assert.equal(second.stage, 'owner', second.reason);
  assert.equal(developers[2].feedback, 'Say it louder.');
  assert.equal(commits(), 4);
  assert.notEqual(second.subject, first.subject);
  assert.throws(() => controller.decide('idea', 'accept', first.subject!), /stale/);
  controller.decide('idea', 'accept', second.subject!);
  assert.equal((await controller.advance('idea')).stage, 'DONE');
  assert.equal(prs.length, 1);
  assert.equal(prs[0].sha, second.subject);
  assert.deepEqual(prs[0].package.filter(a => a.subject === second.subject).map(a => [a.stage, a.verdict]), [['check', 'PASS'], ['standard', 'PASS'], ['adversarial', 'PASS']]);
});

test('the worst case spends every fix and review and still reaches the owner, never a budget escalation', async t => {
  const { controller, prs, commits } = setup(t, { checks: ['FAIL', 'FAIL'], reviews: ['FAIL', 'PASS'], adversarial: ['FAIL'] });
  const state = await toOwner(controller, 'worst');
  assert.equal(state.stage, 'owner', state.reason);
  assert.deepEqual({ ...state.spent }, { develop: 1, check: 4, fix: 3, standard: 2, adversarial: 1 });
  assert.equal(commits(), 4);
  assert.deepEqual(state.evidence.map(a => [a.stage, a.verdict]), [['check', 'PASS'], ['standard', 'PASS'], ['adversarial', 'FAIL']]);
  assert.equal(prs.length, 0);
});

for (const [name, options, failed] of [
  ['a check that keeps failing', { checks: ['FAIL', 'FAIL', 'FAIL'] }, 'check'],
  ['a second standard failure', { reviews: ['FAIL', 'FAIL'] }, 'standard'],
  ['an adversarial failure', { reviews: ['PASS'], adversarial: ['FAIL'] }, 'adversarial'],
] as const) test(`shipped workflow takes ${name} to the owner, who can reject it`, async t => {
  const { controller, prs } = setup(t, options);
  const state = await toOwner(controller, 'failure');
  assert.equal(state.stage, 'owner', state.reason);
  assert.equal(state.artifacts.at(-1)?.verdict, 'FAIL');
  assert.equal(state.artifacts.at(-1)?.stage, failed);
  const eventCount = controller.events().length;
  await controller.advance('failure');
  assert.equal(controller.events().length, eventCount);
  controller.decide('failure', 'reject', state.subject!);
  assert.equal((await controller.advance('failure')).stage, 'ESCALATED');
  assert.equal(prs.length, 0);
});

test('a commit that departs from the plan stops for the owner before check and review, under outcomes of its own', async t => {
  const { controller, prs } = setup(t, { reviews: ['PASS'], adversarial: ['PASS'], deviate: true });
  const state = await toOwner(controller, 'deviate');
  assert.equal(state.stage, 'deviation', state.reason);
  assert.equal(state.spent.check, undefined);
  // An accept meant for the publication gate cannot pass this one, and the reverse.
  assert.throws(() => controller.decide('deviate', 'accept', state.subject!), /unclassified outcome accept/);
  controller.decide('deviate', 'proceed', state.subject!);
  const owner = await controller.advance('deviate');
  assert.equal(owner.stage, 'owner', owner.reason);
  assert.equal(owner.subject, state.subject);
  assert.throws(() => controller.decide('deviate', 'proceed', owner.subject!), /unclassified outcome proceed/);
  assert.equal(prs.length, 0);
});

test('automatic workflow handoffs cannot reset budgets in a cycle', () => {
  for (const destinations of [['one'], ['two', 'one']]) {
    const names = ['one', 'two'];
    assert.throws(() => new Controller({ path: ':memory:', directory: tmpdir(), agents: {}, runtimes: {}, extensions: { handoff: async () => ({}) },
      workflows: destinations.map((next, i) => ({ name: names[i], start: 'handoff', stages: {
        handoff: { kind: 'command', extension: 'handoff', budget: 1, on: { PASS: { workflow: next } } },
      } })),
    }), /handoffs.*cycle/);
  }
});

test('shipped design reads the repository and revises the plan with the owner feedback before development', async t => {
  const { controller, designs, repository, commits } = setup(t, { reviews: ['PASS'], adversarial: ['PASS'] });
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

test('the example agents carry their role and the workflow guide; the planner adds the plan skill plugin', () => {
  const sandbox = { backend: 'bwrap', network: true };
  const planner = examplePlanner('claude', sandbox);
  assert.equal(planner.runtime, 'claude');
  assert.deepEqual(planner.sandbox, { backend: 'bwrap', network: true, read: planner.skills });
  assert.equal(planner.skills.length, 1);
  assert.match(readFileSync(join(planner.skills[0], 'skills', 'plan', 'SKILL.md'), 'utf8'), /^---\nname: plan\n/);
  assert.equal(JSON.parse(readFileSync(join(planner.skills[0], '.claude-plugin', 'plugin.json'), 'utf8')).name, 'medrengard-plan');
  for (const [agent, role] of [[planner, 'planner'], [exampleDeveloper('claude', sandbox), 'developer'], [exampleReviewer('claude', sandbox), 'reviewer'], [exampleAdversarial('claude', sandbox), 'adversarial reviewer']] as const) {
    assert.match(agent.role, new RegExp(`^You are the ${role}\\.`));
    assert.match(agent.role, /## The workflow you are part of/);
  }
  assert.deepEqual(exampleDeveloper('claude', sandbox), { runtime: 'claude', role: exampleDeveloper('claude', sandbox).role, skills: [], mcpServers: {}, sandbox });
});
