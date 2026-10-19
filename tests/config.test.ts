// Ticket 10-b: the four configuration layers, read through loadConfig. Each test gets its own
// XDG_CONFIG_HOME, so the owner's personal file never reaches one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig, storeOf } from '../src/config.ts';
import { ownerCheck } from './workflows.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-config-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...a], { cwd, encoding: 'utf8' }).trim();
const writeJson = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
};

let n = 0;
/** A repository with one commit, a job file beside it, and an empty XDG_CONFIG_HOME. */
function scratch(job: Record<string, unknown> = {}) {
  const root = join(dir, String(n++));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'initial');
  const jobFile = join(root, 'job.json');
  writeJson(jobFile, { workId: 'w', ticket: 'x', repo: 'repo', runtime: { developer: 'claude' }, ...job });
  const xdg = join(root, 'xdg');
  const personal = join(xdg, 'software_factory', 'config.json');
  return { root, repo, jobFile, personal, env: { XDG_CONFIG_HOME: xdg, HOME: join(root, 'home') } };
}

test('a later layer wins key by key: the job file beats the personal file per role, and a role only the personal file names survives', async () => {
  const { jobFile, personal, env } = scratch();
  writeJson(personal, { runtime: { developer: 'pi', standard: 'pi' } });
  const c = await loadConfig(jobFile, env);
  assert.deepEqual(c.spec.runtime, { developer: 'claude', standard: 'pi' });
});

test('with no XDG_CONFIG_HOME, the personal file is ~/.config/software_factory/config.json', async () => {
  const { root, jobFile } = scratch();
  const home = join(root, 'home');
  writeJson(join(home, '.config', 'software_factory', 'config.json'), { runtime: { standard: 'pi' } });
  const c = await loadConfig(jobFile, { HOME: home });
  assert.deepEqual(c.spec.runtime, { developer: 'claude', standard: 'pi' });
});

/** Commits `.factory/config.json` in `repo` and returns the commit's SHA. */
function commitRepoLayer(repo: string, value: unknown): string {
  writeJson(join(repo, '.factory', 'config.json'), value);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'factory config');
  return git(repo, 'rev-parse', 'HEAD');
}

test('the repository layer sits between personal and job, and is read at the base SHA, not the working tree or a later commit', async () => {
  const { repo, jobFile, personal, env } = scratch();
  writeJson(personal, { runtime: { standard: 'pi', adversarial: 'pi' } });
  const base = commitRepoLayer(repo, { runtime: { developer: 'pi', standard: 'claude' } });
  commitRepoLayer(repo, { runtime: { adversarial: 'claude' } });
  writeJson(join(repo, '.factory', 'config.json'), { runtime: { adversarial: 'claude' } });
  writeJson(jobFile, { workId: 'w', ticket: 'x', repo: 'repo', base, runtime: { developer: 'claude' } });
  const c = await loadConfig(jobFile, env);
  assert.deepEqual(c.spec.runtime, { developer: 'claude', standard: 'claude', adversarial: 'pi' });
});

test('a repository layer that gives grants is refused, naming the key and the file', async () => {
  const { repo, jobFile, env } = scratch();
  commitRepoLayer(repo, { grants: { github: { env: 'GITHUB_TOKEN' } } });
  await assert.rejects(loadConfig(jobFile, env), /\.factory\/config\.json at [0-9a-f]{40}: grants come only from the personal or job layer/);
});

test('a repository layer that sets sandbox.backend none is refused, naming the key and the file', async () => {
  const { repo, jobFile, env } = scratch();
  commitRepoLayer(repo, { sandbox: { backend: 'none' } });
  await assert.rejects(loadConfig(jobFile, env), /\.factory\/config\.json at [0-9a-f]{40}: sandbox is set only by the personal or job layer/);
});

test('a key a layer may not set is refused, naming the file: identity keys outside the job file, anything else in the repository', async () => {
  const a = scratch();
  writeJson(a.personal, { repo: '/elsewhere' });
  await assert.rejects(loadConfig(a.jobFile, a.env), (err: Error) => err.message.startsWith(`${a.personal}: repo may not be set here`));
  const b = scratch();
  commitRepoLayer(b.repo, { deadlineMs: 1 });
  await assert.rejects(loadConfig(b.jobFile, b.env), /^Error: \.factory\/config\.json at [0-9a-f]{40}: deadlineMs may not be set here; allowed: checks, workflow, runtime$/);
  // A key that names an Object.prototype member gets the plain refusal, not the member's text.
  const c = scratch();
  commitRepoLayer(c.repo, { constructor: 1 });
  await assert.rejects(loadConfig(c.jobFile, c.env), /: constructor may not be set here; allowed:/);
  const d = scratch({ colour: 'blue' });
  await assert.rejects(loadConfig(d.jobFile, d.env), (err: Error) => err.message.startsWith(`${d.jobFile}: colour may not be set here`));
});

