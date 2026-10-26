// The owner drives a work from their factory directory: start with an idea, read the plan and its
// hash, decide on that exact version (or a unique prefix of it), follow progress, read the commit and its
// verdicts, and recover a run that was cut off.
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
const runtime: Runtime = {
  async start(request, context) {
    if (request.produces === 'document') {
      const content = request.feedback ? \`# Plan\\n\${request.input}\\nRevised: \${request.feedback}\` : \`# Plan\\n\${request.input}\`;
      results.set(request.runId, request.input === 'hang' ? new Promise(() => {}) : { outcome: 'done', artifact: { kind: 'document', content } });
    } else if (request.produces === 'commit') {
      const run = await context.execute(['sh', '-c', 'set -e; echo answer > answer; git add answer; git -c user.name=D -c user.email=d@test commit -qm answer; git rev-parse HEAD']);
      results.set(request.runId, { outcome: 'done', artifact: { kind: 'commit', sha: run.stdout.trim(), content: 'Add the answer' } });
    } else results.set(request.runId, { outcome: 'PASS', artifact: { kind: 'verdict', verdict: 'PASS', subject: context.subject, findings: ['naming could be clearer'] } });
  },
  async result(id) { return results.get(id); }, async cancel() {}, async *events() {},
};
const options: Options = {
  path: ${JSON.stringify(join(dir, 'state', 'events.sqlite'))}, directory: ${JSON.stringify(join(dir, 'state', 'runs'))},
  repository: ${JSON.stringify(join(dir, 'repository'))},
  workflows: [{ name: 'plan', start: 'design', stages: {
    design: { kind: 'agent', agent: 'planner', produces: 'document', access: { workspace: 'repository' }, budget: 1, on: { done: 'approve' } },
    approve: { kind: 'human', on: { accept: 'develop', changes: { workflow: 'plan' } } },
    develop: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'review' } },
    review: { kind: 'agent', agent: 'reviewer', produces: 'verdict', budget: 1, on: { PASS: 'owner' } },
    owner: { kind: 'human', on: { accept: 'DONE' } },
  } }],
  agents: Object.fromEntries(['planner', 'developer', 'reviewer'].map(name => [name, { runtime: 'fake', role: '', skills: [], mcpServers: {}, sandbox: { backend: 'bwrap', env: ['SF_CLI_TOKEN'] } }])),
  runtimes: { fake: runtime },
};
export default { options, workflow: 'plan' };
`);
  const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, SF_CLI_TOKEN: 'token' }, timeout: 5000 });
  const unset = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  return { cli, unset };
}
const field = (output: string, name: string) => output.match(new RegExp(`^${name} (\\S+)$`, 'm'))?.[1];

test('start shows the plan and its hash; changes with feedback revises it; accept of that hash starts development', t => {
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
  assert.match(stale.stderr, new RegExp(`stale owner decision; the current one is ${second}`));

  const shown = cli('show', work);
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(field(shown.stdout, 'hash'), second);
  assert.match(shown.stdout, new RegExp(`^- ${first}: Keep the knife hit sounds\\.$`, 'm'));

  // A unique prefix of the current hash is enough; the progress of the automatic stages goes to stderr.
  const accepted = cli('decide', work, 'accept', second.slice(0, 8));
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(field(accepted.stdout, 'stage'), 'owner');
  assert.match(accepted.stderr, /^\d\d:\d\d:\d\d started develop$/m);
  assert.match(accepted.stderr, /^\d\d:\d\d:\d\d develop done$/m);
  assert.match(accepted.stderr, /^\d\d:\d\d:\d\d review PASS$/m);

  // At the owner's gate, show gives the commit and the verdicts on it, not the plan.
  const sha = field(accepted.stdout, 'sha')!;
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.match(accepted.stdout, /^commit \d\d:\d\d:\d\d\nAdd the answer$/m);
  assert.match(accepted.stdout, /^review PASS \d\d:\d\d:\d\d\n {2}- naming could be clearer$/m);
  assert.doesNotMatch(accepted.stdout, /^# Plan/m);
  assert.equal(cli('decide', work, 'accept', sha.slice(0, 6)).status, 1, 'a prefix under 7 characters is not enough');
  const done = cli('decide', work, 'accept', sha.slice(0, 7));
  assert.equal(done.status, 0, done.stderr);
  assert.equal(field(done.stdout, 'stage'), 'DONE');
});

test('a run cut off mid-stage shows as interrupted until the owner recovers it', t => {
  const { cli } = factory(t);
  const cut = cli('start', 'hang');
  assert.equal(cut.signal, 'SIGTERM');
  const work = cut.stderr.match(/^work (\S+)$/m)![1];
  const shown = cli('show', work);
  assert.equal(field(shown.stdout, 'stage'), 'design');
  assert.match(shown.stdout, new RegExp(`a run is in progress; if no medrengard command is running it, it was interrupted: medrengard recover ${work}`));
  const recovered = cli('recover', work);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout, /^stage ESCALATED \(interrupted run needs the owner\)$/m);
});

test('usage errors, unknown works and refused setup exit non-zero without a stack trace', t => {
  const { cli, unset } = factory(t);
  for (const args of [[], ['start'], ['decide', 'x', 'accept'], ['recover'], ['frobnicate']]) {
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
