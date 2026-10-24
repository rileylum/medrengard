import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, type Options, type Runtime } from '../src/index.ts';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-sandbox-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let starts = 0;
  const runtime: Runtime = {
    async start() { starts++; }, async cancel() {}, async *events() {},
    async result() { return { outcome: 'done', artifact: { kind: 'document', content: 'document' } }; },
  };
  const options: Options = {
    path: join(dir, 'events.sqlite'), directory: join(dir, 'runs'),
    workflows: [{ name: 'one', start: 'agent', stages: {
      agent: { kind: 'agent', agent: 'one', produces: 'document', budget: 1, on: { done: 'DONE' } },
    } }],
    agents: { one: { runtime: 'stub', role: '', skills: [], mcpServers: {}, sandbox: { backend: 'bwrap' } } },
    runtimes: { stub: runtime },
  };
  const refuses = (message: RegExp) => {
    assert.throws(() => { const controller = new Controller(options); controller.close(); }, message);
    assert.equal(starts, 0);
    assert.equal(existsSync(options.path), false, 'invalid setup created a log that could spend budget');
    assert.equal(existsSync(options.directory), false, 'invalid setup created work storage');
  };
  return { dir, options, runtime, refuses };
}

for (const read of ['relative/path', 'missing']) test(`controller refuses ${read} sandbox reads before opening work`, t => {
  const { dir, options, refuses } = fixture(t);
  options.agents.one.sandbox.read = [read === 'missing' ? join(dir, 'missing') : read];
  refuses(read === 'missing' ? /does not exist/ : /absolute/);
});

for (const backend of ['none', 'docker']) test(`controller refuses the ${backend} backend before opening work`, t => {
  const { options, refuses } = fixture(t);
  options.agents.one.sandbox.backend = backend;
  refuses(/sandbox backend must be bwrap/);
});

for (const kind of ['agent', 'command'] as const) test(`controller requires working bwrap for ${kind} workflows at setup`, t => {
  const { dir, options, refuses } = fixture(t);
  if (kind === 'command') {
    options.agents = {};
    options.workflows[0].stages.agent = { kind, command: ['true'], budget: 1, on: { PASS: 'DONE' } };
  }
  const path = process.env.PATH;
  process.env.PATH = join(dir, 'empty-path');
  try { refuses(/bwrap cannot start/); }
  finally { process.env.PATH = path; }
});

test('controller executes with the declared read path mounted read-only', async t => {
  const { dir, options, runtime } = fixture(t);
  const file = join(dir, 'declared.txt');
  writeFileSync(file, 'owner data\n');
  options.agents.one.sandbox.read = [file];
  let content = '';
  runtime.start = async (_request, context) => {
    const run = await context.execute(['sh', '-c', 'cat "$1"; ! printf changed > "$1"', 'read', file]);
    assert.equal(run.exitCode, 0, run.stderr);
    content = run.stdout;
  };
  runtime.result = async () => ({ outcome: 'done', artifact: { kind: 'document', content } });
  const controller = new Controller(options);
  t.after(() => controller.close());
  controller.open('work', 'one', '');
  const state = await controller.advance('work');
  assert.equal(state.stage, 'DONE', state.reason);
  assert.equal(state.spent.agent, 1);
  assert.equal(state.artifacts[0].content, 'owner data\n');
  assert.equal(readFileSync(file, 'utf8'), 'owner data\n');
});