test('a later layer\'s checks replace the earlier list whole, never add to it', async () => {
  const { repo, jobFile, personal, env } = scratch();
  writeJson(personal, { checks: [{ name: 'lint', command: ['true'] }] });
  commitRepoLayer(repo, { checks: [{ name: 'test', command: ['npm', 'test'] }] });
  const c = await loadConfig(jobFile, env);
  assert.deepEqual(c.spec.checks, [{ name: 'test', command: ['npm', 'test'] }]);
});

test('the base is resolved to a SHA once, so a ref that moves after loading does not change the commit the job starts from', async () => {
  const { repo, jobFile, env } = scratch({ base: 'main' });
  const read = commitRepoLayer(repo, { runtime: { standard: 'pi' } });
  const c = await loadConfig(jobFile, env);
  commitRepoLayer(repo, { runtime: { standard: 'claude' } });
  assert.equal(c.spec.base, read);
  assert.equal(c.spec.runtime.standard, 'pi');
});

test('a repository workflow is the file at the base SHA, copied under runsDir and loaded from there', async () => {
  const { root, repo, jobFile, env } = scratch();
  writeJson(jobFile, { workId: 'w', ticket: 'x', repo: join(root, 'repo'), runsDir: join(root, 'runs'), runtime: { developer: 'claude' } });
  writeFileSync(join(repo, 'flow.ts'), `export { ownerCheck as workflow } from ${JSON.stringify(join(import.meta.dirname, 'workflows.ts'))};\n`);
  const base = commitRepoLayer(repo, { workflow: 'flow.ts' });
  writeFileSync(join(repo, 'flow.ts'), 'export const workflow = 1;\n');
  const c = await loadConfig(jobFile, env);
  assert.deepEqual(c.workflow, ownerCheck);
  assert.ok(existsSync(join(root, 'runs', 'repo-config', base, 'flow.ts')));
});

test('a repository workflow path that is absolute or climbs out of the repository is refused', async () => {
  for (const workflow of ['../flow.ts', '/etc/flow.ts', 'a/../../flow.ts']) {
    const { repo, jobFile, env } = scratch();
    commitRepoLayer(repo, { workflow });
    await assert.rejects(loadConfig(jobFile, env), new RegExp(`\\.factory/config\\.json at [0-9a-f]{40}: workflow ${JSON.stringify(workflow).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} must be a path inside the repository`));
  }
});

test('a layer that is not a JSON object is refused, naming the file', async () => {
  for (const text of ['[]', 'null', '"x"', '{']) {
    const { jobFile, personal, env } = scratch();
    mkdirSync(dirname(personal), { recursive: true });
    writeFileSync(personal, text);
    await assert.rejects(loadConfig(jobFile, env), (err: Error) => err.message.startsWith(`${personal}: must be a JSON object`), text);
  }
  const { repo, jobFile, env } = scratch();
  commitRepoLayer(repo, []);
  await assert.rejects(loadConfig(jobFile, env), /\.factory\/config\.json at [0-9a-f]{40}: must be a JSON object/);
});

test('runtimes merge per name and sandbox per field, so a later layer adds to them instead of replacing them', async () => {
  const { root, jobFile, personal, env } = scratch({ runtimes: { b: { module: 'b.ts' } }, sandbox: { backend: 'none' } });
  writeJson(personal, { runtimes: { a: { module: 'a.ts' } }, sandbox: { read: ['/opt/tool'] } });
  // The registry hashes each module when it is built, so both must exist.
  writeFileSync(join(dirname(personal), 'a.ts'), '');
  writeFileSync(join(root, 'b.ts'), '');
  const c = await loadConfig(jobFile, env);
  assert.deepEqual(c.spec.runtimes, { a: { module: join(dirname(personal), 'a.ts') }, b: { module: join(root, 'b.ts') } });
  assert.deepEqual(c.sandbox, { backend: 'none', read: ['/opt/tool'] });
});

