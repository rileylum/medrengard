import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Controller, commandRuntime, type Runtime, type StageContext, type Options } from '../../src/index.ts';

function fixture(t: any, runtime: Runtime, input = 'success') {
  const dir = mkdtempSync(join(tmpdir(), 'factory-contract-'));
  const repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Owner', '-c', 'user.email=owner@example.test', 'commit', '--allow-empty', '-qm', 'base']);
  const options: Options = { path: join(dir, 'events.sqlite'), directory: join(dir, 'runs'), repository: repo, deadlineMs: 200,
    workflows: [{ name: 'one', start: 'agent', stages: { agent: { kind: 'agent', agent: 'one', produces: 'document', budget: 1, on: { done: 'DONE' } } } }],
    agents: { one: { runtime: 'runtime', role: 'role', skills: ['skill'], mcpServers: {}, sandbox: { backend: 'bwrap' } } }, runtimes: { runtime } };
  const controller = new Controller(options);
  t.after(() => { controller.close(); rmSync(dir, { recursive: true, force: true }); });
  controller.open('work', 'one', input);
  return { controller, options, dir };
}
function fake(): Runtime {
  let input = '';
  return { async start(request) { input = request.input; }, async cancel() {},
    async result() { if (input === 'wait') return new Promise(() => {}); if (input === 'failure') throw new Error('failed'); return { outcome: 'done', artifact: { kind: 'document', content: 'document' } }; },
    async *events() { yield { type: 'progress' }; },
  };
}
const command = ['node', '-e', "const r=JSON.parse(process.argv[1]); if(r.input==='failure') process.exit(1); else if(r.input==='wait') setInterval(()=>{},1000); else console.log(JSON.stringify({outcome:'done',artifact:{kind:'document',content:'document'}}));"];
for (const [name, factory] of [['fake', fake], ['process', () => commandRuntime(command)]] as const) {
  for (const input of ['success', 'failure', 'wait']) test(`${name} runtime contract: ${input}`, async t => {
    const { controller } = fixture(t, factory(), input);
    await controller.advance('work');
    assert.equal(controller.state('work').stage, input === 'success' ? 'DONE' : 'ESCALATED');
    assert.equal(controller.state('work').spent.agent, 1);
    if (input === 'success') {
      assert.equal(controller.state('work').artifacts[0].content, 'document');
      assert(controller.events().some(e => e.type === 'runtime'));
    }
    if (input === 'wait') assert.match(controller.state('work').reason!, /deadline/);
  });
}

test('settled stages revoke execution and asynchronous observers cannot write', async t => {
  let context: StageContext;
  const runtime = fake(); const start = runtime.start;
  runtime.start = async (request, given) => { context = given; await start(request, given); };
  const { controller } = fixture(t, runtime);
  const checks: Promise<void>[] = [];
  controller.observe(() => { checks.push(Promise.resolve().then(() => { assert.throws(() => controller.open('forged', 'one', ''), /observer/); assert.throws(() => controller.close(), /observer/); })); });
  await controller.advance('work'); await Promise.all(checks);
  await assert.rejects(context!.execute(['true']), /ended/);
  assert.equal(controller.state('work').stage, 'DONE');
});

test('legacy event databases are refused rather than treated as empty work', t => {
  const { options } = fixture(t, fake());
  const legacy = join(options.directory, 'legacy.sqlite');
  const db = new DatabaseSync(legacy); db.exec('CREATE TABLE events(body TEXT)'); db.close();
  assert.throws(() => new Controller({ ...options, path: legacy }), /legacy.*migration/);
});
