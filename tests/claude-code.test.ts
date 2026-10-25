// The Claude Code runtime runs `claude -p` in the agent's sandbox with only what the agent declares, keeps the whole
// stream-json transcript as runtime events, and turns the result into the artifact its stage produces.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Controller, type Agent, type Artifact, type StageContext, type Workflow } from '../src/index.ts';
import { claudeCodeRuntime, defaultPrompt } from '../extensions/claude-code/index.ts';

const NODE_PREFIX = dirname(dirname(realpathSync(process.execPath)));
// Streams an init line, then acts on its role: a developer bumps `answer` (and may commit it itself), a reviewer fails
// an answer of 1, "fail" reports an error and "oversized" streams one huge line. The result reports argv and prompt.
const FAKE = `const fs = require('fs'); const { execFileSync } = require('child_process');
const argv = process.argv.slice(2); const stdin = fs.readFileSync(0, 'utf8');
const role = argv[argv.indexOf('--append-system-prompt') + 1];
const line = value => process.stdout.write(JSON.stringify(value) + '\\n');
line({ type: 'system', subtype: 'init', cwd: process.cwd() });
if (role === 'oversized') line({ type: 'assistant', text: 'x'.repeat(600 * 1024) });
let structured;
if (role.startsWith('developer')) {
  const n = fs.existsSync('answer') ? Number(fs.readFileSync('answer', 'utf8')) + 1 : 1;
  fs.writeFileSync('answer', String(n));
  if (role.includes('self-commit')) {
    execFileSync('git', ['add', 'answer']); execFileSync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@test', 'commit', '-qm', 'agent commit']);
    fs.writeFileSync('extra', 'left out');
  }
}
if (argv.includes('--json-schema')) structured = fs.readFileSync('answer', 'utf8') === '1' ? { verdict: 'FAIL', findings: ['answer must be 2'] } : { verdict: 'PASS', findings: [] };
line({ type: 'result', is_error: role === 'fail', result: role === 'fail' ? 'refused' : JSON.stringify({ argv, stdin }), structured_output: structured });`;

function setup(t: TestContext, runtime: Parameters<typeof claudeCodeRuntime>[0] extends infer O ? Omit<O, 'command'> : never = {}, roles: Record<string, string> = {}) {
  const dir = mkdtempSync('/var/tmp/medrengard-claude-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repository = join(dir, 'repository');
  execFileSync('git', ['init', '-q', repository]);
  execFileSync('git', ['-C', repository, '-c', 'user.name=Owner', '-c', 'user.email=owner@test', 'commit', '--allow-empty', '-qm', 'base']);
  const fake = join(dir, 'claude.js'); writeFileSync(fake, FAKE);
  const skill = join(dir, 'plan-skill'); execFileSync('mkdir', [skill]);
  const workflow: Workflow = { name: 'full', start: 'design', stages: {
    design: { kind: 'agent', agent: 'planner', produces: 'document', access: { workspace: 'repository' }, budget: 1, on: { done: 'approve' } },
    approve: { kind: 'human', on: { accept: 'develop', changes: { workflow: 'full' } } },
    develop: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'review' } },
    review: { kind: 'agent', agent: 'reviewer', produces: 'verdict', budget: 2, on: { PASS: 'DONE', FAIL: ['fix', 'ESCALATED'] } },
    fix: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'review' } },
  } };
  const agent = (role: string, skills: string[] = []): Agent => ({ runtime: 'claude', role, skills, mcpServers: {}, sandbox: { backend: 'bwrap', read: [NODE_PREFIX, fake, ...skills] } });
  const controller = new Controller({
    path: join(dir, 'events.sqlite'), directory: join(dir, 'runs'), repository, workflows: [workflow], deadlineMs: 10000,
    agents: { planner: agent(roles.planner ?? 'You are the planner.', [skill]), developer: agent(roles.developer ?? 'developer'), reviewer: agent('reviewer') },
    runtimes: { claude: claudeCodeRuntime({ command: [process.execPath, fake], ...runtime }) },
  });
  t.after(() => controller.close());
  controller.open('rifle', 'full', 'remove the hit sound from rifle hits');
  return { controller, skill, repository };
}
const reported = (content: string | undefined) => JSON.parse(content!) as { argv: string[]; stdin: string };
const flag = (argv: string[], name: string) => argv[argv.indexOf(name) + 1];

test('a planner runs claude -p with its role, skills, read-only tools and user settings only by default', async t => {
  const { controller, skill } = setup(t);
  const state = await controller.advance('rifle');
  assert.equal(state.stage, 'approve', state.reason);
  assert.equal(state.artifacts[0].kind, 'document');
  assert.deepEqual(reported(state.artifacts[0].content).argv, [
    '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--setting-sources', 'user',
    '--permission-mode', 'bypassPermissions', '--tools', 'Read,Grep,Glob,Skill', '--strict-mcp-config',
    '--append-system-prompt', 'You are the planner.', '--plugin-dir', skill,
  ]);
  assert.equal(reported(state.artifacts[0].content).stdin, 'remove the hit sound from rifle hits\n');
});

test('settings sources and the model are passed to claude unchanged', async t => {
  const { controller } = setup(t, { settingSources: ['project'], model: 'opus' });
  const { argv } = reported((await controller.advance('rifle')).artifacts[0].content);
  assert.equal(flag(argv, '--setting-sources'), 'project');
  assert.equal(flag(argv, '--model'), 'opus');
});

