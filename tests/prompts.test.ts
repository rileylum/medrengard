// Ticket 09-c: the default prompts, captured from the code before the prompt split, stay
// byte for byte the same. Only what differs per run is normalised: the nonce and Git SHAs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, RunRequest } from '../src/adapter.ts';
import { develop, fix, type Job } from '../src/developer.ts';
import { review } from '../src/review.ts';
import { claude, cliAdapter } from '../src/runtime/cli-adapter.ts';
import { EventStore } from '../src/store.ts';
import { verify } from '../src/verify.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-prompts-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...a], { cwd, encoding: 'utf8' }).trim();
const fixture = join(import.meta.dirname, 'fixtures', 'fake-cli.ts');
const fake = (kase: string, variant = 'ok') =>
  cliAdapter({ ...claude, command: process.execPath, args: [fixture, 'claude', kase, variant] }, { isolation: 'process-group' });
const golden = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'prompts', `${name}.txt`), 'utf8');

/** The adapter, with every request it starts kept in `seen`. */
function recording(adapter: Adapter, seen: RunRequest[]): Adapter {
  return { name: adapter.name, start: (req, signal) => (seen.push(req), adapter.start(req, signal)) };
}

// The nonce is random per run, SHAs depend on commit time; nothing else may differ.
function normalise(prompt: string): string {
  const nonce = /delimited by lines beginning with `==== ([0-9a-f]{8}):`/.exec(prompt)?.[1];
  const p = nonce ? prompt.replaceAll(nonce, '<nonce>') : prompt;
  return p.replace(/\b[0-9a-f]{40}\b/g, '<sha>').replace(/^index [0-9a-f]+\.\.[0-9a-f]+/gm, 'index <abbrev>..<abbrev>');
}

/** One default-workflow cycle through develop, a standard FAIL, fix, a standard PASS and an adversarial PASS. */
async function fullCycle() {
  const root = join(dir, String(Math.random()).slice(2));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  writeFileSync(join(repo, 'AGENTS.md'), '# Scratch rules\n\nNever delete README.md.\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'initial');
  const store = new EventStore(join(root, 'events.sqlite'));
  const opts = { deadlineMs: 20_000, runsDir: join(root, 'runs') };
  const vopts = { ...opts, isolation: 'process-group' as const };
  const job: Job = { workId: 'w1', ticket: 'TICKET: create done.txt and commit it.', repo, checks: [{ name: 'file', command: ['sh', '-c', 'echo "done.txt is there"; test -f done.txt'] }] };
  const seen: RunRequest[] = [];
  const { cycle } = await develop(store, recording(fake('commit'), seen), job, opts);
  const { cycleId } = cycle;
  assert.equal((await verify(store, cycleId, job, vopts)).cycle.stage, 'STANDARD_REVIEW');
  assert.equal((await review(store, recording(fake('verdict', 'fail'), seen), cycleId, job, opts)).stage, 'DEVELOPING');
  assert.equal((await fix(store, recording(fake('commit'), seen), cycleId, job, opts)).cycle.stage, 'VERIFYING');
  assert.equal((await verify(store, cycleId, job, vopts)).cycle.stage, 'STANDARD_REVIEW');
  assert.equal((await review(store, recording(fake('verdict', 'pass'), seen), cycleId, job, opts)).stage, 'ADVERSARIAL_REVIEW');
  assert.equal((await review(store, recording(fake('verdict', 'pass'), seen), cycleId, job, opts)).stage, 'AWAITING_ACCEPTANCE');
  const [developer, standard, fixRun, standard2, adversarial] = seen.map((r) => r.prompt);
  return { store, cycleId, prompts: { developer: developer!, standard: standard!, fix: fixRun!, standard2: standard2!, adversarial: adversarial! } };
}

test('the default developer, fix, standard and adversarial prompts are unchanged apart from the nonce and SHAs', async () => {
  const { store, prompts } = await fullCycle();
  for (const name of ['developer', 'fix', 'standard', 'adversarial'] as const) assert.equal(normalise(prompts[name]), golden(name), name);
  store.close();
});
