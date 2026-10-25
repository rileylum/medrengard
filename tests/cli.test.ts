// The owner drives a work from their factory directory: start with an idea, read the plan and its
// hash, and decide on that exact hash, with feedback reaching the next run.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const CLI = new URL('../cli/medrengard.ts', import.meta.url).pathname;
const CORE = new URL('../src/index.ts', import.meta.url).href;

function factory(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', join(dir, 'repository')]);
  execFileSync('git', ['-C', join(dir, 'repository'), '-c', 'user.name=Owner', '-c', 'user.email=owner@test', 'commit', '--allow-empty', '-qm', 'base']);
  writeFileSync(join(dir, 'factory.ts'), `import type { Options, Runtime } from ${JSON.stringify(CORE)};
const results = new Map<string, unknown>();
const planner: Runtime = {
  async start(request) {
    const content = request.feedback ? \`# Plan\\n\${request.input}\\nRevised: \${request.feedback}\` : \`# Plan\\n\${request.input}\`;
    results.set(request.runId, { outcome: 'done', artifact: { kind: 'document', content } });
  },
  async result(id) { return results.get(id); }, async cancel() {}, async *events() {},
};
const options: Options = {
  path: ${JSON.stringify(join(dir, 'state', 'events.sqlite'))}, directory: ${JSON.stringify(join(dir, 'state', 'runs'))},
  repository: ${JSON.stringify(join(dir, 'repository'))},
  workflows: [{ name: 'plan', start: 'design', stages: {
    design: { kind: 'agent', agent: 'planner', produces: 'document', workspace: 'repository', budget: 1, on: { done: 'approve' } },
    approve: { kind: 'human', on: { accept: 'DONE', changes: { workflow: 'plan' } } },
  } }],
  agents: { planner: { runtime: 'fake', role: '', skills: [], mcpServers: {}, sandbox: { backend: 'bwrap', env: ['SF_CLI_TOKEN'] } } },
  runtimes: { fake: planner },
};
export default { options, workflow: 'plan' };
`);
  const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, SF_CLI_TOKEN: 'token' } });
  const unset = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  return { cli, unset };
}
const field = (output: string, name: string) => output.match(new RegExp(`^${name} (\\S+)$`, 'm'))?.[1];

test('start shows the plan and its hash; changes with feedback revises it; accept of that hash ends the work', t => {
  const { cli } = factory(t);
  const started = cli('start', 'remove the hit sound from rifle hits');
  assert.equal(started.status, 0, started.stderr);
  const work = field(started.stdout, 'work')!;
  const first = field(started.stdout, 'hash')!;
  assert.equal(field(started.stdout, 'stage'), 'approve');
  assert.match(started.stdout, /^# Plan\nremove the hit sound from rifle hits$/m);

  const changed = cli('decide', work, 'changes', first, 'Keep the knife hit sounds.');
  assert.equal(changed.status, 0, changed.stderr);
  const second = field(changed.stdout, 'hash')!;
  assert.notEqual(second, first);
  assert.match(changed.stdout, /^Revised: Keep the knife hit sounds\.$/m);

  const stale = cli('decide', work, 'accept', first);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale/);

  const shown = cli('show', work);
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(field(shown.stdout, 'hash'), second);
  assert.match(shown.stdout, new RegExp(`^- ${first}: Keep the knife hit sounds\\.$`, 'm'));

  const accepted = cli('decide', work, 'accept', second);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(field(accepted.stdout, 'stage'), 'DONE');
});

test('usage errors, unknown works and refused setup exit non-zero without a stack trace', t => {
  const { cli, unset } = factory(t);
  for (const args of [[], ['start'], ['decide', 'x', 'accept'], ['frobnicate']]) {
    const r = cli(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /^usage:/m);
  }
  const unknown = cli('show', 'missing');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown work missing/);
  assert.doesNotMatch(unknown.stderr, /\n\s+at /);
  const refused = unset('show', 'missing');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /SF_CLI_TOKEN is not set/);
  assert.doesNotMatch(refused.stderr, /\n\s+at /);
});
