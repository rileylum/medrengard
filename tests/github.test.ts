// The GitHub publisher pushes the accepted SHA to a branch per work and opens one draft PR for it, however often it runs.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Artifact, StageContext } from '../src/index.ts';
import { githubPullRequest } from '../extensions/github/index.ts';

// Records each call; `pr list` prints the URL of an open PR for the branch, `pr create` makes one.
const FAKE_GH = `const fs = require('fs'); const [log, ...argv] = process.argv.slice(2);
const state = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : { calls: [], prs: [] };
const arg = name => argv[argv.indexOf(name) + 1];
let out = '';
if (argv[0] === 'pr' && argv[1] === 'list') out = state.prs.find(p => p.head === arg('--head'))?.url ?? '';
if (argv[0] === 'pr' && argv[1] === 'create') {
  const url = 'https://github.test/owner/repo/pull/' + (state.prs.length + 1);
  state.prs.push({ head: arg('--head'), url }); out = url;
}
state.calls.push({ argv, cwd: process.cwd(), stdin: argv.includes('-') ? fs.readFileSync(0, 'utf8') : undefined });
fs.writeFileSync(log, JSON.stringify(state)); if (out) console.log(out);`;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=T', '-c', 'user.email=t@test', ...args], { encoding: 'utf8' }).trim();

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-github-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const remote = join(dir, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  const repository = join(dir, 'repository');
  execFileSync('git', ['clone', '-q', remote, repository]);
  git(repository, 'commit', '--allow-empty', '-qm', 'base');
  git(repository, 'push', '-q', 'origin', 'HEAD');
  const base = git(repository, 'rev-parse', 'HEAD');
  // The controller's retained copy of the developer's commits, outside the owner's repository.
  const retained = join(dir, 'retained');
  execFileSync('git', ['clone', '-q', repository, retained]);
  const commit = (content: string) => {
    writeFileSync(join(retained, 'answer'), content);
    git(retained, 'add', 'answer'); git(retained, 'commit', '-qm', content);
    const sha = git(retained, 'rev-parse', 'HEAD');
    git(retained, 'update-ref', `refs/artifacts/${sha}`, sha);
    return sha;
  };
  const fake = join(dir, 'gh.js'); writeFileSync(fake, FAKE_GH);
  const log = join(dir, 'gh.json');
  const publish = githubPullRequest({ repository, gh: [process.execPath, fake, log] });
  const context = (sha: string): StageContext => {
    const verdict = (stage: string, findings: string[] = []): Artifact => ({ kind: 'verdict', hash: stage, stage, subject: sha, verdict: 'PASS', findings });
    const artifacts: Artifact[] = [
      { kind: 'document', hash: 'p', stage: 'design', content: '# Remove the rifle hit sound\n\nGoal: quieter rifle hits.' },
      { kind: 'commit', hash: 'c', stage: 'develop', sha, repository: retained, content: 'Skip the rifle hit sound\n\nTests: npm test passed.' },
      verdict('check'), verdict('standard'), verdict('adversarial', ['knife hit still plays, as planned']),
    ];
    return { work: 'w1', subject: sha, base, artifacts, execute: async () => { throw new Error('the publisher runs on the host'); } };
  };
  return { remote, repository, commit, publish, context, gh: () => JSON.parse(readFileSync(log, 'utf8')) as { calls: { argv: string[]; cwd: string; stdin?: string }[]; prs: unknown[] } };
}

test('publishing pushes the SHA to the work branch and opens one draft PR with the plan and the evidence', async t => {
  const { remote, repository, commit, publish, context, gh } = setup(t);
  const sha = commit('one');
  const result = await publish(context(sha));
  assert.deepEqual(result, { outcome: 'done', artifact: { kind: 'document', subject: sha, content: 'https://github.test/owner/repo/pull/1' } });
  assert.equal(git(remote, 'rev-parse', 'refs/heads/medrengard/w1'), sha);
  const create = gh().calls.find(c => c.argv[1] === 'create')!;
  assert.equal(create.cwd, repository);
  assert.ok(create.argv.includes('--draft'));
  assert.equal(create.argv[create.argv.indexOf('--head') + 1], 'medrengard/w1');
  assert.equal(create.argv[create.argv.indexOf('--title') + 1], 'Remove the rifle hit sound');
  for (const part of ['Goal: quieter rifle hits.', 'Skip the rifle hit sound', 'Tests: npm test passed.', `Evidence for ${sha}`, '- check: PASS', '- adversarial: PASS', '  - knife hit still plays, as planned', 'Medrengard work w1'])
    assert.ok(create.stdin!.includes(part), part);
  // The owner's own checkout is not written: the push went from the retained copy.
  assert.throws(() => execFileSync('git', ['-C', repository, 'cat-file', '-e', sha], { stdio: 'pipe' }));
});

test('publishing again, or a revised SHA for the same work, updates the branch and reuses the open PR', async t => {
  const { remote, commit, publish, context, gh } = setup(t);
  const first = commit('one');
  const url = (await publish(context(first)) as any).artifact.content;
  assert.equal((await publish(context(first)) as any).artifact.content, url);
  const second = commit('two');
  const revised = await publish(context(second)) as any;
  assert.equal(revised.artifact.content, url);
  assert.equal(revised.artifact.subject, second);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/medrengard/w1'), second);
  assert.equal(gh().prs.length, 1);
  assert.equal(gh().calls.filter(c => c.argv[1] === 'create').length, 1);
  // The reused PR's description names the evidence for the SHA it now carries.
  const edit = gh().calls.filter(c => c.argv[1] === 'edit').at(-1)!;
  assert.deepEqual(edit.argv.slice(0, 3), ['pr', 'edit', url]);
  assert.ok(edit.stdin!.includes(`Evidence for ${second}`));
});

test('publishing refuses a subject that is not a retained commit', async t => {
  const { publish, context, gh } = setup(t);
  await assert.rejects(publish({ ...context('f'.repeat(40)), artifacts: [] }), /retained commit/);
  assert.throws(() => gh(), /ENOENT/);
});
