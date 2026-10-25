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

for (const [env, message] of [[['1BAD'], /not a variable name/], [['HOME'], /set by the sandbox/], [['SF_UNSET_TOKEN'], /not set/]] as const) test(`controller refuses sandbox env ${env[0]} before opening work`, t => {
  const { options, refuses } = fixture(t);
  options.agents.one.sandbox.env = [...env];
  delete process.env.SF_UNSET_TOKEN;
  refuses(message);
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

test('stage execution delivers stdin and collects both streams and the exit status', async t => {
  const { options, runtime } = fixture(t);
  runtime.start = async (_request, context) => {
    const run = await context.execute(['sh', '-c', 'cat; printf error >&2; exit 3'], { input: 'request\n' });
    assert.equal(run.status, 'exited');
    assert.equal(run.exitCode, 3);
    assert.equal(run.stdout, 'request\n');
    assert.equal(run.stderr, 'error');
    assert.ok(run.wallMs >= 0);
  };
  const controller = new Controller(options); t.after(() => controller.close());
  controller.open('work', 'one', '');
  assert.equal((await controller.advance('work')).stage, 'DONE');
});

for (const stream of ['stdout', 'stderr']) test(`stage execution bounds ${stream} and ends the sandbox on overflow`, async t => {
  const { options, runtime } = fixture(t);
  runtime.start = async (_request, context) => {
    const run = await context.execute(['node', '-e', `const stream=process.${stream}; const chunk='x'.repeat(65536); function flood(){while(stream.write(chunk)){} stream.once('drain',flood)} flood();`]);
    assert.equal(run.status, 'overflow');
    assert.equal(run.stdout, '');
    assert.match(run.stderr, new RegExp(`${stream} exceeded 8388608 bytes`));
  };
  const controller = new Controller(options); t.after(() => controller.close());
  controller.open('work', 'one', '');
  assert.equal((await controller.advance('work')).stage, 'DONE');
});

test('a stage execution signal cancels only its command', async t => {
  const { options, runtime } = fixture(t);
  runtime.start = async (_request, context) => {
    const signal = AbortSignal.timeout(100);
    const run = await context.execute(['sh', '-c', 'while true; do sleep 1; done'], { signal });
    assert.equal(run.status, 'cancelled');
    assert.notEqual(run.exitCode, 0);
    const next = await context.execute(['true']);
    assert.equal(next.status, 'exited');
    assert.equal(next.exitCode, 0);
  };
  const controller = new Controller(options); t.after(() => controller.close());
  controller.open('work', 'one', '');
  assert.equal((await controller.advance('work')).stage, 'DONE');
});


test('stage execution collects the normal-exit output tail before resolving', async t => {
  const { options, runtime } = fixture(t);
  runtime.start = async (_request, context) => {
    const run = await context.execute(['node', '-e', "process.stdout.write('x'.repeat(1000000)+'stdout-tail'); process.stderr.write('y'.repeat(1000000)+'stderr-tail')"]);
    assert.equal(run.exitCode, 0);
    assert.equal(run.stdout, 'x'.repeat(1000000) + 'stdout-tail');
    assert.equal(run.stderr, 'y'.repeat(1000000) + 'stderr-tail');
  };
  const controller = new Controller(options); t.after(() => controller.close());
  controller.open('work', 'one', '');
  assert.equal((await controller.advance('work')).stage, 'DONE');
});

for (const timing of ['before', 'after']) test(`execution handles a signal aborted ${timing} its command`, async t => {
  const { options, runtime } = fixture(t);
  runtime.start = async (_request, context) => {
    const abort = new AbortController();
    if (timing === 'before') abort.abort();
    const run = await context.execute(['true'], { signal: abort.signal });
    assert.equal(run.status, timing === 'before' ? 'cancelled' : 'exited');
    abort.abort();
    const next = await context.execute(['true']);
    assert.equal(next.status, 'exited');
    assert.equal(next.exitCode, 0);
  };
  const controller = new Controller(options); t.after(() => controller.close());
  controller.open('work', 'one', '');
  assert.equal((await controller.advance('work')).stage, 'DONE');
});
