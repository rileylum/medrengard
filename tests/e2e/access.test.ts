// A stage declares what its processes can reach; defaults follow its output contract.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Controller, type Options, type Runtime, type Stage, type StageContext, type Workflow } from '../../src/index.ts';

const NODE_PREFIX = dirname(dirname(realpathSync(process.execPath)));

function setup(t: TestContext, stages: Record<string, Stage>, overrides: Partial<Options> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-access-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repository = join(dir, 'repository');
  execFileSync('git', ['init', '-q', repository]);
  execFileSync('git', ['-C', repository, '-c', 'user.name=Owner', '-c', 'user.email=owner@test', 'commit', '--allow-empty', '-qm', 'base']);
  let result: unknown;
  const runtime: Runtime = {
    async start(_request, context) {
      const run = await context.execute(['sh', '-c', 'set -e; printf answer > answer; git add answer; git -c user.name=Stub -c user.email=stub@test commit -qm answer; git rev-parse HEAD']);
      assert.equal(run.exitCode, 0, run.stderr);
      result = { outcome: 'done', artifact: { kind: 'commit', sha: run.stdout.trim() } };
    },
    async result() { return result; }, async cancel() {}, async *events() {},
  };
  const workflow: Workflow = { name: 'one', start: Object.keys(stages)[0], stages };
  const options: Options = {
    path: join(dir, 'events.sqlite'), directory: join(dir, 'runs'), repository, workflows: [workflow], deadlineMs: 5000,
    agents: { developer: { runtime: 'stub', role: 'developer', skills: [], mcpServers: {}, sandbox: { backend: 'bwrap' } } },
    runtimes: { stub: runtime }, ...overrides,
  };
  return { dir, repository, options, open: () => { const c = new Controller(options); t.after(() => c.close()); c.open('work', 'one', 'idea'); return c; } };
}

// Each probe reports what one stage's process could reach, as a document bound to the current subject.
function probe(script: (context: StageContext) => string[], seen: Record<string, string>, name: string) {
  return async (context: StageContext) => {
    const run = await context.execute(script(context));
    seen[name] = run.stdout;
    return { outcome: 'done', artifact: { kind: 'document', subject: context.subject, content: run.stdout || 'empty' } };
  };
}

test('a command stage runs owner code with the read paths, variables and network it declares, and no more', async t => {
  const server = createServer(s => s.end());
  await new Promise<void>(res => server.listen(0, '127.0.0.1', res));
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const shared = mkdtempSync(join(tmpdir(), 'factory-access-read-'));
  t.after(() => rmSync(shared, { recursive: true, force: true }));
  writeFileSync(join(shared, 'owner.txt'), 'owner data');
  process.env.SF_ACCESS_TOKEN = 'declared';
  t.after(() => { delete process.env.SF_ACCESS_TOKEN; });
  const seen: Record<string, string> = {};
  const script = () => [process.execPath, '-e', `
    const fs=require('fs');
    process.stdout.write('read=' + (()=>{try{return fs.readFileSync(${JSON.stringify(join(shared, 'owner.txt'))},'utf8')}catch{return 'no'}})() + ' env=' + (process.env.SF_ACCESS_TOKEN ?? 'unset'));
    require('net').connect(${port},'127.0.0.1').on('connect',()=>{process.stdout.write(' net=yes');process.exit(0)}).on('error',()=>{process.stdout.write(' net=no');process.exit(0)});`];
  const { open } = setup(t, {
    declared: { kind: 'command', extension: 'declared', produces: 'document', access: { read: [shared, NODE_PREFIX], env: ['SF_ACCESS_TOKEN'], network: true }, budget: 1, on: { done: 'undeclared' } },
    undeclared: { kind: 'command', extension: 'undeclared', produces: 'document', access: { read: [NODE_PREFIX] }, budget: 1, on: { done: 'DONE' } },
  }, { extensions: { declared: probe(script, seen, 'declared'), undeclared: probe(script, seen, 'undeclared') } });
  const state = await open().advance('work');
  assert.equal(state.stage, 'DONE', state.reason);
  assert.equal(seen.declared, 'read=owner data env=declared net=yes');
  assert.equal(seen.undeclared, 'read=no env=unset net=no');
});

test("an agent stage's access joins its agent's sandbox", async t => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-access-join-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['agent', 'stage']) writeFileSync(join(dir, name), name);
  let content = '';
  const runtime: Runtime = {
    async start(_request, context) { content = (await context.execute(['sh', '-c', `cat ${dir}/agent ${dir}/stage`])).stdout; },
    async result() { return { outcome: 'done', artifact: { kind: 'document', content } }; }, async cancel() {}, async *events() {},
  };
  const { open } = setup(t, {
    plan: { kind: 'agent', agent: 'planner', produces: 'document', access: { read: [join(dir, 'stage')] }, budget: 1, on: { done: 'DONE' } },
  }, { agents: { planner: { runtime: 'stub', role: 'planner', skills: [], mcpServers: {}, sandbox: { backend: 'bwrap', read: [join(dir, 'agent')] } } }, runtimes: { stub: runtime } });
  const state = await open().advance('work');
  assert.equal(state.stage, 'DONE', state.reason);
  assert.equal(content, 'agentstage');
});

