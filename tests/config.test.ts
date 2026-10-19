// Ticket 10-b: the four configuration layers, read through loadConfig. Each test gets its own
// XDG_CONFIG_HOME, so the owner's personal file never reaches one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/config.ts';

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
