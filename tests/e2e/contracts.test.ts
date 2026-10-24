import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Controller, commandRuntime, type Runtime, type StageContext, type Options } from '../../src/index.ts';

function fixture(t: any, runtime: Runtime, input = 'success', overrides: Partial<Options> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-contract-'));
  const repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Owner', '-c', 'user.email=owner@example.test', 'commit', '--allow-empty', '-qm', 'base']);
  const options: Options = { path: join(dir, 'events.sqlite'), directory: join(dir, 'runs'), repository: repo, deadlineMs: 200,
    workflows: [{ name: 'one', start: 'agent', stages: { agent: { kind: 'agent', agent: 'one', produces: 'document', budget: 1, on: { done: 'DONE' } } } }],
    agents: { one: { runtime: 'runtime', role: 'role', skills: ['skill'], mcpServers: {}, sandbox: { backend: 'bwrap' } } }, runtimes: { runtime }, ...overrides };
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
const command = ['node', '-e', "const r=JSON.parse(require('fs').readFileSync(0,'utf8')); if(r.input==='failure') process.exit(1); else if(r.input==='wait') setInterval(()=>{},1000); else console.log(JSON.stringify({outcome:'done',artifact:{kind:'document',content:'document'}}));"];
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

for (const entry of ['path', 'symlink']) test(`invalid UTF-8 ${entry} bytes cannot produce evidence for a different tree`, async t => {
  let result: unknown; let checks = 0;
  const runtime: Runtime = {
    async start(_request, context) {
      const code = entry === 'path'
        ? "require('fs').writeFileSync(Buffer.from([98,97,100,255]),'forbidden')"
        : "require('fs').symlinkSync(Buffer.from([98,97,100,255]),'link')";
      const run = await context.execute(['node', '-e', `${code}; const g=(...a)=>require('child_process').execFileSync('git',a);g('add','-A');g('-c','user.name=Stub','-c','user.email=stub@example.test','commit','-qm','bytes');process.stdout.write(g('rev-parse','HEAD'));`]);
      assert.equal(run.exitCode, 0, run.stderr);
      result = { outcome: 'done', artifact: { kind: 'commit', sha: run.stdout.trim() } };
    }, async result() { return result; }, async cancel() {}, async *events() {},
  };
  const { controller } = fixture(t, runtime, 'bytes', { deadlineMs: 2000,
    workflows: [{ name: 'one', start: 'develop', stages: {
      develop: { kind: 'agent', agent: 'one', produces: 'commit', budget: 1, on: { done: 'check' } },
      check: { kind: 'command', extension: 'check', produces: 'verdict', budget: 1, on: { PASS: 'DONE' } },
    } }], extensions: { check: async context => { checks++; return { outcome: 'PASS', artifact: { kind: 'verdict', verdict: 'PASS', subject: context.subject, findings: [] } }; } },
  });
  await controller.advance('work');
  assert.equal(controller.state('work').stage, 'ESCALATED');
  assert.equal(checks, 0);
  assert.equal(controller.state('work').evidence.length, 0);
});

for (const owner of [false, true]) test(`same-subject failed gate requires owner authorization: ${owner}`, async t => {
  let gates = 0;
  const { controller } = fixture(t, fake(), 'success', {
    workflows: [{ name: 'one', start: 'agent', stages: {
      agent: { kind: 'agent', agent: 'one', produces: 'document', budget: 1, on: { done: 'gate' } },
      gate: { kind: 'command', extension: 'gate', produces: 'verdict', budget: 2, on: { FAIL: [owner ? 'owner' : 'gate', 'DONE'] } },
      owner: { kind: 'human', on: { retry: 'gate' } },
    } }], extensions: { gate: async context => { gates++; return { outcome: 'FAIL', artifact: { kind: 'verdict', verdict: 'FAIL', subject: context.subject, findings: ['gate failed'] } }; } },
  });
  await controller.advance('work');
  assert.equal(gates, 1);
  assert.equal(controller.state('work').spent.gate, 1);
  if (owner) {
    assert.equal(controller.state('work').stage, 'owner');
    controller.decide('work', 'retry', controller.state('work').subject!);
    await controller.advance('work'); assert.equal(gates, 2);
    assert.equal(controller.state('work').stage, 'DONE');
  } else assert.equal(controller.state('work').stage, 'ESCALATED');
});

test('process developer and fix consume approved specification and exact review findings', async t => {
  const spec = 'The approved secret is violet-27; initial idea does not contain it.';
  const finding = 'Replace the original greeting with corrected-violet-27.';
  let reviews = 0;
  const runtime = commandRuntime(['node', '-e', `
    const r=JSON.parse(require('fs').readFileSync(0,'utf8')); const fs=require('fs'); const g=(...a)=>require('child_process').execFileSync('git',a);
    const spec=r.artifacts.find(a=>a.kind==='document' && a.stage==='spec').content;
    const fail=r.artifacts.findLast(a=>a.kind==='verdict' && a.verdict==='FAIL');
    fs.writeFileSync('spec.txt',spec); fs.writeFileSync('findings.json',JSON.stringify(fail?.findings ?? []));
    g('add','-A'); g('-c','user.name=Stub','-c','user.email=stub@example.test','commit','-qm','consume context');
    console.log(JSON.stringify({outcome:'done',artifact:{kind:'commit',sha:g('rev-parse','HEAD').toString().trim()}}));
  `]);
  const { controller } = fixture(t, runtime, 'a vague initial idea', { deadlineMs: 2000,
    workflows: [{ name: 'one', start: 'spec', stages: {
      spec: { kind: 'command', extension: 'spec', produces: 'document', budget: 1, on: { done: 'approve' } },
      approve: { kind: 'human', on: { accept: 'develop' } },
      develop: { kind: 'agent', agent: 'one', produces: 'commit', budget: 2, on: { done: 'review' } },
      review: { kind: 'command', extension: 'review', produces: 'verdict', budget: 2, on: { FAIL: 'develop', PASS: 'DONE' } },
    } }], extensions: {
      spec: async () => ({ outcome: 'done', artifact: { kind: 'document', content: spec } }),
      review: async context => { const verdict = ++reviews === 1 ? 'FAIL' : 'PASS'; return { outcome: verdict, artifact: { kind: 'verdict', verdict, subject: context.subject, findings: verdict === 'FAIL' ? [finding] : [] } }; },
    },
  });
  await controller.advance('work'); controller.decide('work', 'accept', controller.state('work').subject!);
  await controller.advance('work'); const state = controller.state('work');
  assert.equal(state.stage, 'DONE', state.reason);
  const commits = state.artifacts.filter(a => a.kind === 'commit'); assert.equal(commits.length, 2);
  const file = (sha: string, name: string) => execFileSync('git', ['-C', state.workspace, 'show', `${sha}:${name}`], { encoding: 'utf8' });
  assert.equal(file(commits[0].sha!, 'spec.txt'), spec);
  assert.deepEqual(JSON.parse(file(commits[0].sha!, 'findings.json')), []);
  assert.equal(file(commits[1].sha!, 'spec.txt'), spec);
  assert.deepEqual(JSON.parse(file(commits[1].sha!, 'findings.json')), [finding]);
});

test('accepted commit objects survive a later candidate replacing and pruning its history', async t => {
  let count = 0; let result: unknown;
  const runtime: Runtime = {
    async start(_request, context) {
      const previous = context.artifacts.find(a => a.kind === 'commit');
      if (previous?.repository) {
        const attempt = await context.execute(['node', '-e', "try { require('fs').writeFileSync(process.argv[1]+'/config','corrupt'); process.exit(1) } catch {}", previous.repository!]);
        assert.equal(attempt.exitCode, 0, 'candidate can write retained artifact storage');
      }
      const command = ++count === 1
        ? "printf original > answer; git add answer; git -c user.name=A -c user.email=a@test commit -qm original; git rev-parse HEAD"
        : "set -e; original_branch=$(git symbolic-ref --short HEAD); git checkout --orphan replacement; printf replacement > answer; git add answer; git -c user.name=A -c user.email=a@test commit -qm replacement; git update-ref -d refs/heads/$original_branch; git reflog expire --expire=now --all; git gc --prune=now; git rev-parse HEAD";
      const run = await context.execute(['sh', '-c', command]); assert.equal(run.exitCode, 0, run.stderr);
      result = { outcome: 'done', artifact: { kind: 'commit', sha: run.stdout.trim() } };
    }, async result() { return result; }, async cancel() {}, async *events() {},
  };
  const { controller } = fixture(t, runtime, '', { deadlineMs: 3000,
    workflows: [{ name: 'one', start: 'develop', stages: {
      develop: { kind: 'agent', agent: 'one', produces: 'commit', budget: 1, on: { done: 'fix' } },
      fix: { kind: 'agent', agent: 'one', produces: 'commit', budget: 1, on: { done: 'inspect' } },
      inspect: { kind: 'human', on: { accept: 'check' } },
      check: { kind: 'command', command: ['node', '-e', "if(require('fs').readFileSync('answer','utf8')!=='replacement') process.exit(1)"], budget: 1, on: { PASS: 'DONE', FAIL: 'ESCALATED' } },
    } }],
  });
  await controller.advance('work'); const state = controller.state('work');
  assert.equal(state.stage, 'inspect', state.reason);
  const commits = state.artifacts.filter(a => a.kind === 'commit'); assert.equal(commits.length, 2);
  assert.throws(() => execFileSync('git', ['-C', state.workspace, 'cat-file', '-t', commits[0].sha!], { stdio: 'pipe' }));
  assert.equal(typeof commits[0].repository, 'string', 'commit artifact has no retained object store');
  assert.equal(execFileSync('git', ['-C', commits[0].repository!, 'show', `${commits[0].sha}:answer`], { encoding: 'utf8' }), 'original');
  assert.equal(execFileSync('git', ['-C', commits[1].repository!, 'show', `${commits[1].sha}:answer`], { encoding: 'utf8' }), 'replacement');
  rmSync(join(state.workspace, '.git'), { recursive: true });
  controller.decide('work', 'accept', state.subject!); await controller.advance('work');
  assert.equal(controller.state('work').stage, 'DONE', controller.state('work').reason);
  assert.equal(controller.state('work').evidence[0].verdict, 'PASS');
});


test('process runtime receives the entire large specification through stdin', async t => {
  const spec = 'header\n' + 'x'.repeat(150000) + '\ntail';
  const runtime = commandRuntime(['node', '-e', `
    const request=JSON.parse(require('fs').readFileSync(0,'utf8'));
    const content=request.artifacts[0].content;
    const received={bytes:Buffer.byteLength(content),sha256:require('crypto').createHash('sha256').update(content).digest('hex')};
    console.log(JSON.stringify({outcome:'done',artifact:{kind:'document',content:JSON.stringify(received)}}));
  `]);
  const { controller } = fixture(t, runtime, 'consume the approved specification', { deadlineMs: 2000,
    workflows: [{ name: 'one', start: 'spec', stages: {
      spec: { kind: 'command', extension: 'spec', produces: 'document', budget: 1, on: { done: 'consume' } },
      consume: { kind: 'agent', agent: 'one', produces: 'document', budget: 1, on: { done: 'DONE' } },
    } }], extensions: { spec: async () => ({ outcome: 'done', artifact: { kind: 'document', content: spec } }) },
  });
  await controller.advance('work'); const state = controller.state('work');
  assert.equal(state.stage, 'DONE', state.reason);
  assert.deepEqual(JSON.parse(state.artifacts[1].content!), { bytes: Buffer.byteLength(spec), sha256: createHash('sha256').update(spec).digest('hex') });
});