test('write is none, scratch or full: /tmp always, a kept scratch folder from scratch up, the workspace only at full', async t => {
  const seen: Record<string, string> = {};
  const scratches: Record<string, string | undefined> = {};
  const script = (name: string) => (context: StageContext) => {
    scratches[name] = context.scratch;
    return ['sh', '-c', `
      cat answer
      touch workspace 2>/dev/null && echo ' workspace=yes' || echo ' workspace=no'
      touch /tmp/probe && echo 'tmp=yes' || echo 'tmp=no'
      if [ -n "$MEDRENGARD_SCRATCH" ] && echo ${name} > "$MEDRENGARD_SCRATCH/kept"; then echo 'scratch=yes'; else echo 'scratch=no'; fi`];
  };
  const levels = ['none', 'scratch', 'full'] as const;
  const { open } = setup(t, {
    develop: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'none' } },
    none: { kind: 'command', extension: 'none', produces: 'document', access: { write: 'none' }, budget: 1, on: { done: 'scratch' } },
    scratch: { kind: 'command', extension: 'scratch', produces: 'document', access: { write: 'scratch' }, budget: 1, on: { done: 'full' } },
    full: { kind: 'command', extension: 'full', produces: 'document', access: { write: 'full' }, budget: 1, on: { done: 'DONE' } },
  }, { extensions: Object.fromEntries(levels.map(name => [name, probe(script(name), seen, name)])) });
  const controller = open();
  const state = await controller.advance('work');
  assert.equal(state.stage, 'DONE', state.reason);
  assert.equal(seen.none, 'answer workspace=no\ntmp=yes\nscratch=no\n');
  assert.equal(seen.scratch, 'answer workspace=no\ntmp=yes\nscratch=yes\n');
  assert.equal(seen.full, 'answer workspace=yes\ntmp=yes\nscratch=yes\n');
  // The scratch folder outlives the run, and the log records where it is.
  const started = Object.fromEntries(controller.events().filter(e => e.type === 'started').map(e => [e.stage, e.scratch]));
  assert.equal(scratches.none, undefined);
  assert.equal(started.none, undefined);
  for (const name of ['scratch', 'full']) {
    assert.equal(started[name], scratches[name]);
    assert.equal(readFileSync(join(started[name] as string, 'kept'), 'utf8'), `${name}\n`);
  }
  assert.notEqual(started.scratch, started.full);
});

test('defaults follow the output contract: a writable clone for a commit, a writable copy of the commit after it, an empty folder before any', async t => {
  const seen: Record<string, string> = {};
  const script = () => ['sh', '-c', 'ls -A | tr "\\n" " "; touch probe && echo writable || echo read-only'];
  const { repository, open } = setup(t, {
    before: { kind: 'command', extension: 'before', produces: 'document', budget: 1, on: { done: 'develop' } },
    develop: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'after' } },
    after: { kind: 'command', extension: 'after', produces: 'document', budget: 1, on: { done: 'DONE' } },
  }, { extensions: { before: probe(script, seen, 'before'), after: probe(script, seen, 'after') } });
  const controller = open();
  const state = await controller.advance('work');
  assert.equal(state.stage, 'DONE', state.reason);
  assert.equal(seen.before, 'writable\n');
  assert.equal(seen.after, 'answer .git writable\n');
  // The copy is disposable: the clone and the owner's repository never see its writes.
  assert.equal(existsSync(join(state.workspace, 'probe')), false);
  assert.equal(execFileSync('git', ['-C', repository, 'status', '--porcelain'], { encoding: 'utf8' }), '');
});

test('a subject workspace before any commit escalates instead of running', async t => {
  let runs = 0;
  const { open } = setup(t, {
    check: { kind: 'command', extension: 'check', produces: 'document', access: { workspace: 'subject' }, budget: 1, on: { done: 'DONE' } },
  }, { extensions: { check: async () => { runs++; return { outcome: 'done', artifact: { kind: 'document', content: 'x' } }; } } });
  const state = await open().advance('work');
  assert.equal(state.stage, 'ESCALATED');
  assert.match(state.reason!, /subject workspace needs a commit/);
  assert.equal(runs, 0);
});

const refusals: [string, Stage, RegExp][] = [
  ['a commit stage that cannot write its clone', { kind: 'agent', agent: 'developer', produces: 'commit', access: { write: 'scratch' }, budget: 1, on: { done: 'DONE' } }, /commit.*writable clone/],
  ['a commit stage outside the clone', { kind: 'agent', agent: 'developer', produces: 'commit', access: { workspace: 'subject' }, budget: 1, on: { done: 'DONE' } }, /commit.*writable clone/],
  ['an unknown write level', { kind: 'command', extension: 'x', access: { write: 'some' as never }, budget: 1, on: { done: 'DONE' } }, /invalid access/],
  ['an unknown workspace', { kind: 'command', extension: 'x', access: { workspace: 'host' as never }, budget: 1, on: { done: 'DONE' } }, /invalid access/],
  ['a missing read path', { kind: 'command', extension: 'x', access: { read: ['/nonexistent/medrengard'] }, budget: 1, on: { done: 'DONE' } }, /does not exist/],
  ['a command stage without owner code', { kind: 'command', command: ['true'], budget: 1, on: { done: 'DONE' } } as Stage, /needs an extension/],
];
for (const [name, stage, message] of refusals) test(`setup refuses ${name}`, t => {
  const { options } = setup(t, { only: stage }, { extensions: { x: async () => ({}) } });
  assert.throws(() => new Controller(options), message);
  assert.equal(existsSync(options.path), false);
});

test('the scratch variable is set by the sandbox, not copied from the controller', t => {
  process.env.MEDRENGARD_SCRATCH = '/elsewhere';
  t.after(() => { delete process.env.MEDRENGARD_SCRATCH; });
  const { options } = setup(t, { only: { kind: 'command', extension: 'x', access: { env: ['MEDRENGARD_SCRATCH'] }, budget: 1, on: { done: 'DONE' } } }, { extensions: { x: async () => ({}) } });
  assert.throws(() => new Controller(options), /set by the sandbox/);
});