test('a runtime, runtimes or sandbox value that is not a JSON object is refused, naming the file and the key', async () => {
  for (const [key, value] of [['sandbox', 'none'], ['sandbox', ['none']], ['runtime', null], ['runtimes', 'ext']] as const) {
    const { jobFile, env } = scratch({ [key]: value });
    await assert.rejects(loadConfig(jobFile, env), (err: Error) => err.message === `${jobFile}: ${key} must be a JSON object`, `${key}: ${JSON.stringify(value)}`);
  }
});

test('a job-file workflow beats the repository layer\'s, and the repository workflow is not copied', async () => {
  const { root, repo, jobFile, env } = scratch();
  writeFileSync(join(root, 'mine.ts'), `export { ownerCheck as workflow } from ${JSON.stringify(join(import.meta.dirname, 'workflows.ts'))};\n`);
  writeFileSync(join(repo, 'flow.ts'), `export { noHuman as workflow } from ${JSON.stringify(join(import.meta.dirname, 'workflows.ts'))};\n`);
  commitRepoLayer(repo, { workflow: 'flow.ts' });
  writeJson(jobFile, { workId: 'w', ticket: 'x', repo: 'repo', runsDir: join(root, 'runs'), workflow: 'mine.ts', runtime: { developer: 'claude' } });
  const c = await loadConfig(jobFile, env);
  assert.deepEqual(c.workflow, ownerCheck);
  assert.equal(existsSync(join(root, 'runs', 'repo-config')), false);
});

test('a job file may carry model, which proto/README.md documents for the board', async () => {
  const { jobFile, env } = scratch({ model: 'sonnet' });
  const c = await loadConfig(jobFile, env);
  assert.equal(c.spec.workId, 'w');
});

test('with neither XDG_CONFIG_HOME nor HOME, there is no personal layer, not one under the working directory', async () => {
  const { root, jobFile } = scratch();
  writeJson(join(root, '.config', 'software_factory', 'config.json'), { sandbox: { backend: 'none' } });
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const c = await loadConfig(jobFile, {});
    assert.deepEqual(c.sandbox, { backend: 'bwrap' });
  } finally {
    process.chdir(cwd);
  }
});

test('a personal runsDir and workflow resolve against the personal file\'s folder, and storeOf finds the same store', async () => {
  const { jobFile, personal, env } = scratch();
  const home = dirname(personal);
  writeJson(personal, { runsDir: 'runs', workflow: 'flow.ts' });
  // Beside the personal file and named plainly: a path with enough `..` resolves the same from any folder.
  writeFileSync(join(home, 'flow.ts'), `export { ownerCheck as workflow } from ${JSON.stringify(join(import.meta.dirname, 'workflows.ts'))};\n`);
  const c = await loadConfig(jobFile, env);
  assert.equal(c.runsDir, join(home, 'runs'));
  assert.deepEqual(c.workflow, ownerCheck);
  assert.deepEqual(storeOf(jobFile, env), { runsDir: join(home, 'runs'), workId: 'w' });
});

test('whether the repository layer exists is decided at the base: one deleted later still applies, and one added later is not read', async () => {
  const a = scratch();
  const base = commitRepoLayer(a.repo, { runtime: { standard: 'pi' } });
  git(a.repo, 'rm', '-q', '-r', '.factory');
  git(a.repo, 'commit', '-q', '-m', 'drop factory config');
  writeJson(a.jobFile, { workId: 'w', ticket: 'x', repo: 'repo', base, runtime: { developer: 'claude' } });
  assert.deepEqual((await loadConfig(a.jobFile, a.env)).spec.runtime, { developer: 'claude', standard: 'pi' });
  const b = scratch();
  const bare = git(b.repo, 'rev-parse', 'HEAD');
  commitRepoLayer(b.repo, { runtime: { standard: 'pi' } });
  writeJson(b.jobFile, { workId: 'w', ticket: 'x', repo: 'repo', base: bare, runtime: { developer: 'claude' } });
  assert.deepEqual((await loadConfig(b.jobFile, b.env)).spec.runtime, { developer: 'claude' });
});

