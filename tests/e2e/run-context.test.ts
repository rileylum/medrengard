// What a run is told about itself, and what the log keeps about it.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Controller, type AgentRequest, type Options, type Runtime, type Stage, type StageContext } from '../../src/index.ts';

function setup(t: TestContext, stages: Record<string, Stage>, overrides: Partial<Options> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-context-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repository = join(dir, 'repository');
  execFileSync('git', ['init', '-q', repository]);
  execFileSync('git', ['-C', repository, '-c', 'user.name=Owner', '-c', 'user.email=owner@test', 'commit', '--allow-empty', '-qm', 'base']);
  const requests: AgentRequest[] = [];
  let result: unknown;
  const runtime: Runtime = {
    async start(request, context) {
      requests.push(request);
      const run = await context.execute(['sh', '-c', 'set -e; printf answer > answer; git add answer; git -c user.name=Stub -c user.email=stub@test commit -qm answer; git rev-parse HEAD']);
      assert.equal(run.exitCode, 0, run.stderr);
      result = { outcome: 'done', artifact: { kind: 'commit', sha: run.stdout.trim() } };
    },
    async result() { return result; }, async cancel() {}, async *events() {},
  };
  const options: Options = {
    path: join(dir, 'events.sqlite'), directory: join(dir, 'runs'), repository, deadlineMs: 5000,
    workflows: [{ name: 'one', start: Object.keys(stages)[0], stages }],
    agents: { developer: { runtime: 'stub', role: 'developer', skills: [], mcpServers: {}, sandbox: { backend: 'bwrap' } } },
    runtimes: { stub: runtime }, ...overrides,
  };
  const controller = new Controller(options); t.after(() => controller.close());
  controller.open('work', 'one', 'idea');
  return { controller, repository, requests };
}

test('the runtime is told the output contract its stage needs', async t => {
  const { controller, requests } = setup(t, { develop: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'DONE' } } });
  assert.equal((await controller.advance('work')).stage, 'DONE');
  assert.equal(requests[0].produces, 'commit');
});

test('a copy of the commit carries its history and the base the work started from, unless the stage declines it', async t => {
  const seen: Record<string, { context: StageContext; output: string }> = {};
  const inspect = (name: string) => async (context: StageContext) => {
    const run = await context.execute(['sh', '-c', 'git rev-parse HEAD && git diff --name-only "$1" HEAD && git status --porcelain && echo clean || echo no-history', 'inspect', context.base ?? 'none']);
    seen[name] = { context, output: run.stdout };
    return { outcome: 'done', artifact: { kind: 'document', subject: context.subject, content: 'inspected' } };
  };
  const { controller, repository } = setup(t, {
    develop: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'history' } },
    history: { kind: 'command', extension: 'history', budget: 1, on: { done: 'files' } },
    files: { kind: 'command', extension: 'files', access: { history: false }, budget: 1, on: { done: 'DONE' } },
  }, { extensions: { history: inspect('history'), files: inspect('files') } });
  const base = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const state = await controller.advance('work');
  assert.equal(state.stage, 'DONE', state.reason);
  assert.equal(seen.history.context.base, base);
  assert.equal(seen.history.context.work, 'work');
  assert.equal(seen.history.output, `${state.subject}\nanswer\nclean\n`);
  assert.equal(seen.files.output, 'no-history\n');
  assert.equal(controller.events().find(e => e.type === 'workspace')!.base, base);
});

test('every event records when it happened', async t => {
  const { controller } = setup(t, { develop: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'DONE' } } });
  const before = Date.now();
  await controller.advance('work');
  const times = controller.events().map(e => Date.parse(e.time as string));
  assert.ok(times.length >= 4);
  assert.ok(times.every(time => time >= before - 1000 && time <= Date.now()));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('a runtime streams output as events while its process runs, and they are kept when the deadline kills it', async t => {
  const lines: string[] = [];
  let finished = false;
  let wake = () => {};
  const runtime: Runtime = {
    async start(_request, context) {
      void context.execute(['sh', '-c', 'echo one; echo two; sleep 30'], { onStdout: chunk => { lines.push(...chunk.split('\n').filter(Boolean)); wake(); } })
        .then(() => { finished = true; wake(); });
    },
    async *events() {
      while (true) {
        while (lines.length) yield { line: lines.shift() };
        if (finished) return;
        await new Promise<void>(resolve => { wake = resolve; });
      }
    },
    async result() { return new Promise(() => {}); }, async cancel() {},
  };
  const { controller } = setup(t, { plan: { kind: 'agent', agent: 'planner', produces: 'document', budget: 1, on: { done: 'DONE' } } }, {
    deadlineMs: 1500, runtimes: { stream: runtime },
    agents: { planner: { runtime: 'stream', role: 'planner', skills: [], mcpServers: {}, sandbox: { backend: 'bwrap' } } },
  });
  const state = await controller.advance('work');
  assert.equal(state.stage, 'ESCALATED');
  assert.match(state.reason!, /deadline/);
  assert.deepEqual(controller.events().filter(e => e.type === 'runtime').map(e => e.event), [{ line: 'one' }, { line: 'two' }]);
});

test('a streamed run can skip the output buffer, so a long transcript does not overflow it', async t => {
  let received = 0;
  let run: Awaited<ReturnType<StageContext['execute']>> | undefined;
  const runtime: Runtime = {
    async start(_request, context) {
      run = await context.execute([process.execPath, '-e', "for (let i = 0; i < 10; i++) process.stdout.write('x'.repeat(1024 * 1024))"], { buffer: false, onStdout: chunk => { received += Buffer.byteLength(chunk); } });
    },
    async result() { return { outcome: 'done', artifact: { kind: 'document', content: 'streamed' } }; }, async cancel() {}, async *events() {},
  };
  const { controller } = setup(t, { plan: { kind: 'agent', agent: 'planner', produces: 'document', access: { read: [dirname(dirname(realpathSync(process.execPath)))] }, budget: 1, on: { done: 'DONE' } } }, {
    runtimes: { stream: runtime }, agents: { planner: { runtime: 'stream', role: 'planner', skills: [], mcpServers: {}, sandbox: { backend: 'bwrap' } } },
  });
  assert.equal((await controller.advance('work')).stage, 'DONE');
  assert.equal(run!.status, 'exited');
  assert.equal(run!.stdout, '');
  assert.equal(received, 10 * 1024 * 1024);
});