test('the whole stream is kept as runtime events, with a line too large for one event replaced by its size and head', async t => {
  const { controller } = setup(t, {}, { planner: 'oversized' });
  const state = await controller.advance('rifle');
  assert.equal(state.stage, 'approve', state.reason);
  const events = controller.events().filter(e => e.type === 'runtime').map(e => e.event as Record<string, unknown>);
  assert.deepEqual(events.map(e => e.type), ['system', 'oversized', 'result']);
  assert.ok((events[1].bytes as number) > 600 * 1024);
  assert.match(events[1].head as string, /^\{"type":"assistant","text":"x+$/);
});

test('an error result escalates the work without a document', async t => {
  const { controller } = setup(t, {}, { planner: 'fail' });
  const state = await controller.advance('rifle');
  assert.equal(state.stage, 'ESCALATED');
  assert.match(state.reason!, /refused/);
  assert.equal(state.artifacts.length, 0);
});

test('a developer edits, the runtime commits as the configured author, and a reviewer returns a verdict on that SHA', async t => {
  const { controller, repository } = setup(t, { author: { name: 'Factory', email: 'factory@test' } });
  const plan = await controller.advance('rifle');
  controller.decide('rifle', 'accept', plan.subject!);
  const state = await controller.advance('rifle');
  assert.equal(state.stage, 'DONE', state.reason);
  const base = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const commits = state.artifacts.filter(a => a.kind === 'commit');
  const verdicts = state.artifacts.filter(a => a.kind === 'verdict');
  assert.equal(commits.length, 2);
  assert.deepEqual(verdicts.map(v => [v.verdict, v.subject, v.findings]), [['FAIL', commits[0].sha, ['answer must be 2']], ['PASS', commits[1].sha, []]]);
  const developer = reported(commits[0].content);
  assert.equal(flag(developer.argv, '--tools'), 'Read,Grep,Glob,Skill,Bash,Edit,Write');
  assert.match(developer.stdin, new RegExp(`Approved plan:\\n${plan.artifacts[0].content!.replace(/[\\[\]{}()*+?.^$|]/g, '\\$&')}`));
  const show = (format: string, sha: string) => execFileSync('git', ['-C', commits[1].repository!, 'show', '-s', `--format=${format}`, sha], { encoding: 'utf8' }).trim();
  assert.equal(show('%an <%ae>', commits[0].sha!), 'Factory <factory@test>');
  assert.equal(show('%B', commits[0].sha!), commits[0].content);
  assert.equal(execFileSync('git', ['-C', commits[1].repository!, 'show', `${commits[1].sha}:answer`], { encoding: 'utf8' }), '2');
  // The fix is told what failed; the reviewer is told which change to review and how to answer.
  assert.match(reported(commits[1].content).stdin, /review FAIL:\n- answer must be 2/);
  const review = reported(verdicts[0].content);
  assert.equal(flag(review.argv, '--tools'), 'Read,Grep,Glob,Skill,Bash');
  assert.deepEqual(JSON.parse(flag(review.argv, '--json-schema')).required, ['verdict', 'findings']);
  assert.match(review.stdin, new RegExp(`Review the change ${base}\\.\\.${commits[0].sha}`));
});

test('a workflow can let the agent commit for itself; the runtime then commits nothing', async t => {
  const { controller } = setup(t, { commit: 'agent' }, { developer: 'developer self-commit' });
  controller.decide('rifle', 'accept', (await controller.advance('rifle')).subject!);
  const state = await controller.advance('rifle');
  const commit = state.artifacts.find(a => a.kind === 'commit')!;
  const files = execFileSync('git', ['-C', commit.repository!, 'show', '--name-only', '--format=%an', commit.sha!], { encoding: 'utf8' });
  assert.equal(files.trim(), 'Agent\n\nanswer');
});

test('tools and the prompt can be replaced per output', async t => {
  const prompts: string[] = [];
  const { controller } = setup(t, { tools: { document: ['Read'] }, prompt: (request, context) => { const text = defaultPrompt(request, context); prompts.push(text); return `custom\n${text}`; } });
  const { argv, stdin } = reported((await controller.advance('rifle')).artifacts[0].content);
  assert.equal(flag(argv, '--tools'), 'Read');
  assert.equal(stdin, `custom\n${prompts[0]}`);
});

test('the default prompt gives each output what it needs', () => {
  const doc = (content: string): Artifact => ({ kind: 'document', hash: content, stage: 'design', content });
  const fail = (stage: string, findings: string[], content = ''): Artifact => ({ kind: 'verdict', hash: stage, stage, subject: 'sha', verdict: 'FAIL', findings, content });
  const context = (artifacts: Artifact[]) => ({ work: 'w', subject: 'sha', base: 'base', artifacts } as unknown as StageContext);
  const request = (produces: 'commit' | 'document' | 'verdict', feedback?: string) => ({ runId: 'r', agent: {} as Agent, produces, input: 'idea', workspace: '/w', feedback });
  assert.equal(defaultPrompt(request('document', 'shorter'), context([doc('plan 1')])), 'idea\n\nPrevious plan:\nplan 1\n\nOwner feedback:\nshorter\n');
  const failures = [doc('plan'), fail('check', [], `${'early '.repeat(2000)}npm ERR! test failed`), fail('review', ['a', 'b']), { ...fail('review', ['old']), subject: 'older' }];
  assert.equal(defaultPrompt(request('commit'), context(failures)), `idea\n\nApproved plan:\nplan\n\ncheck FAIL:\n${`${'early '.repeat(2000)}npm ERR! test failed`.slice(-8000)}\n\nreview FAIL:\n- a\n- b\n`);
  assert.equal(defaultPrompt(request('verdict'), context([doc('plan')])), 'idea\n\nApproved plan:\nplan\n\nReview the change base..sha: run `git diff base HEAD` in your workspace to see it.\n');
});