test('a relative XDG_CONFIG_HOME or HOME is ignored, so the working directory never supplies the personal layer', async () => {
  const { root, jobFile } = scratch();
  writeJson(join(root, 'cfg', 'software_factory', 'config.json'), { sandbox: { backend: 'none' } });
  writeJson(join(root, '.config', 'software_factory', 'config.json'), { sandbox: { backend: 'none' } });
  const home = join(root, 'home');
  writeJson(join(home, '.config', 'software_factory', 'config.json'), { runtime: { standard: 'pi' } });
  const cwd = process.cwd();
  process.chdir(root);
  try {
    assert.deepEqual((await loadConfig(jobFile, { HOME: '.' })).sandbox, { backend: 'bwrap' });
    // The XDG spec says a relative XDG_CONFIG_HOME is ignored; HOME still applies.
    const c = await loadConfig(jobFile, { XDG_CONFIG_HOME: 'cfg', HOME: home });
    assert.deepEqual([c.sandbox, c.spec.runtime], [{ backend: 'bwrap' }, { developer: 'claude', standard: 'pi' }]);
  } finally {
    process.chdir(cwd);
  }
});

test('the job file\'s runsDir resolves against the working directory, as before 10-b, not against the job file', async () => {
  const { root, jobFile, env } = scratch({ runsDir: 'runs' });
  const cwd = process.cwd();
  process.chdir(join(root, 'repo'));
  try {
    assert.equal((await loadConfig(jobFile, env)).runsDir, join(root, 'repo', 'runs'));
    assert.equal(storeOf(jobFile, env).runsDir, join(root, 'repo', 'runs'));
  } finally {
    process.chdir(cwd);
  }
});

// Ticket 10-c: a command's { file } argument names a file beside the workflow.
const fileFlow = (file: string) => `export const workflow = ${JSON.stringify({
  start: 'DEV',
  stages: {
    DEV: { kind: 'agent', role: 'developer', produces: 'commit', roleText: 'You are the developer for the ticket below.', transitions: { PASS: 'LINT' } },
    LINT: { kind: 'command', run: [{ name: 'lint', command: ['sh', { file }] }], transitions: { PASS: 'ACCEPTED' } },
  },
})};\n`;

test('workflowDir is the job workflow file\'s folder, and undefined for the default workflow', async () => {
  const { root, jobFile, env } = scratch();
  assert.equal((await loadConfig(jobFile, env)).workflowDir, undefined);
  mkdirSync(join(root, 'flows'));
  writeFileSync(join(root, 'flows', 'mine.ts'), fileFlow('lint.sh'));
  writeJson(jobFile, { workId: 'w', ticket: 'x', repo: 'repo', workflow: 'flows/mine.ts', runtime: { developer: 'claude' } });
  assert.equal((await loadConfig(jobFile, env)).workflowDir, join(root, 'flows'));
});

test('a repository workflow\'s file argument is read at the base SHA, not the working tree or a later commit', async () => {
  const { root, repo, jobFile, env } = scratch({ base: 'main' });
  writeJson(jobFile, { workId: 'w', ticket: 'x', repo: 'repo', base: 'main', runsDir: join(root, 'runs'), runtime: { developer: 'claude' } });
  mkdirSync(join(repo, 'ci', 'bin'), { recursive: true });
  writeFileSync(join(repo, 'ci', 'flow.ts'), fileFlow('bin/lint.sh'));
  writeFileSync(join(repo, 'ci', 'bin', 'lint.sh'), 'echo base\n');
  const base = commitRepoLayer(repo, { workflow: 'ci/flow.ts' });
  writeFileSync(join(repo, 'ci', 'bin', 'lint.sh'), 'echo working-tree\n');
  // Committed after loadConfig has resolved the base: the moved ref must not be read.
  const c = await loadConfig(jobFile, env);
  git(repo, 'commit', '-q', '-am', 'later');
  assert.equal(c.workflowDir, join(root, 'runs', 'repo-config', base, 'ci'));
  assert.equal(readFileSync(join(c.workflowDir!, 'bin', 'lint.sh'), 'utf8'), 'echo base\n');
});

test('a repository workflow naming a file that is not committed at the base is refused, naming it', async () => {
  const { repo, jobFile, env } = scratch();
  writeFileSync(join(repo, 'flow.ts'), fileFlow('lint.sh'));
  commitRepoLayer(repo, { workflow: 'flow.ts' });
  writeFileSync(join(repo, 'lint.sh'), 'echo untracked\n');
  await assert.rejects(loadConfig(jobFile, env), /lint\.sh.*not in the repository at [0-9a-f]{40}/);
});
