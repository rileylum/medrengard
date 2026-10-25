// The Claude Code runtime runs `claude -p` in the agent's sandbox with only what the agent declares,
// and the final message becomes the stage's document.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Controller, type Workflow } from '../src/index.ts';
import { claudeCodeRuntime } from '../extensions/claude-code/index.ts';

const NODE_PREFIX = dirname(dirname(realpathSync(process.execPath)));
// Reports its arguments and prompt as the result; a role of "fail" reports an error result.
const FAKE = `const argv = process.argv.slice(2); const stdin = require('fs').readFileSync(0, 'utf8');
const failed = argv[argv.indexOf('--append-system-prompt') + 1] === 'fail';
console.log(JSON.stringify({ type: 'result', is_error: failed, result: failed ? 'refused' : JSON.stringify({ argv, stdin }) }));`;

function setup(t: TestContext, role = 'You are the planner.', settingSources?: string[], model?: string) {
  const dir = mkdtempSync('/var/tmp/medrengard-claude-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repository = join(dir, 'repository');
  execFileSync('git', ['init', '-q', repository]);
  execFileSync('git', ['-C', repository, '-c', 'user.name=Owner', '-c', 'user.email=owner@test', 'commit', '--allow-empty', '-qm', 'base']);
  const fake = join(dir, 'claude.js'); writeFileSync(fake, FAKE);
  const skill = join(dir, 'plan-skill'); execFileSync('mkdir', [skill]);
  const plan: Workflow = { name: 'plan', start: 'design', stages: {
    design: { kind: 'agent', agent: 'planner', produces: 'document', access: { workspace: 'repository' }, budget: 1, on: { done: 'approve' } },
    approve: { kind: 'human', on: { approve: 'DONE', changes: { workflow: 'plan' } } },
  } };
  const controller = new Controller({
    path: join(dir, 'events.sqlite'), directory: join(dir, 'runs'), repository, workflows: [plan],
    agents: { planner: { runtime: 'claude', role, skills: [skill], mcpServers: {}, sandbox: { backend: 'bwrap', read: [NODE_PREFIX, fake, skill] } } },
    runtimes: { claude: claudeCodeRuntime({ command: [process.execPath, fake], settingSources, model }) },
  });
  t.after(() => controller.close());
  return { controller, skill };
}
const reported = (content: string | undefined) => JSON.parse(content!) as { argv: string[]; stdin: string };

test('claude -p runs with the role, skills, read-only tools, the Skill tool and user settings only by default', async t => {
  const { controller, skill } = setup(t);
  controller.open('rifle', 'plan', 'remove the hit sound from rifle hits');
  const state = await controller.advance('rifle');
  assert.equal(state.stage, 'approve', state.reason);
  assert.equal(state.artifacts[0].kind, 'document');
  assert.deepEqual(reported(state.artifacts[0].content).argv, [
    '-p', '--output-format', 'json', '--no-session-persistence', '--setting-sources', 'user',
    '--tools', 'Read,Grep,Glob,Skill', '--strict-mcp-config', '--append-system-prompt', 'You are the planner.', '--plugin-dir', skill,
  ]);
  assert.equal(reported(state.artifacts[0].content).stdin, 'remove the hit sound from rifle hits\n');
});

test('the revised run receives the previous plan and the owner feedback', async t => {
  const { controller } = setup(t, 'You are the planner.', ['project']);
  controller.open('rifle', 'plan', 'remove the hit sound from rifle hits');
  const first = await controller.advance('rifle');
  controller.decide('rifle', 'changes', first.subject!, 'Keep the knife hit sounds.');
  const second = await controller.advance('rifle');
  const { argv, stdin } = reported(second.artifacts[1].content);
  assert.deepEqual(argv.slice(argv.indexOf('--setting-sources'), argv.indexOf('--setting-sources') + 2), ['--setting-sources', 'project']);
  assert.equal(stdin, `remove the hit sound from rifle hits\n\nPrevious plan:\n${first.artifacts[0].content}\n\nOwner feedback:\nKeep the knife hit sounds.\n`);
});

test('an error result escalates the work without a document', async t => {
  const { controller } = setup(t, 'fail');
  controller.open('rifle', 'plan', 'remove the hit sound from rifle hits');
  const state = await controller.advance('rifle');
  assert.equal(state.stage, 'ESCALATED');
  assert.match(state.reason!, /refused/);
  assert.equal(state.artifacts.length, 0);
});

test('a configured model is passed to claude unchanged', async t => {
  const { controller } = setup(t, 'You are the planner.', undefined, 'opus');
  controller.open('rifle', 'plan', 'remove the hit sound from rifle hits');
  const { argv } = reported((await controller.advance('rifle')).artifacts[0].content);
  assert.deepEqual(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2), ['--model', 'opus']);
});
