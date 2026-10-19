// Ticket 10-a: runtimes and sandbox backends chosen by name, and an extension runtime that speaks
// one JSON RunRequest in and one JSON RunOutcome out through cliAdapter's spawn path. Offline:
// the extension is tests/fixtures/ext-runtime.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunOutcome } from '../src/adapter.ts';
import { execute, receive } from '../src/controller.ts';
import { cliAdapter, extensionSpec } from '../src/runtime/cli-adapter.ts';
import { runtimeFor, runtimes } from '../src/runtime/registry.ts';
import { checkSandbox, confines, reachable, wrap, type Sandbox } from '../src/sandbox.ts';
import { EventStore } from '../src/store.ts';
import { fakeAdapter } from './fake-adapter.ts';
import { PASS_CHECKS } from './scenarios.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-registry-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const FIXTURES = join(import.meta.dirname, 'fixtures');
const EXT = join(FIXTURES, 'ext-runtime.ts');
const EXT_HASH = createHash('sha256').update(readFileSync(EXT)).digest('hex');
const offline = { isolation: 'process-group' as const };
const DOCKER = { backend: 'docker' } as unknown as Sandbox;

let n = 0;
/** A scratch repository to be the run's cwd. */
function repo() {
  const root = join(dir, String(n++));
  const cwd = join(root, 'work');
  mkdirSync(cwd, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'initial'], { cwd });
  return { root, cwd };
}
const fresh = () => {
  const store = new EventStore(join(dir, `${n++}.sqlite`));
  store.open('c1', 'w1');
  return store;
};
const start = (prompt: string, cwd: string, signal = new AbortController().signal): Promise<RunOutcome> =>
  cliAdapter(extensionSpec('ext', EXT), offline).start({ runId: 'r1', role: 'developer', prompt, cwd }, signal);

test('an unknown runtime name is refused, and the reason lists the registered names', () => {
  const registry = runtimes({ ext: { module: EXT } }, dir);
  assert.throws(() => runtimeFor(registry, 'codex', 'developer'), /runtime\.developer must be one of claude, pi, ext, got "codex"/);
  assert.throws(() => runtimeFor(registry, undefined, 'reviewer'), /runtime\.reviewer must be one of claude, pi, ext/);
  // A name off Object.prototype is not a runtime.
  assert.throws(() => runtimeFor(registry, 'constructor', 'developer'), /must be one of/);
  assert.ok(runtimeFor(registry, 'ext', 'developer'));
});

test('a job-file runtime may not reuse a built-in name, and one whose module is missing is refused when the registry is built', () => {
  assert.throws(() => runtimes({ claude: { module: EXT } }, dir), /runtimes\.claude.*built-in/);
  assert.throws(() => runtimes({ ext: { module: 'no-such-module.ts' } }, dir), /no-such-module\.ts/);
  assert.throws(() => runtimes({ ext: {} as { module: string } }, dir), /runtimes\.ext\.module/);
  // The store refuses an empty runtime on an outcome event, so the run's outcome could not be recorded.
  assert.throws(() => runtimes({ '': { module: EXT } }, dir), /runtime name "" is empty/);
});

test('an unknown sandbox backend is refused by check, wrap and reachable, and the reason lists the backends', () => {
  const policy = { cwd: dir, write: [], read: [], network: false };
  for (const call of [() => checkSandbox(DOCKER), () => wrap(DOCKER, policy, 'true', []), () => reachable(DOCKER, policy, '/usr/bin/true')]) {
    assert.throws(call, /sandbox backend "docker" is not one of bwrap, none/);
  }
  assert.equal(confines({ backend: 'bwrap' }), true);
  assert.equal(confines({ backend: 'none' }), false);
  assert.throws(() => confines(DOCKER), /not one of bwrap, none/);
  // Before any run: the adapter is refused at construction.
  assert.throws(() => cliAdapter(extensionSpec('ext', EXT), { ...offline, sandbox: DOCKER }), /not one of bwrap, none/);
});

test('extension: a developer request through stdin commits and completes with the claim from stdout', async () => {
  const { cwd } = repo();
  const o = await start('do the ticket', cwd);
  assert.equal(o.status, 'completed', JSON.stringify(o));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  assert.deepEqual((o as { claim: unknown }).claim, { head, artifacts: ['done.txt'] });
});

test('extension: the adapter carries the module name and the SHA-256 of the module file', () => {
  const a = cliAdapter(extensionSpec('ext', EXT), offline);
  assert.equal(a.name, 'ext');
  assert.equal(a.moduleHash, EXT_HASH);
  assert.equal(cliAdapter(extensionSpec('ext', EXT), offline).moduleHash, EXT_HASH);
});

test('extension: malformed JSON, a non-zero exit, a deadline overrun and a cancel each end as one run_failed', async () => {
  const { cwd } = repo();
  const adapter = cliAdapter(extensionSpec('ext', EXT), { ...offline, graceMs: 500 });
  const failures = async (prompt: string, deadlineMs: number) => {
    const store = fresh();
    const c = await execute(store, 'c1', adapter, { role: 'developer', prompt, cwd }, { deadlineMs, base: 'B1' });
    const failed = store.events('c1').filter((e) => e.type === 'run_failed');
    assert.equal(failed.length, 1, prompt);
    assert.equal(c.stage, 'ESCALATED', prompt);
    return failed[0]!.type === 'run_failed' ? failed[0]!.reason : '';
  };
  assert.match(await failures('EXT:bad-json', 10_000), /ext stdout is not JSON/);
  assert.match(await failures('EXT:exit', 10_000), /ext exited 1: ext failed on purpose/);
  assert.equal(await failures('EXT:sleep', 1000), 'timeout');

  const ac = new AbortController();
  const run = start('EXT:sleep', cwd, ac.signal);
  setTimeout(() => ac.abort(), 300);
  const o = await run;
  assert.deepEqual(o, { status: 'cancelled' });
  const store = fresh();
  store.append('c1', { type: 'claim', runId: 'r1', base: 'B1', runtime: 'ext' });
  receive(store, 'c1', 'r1', 'developer', o);
  assert.deepEqual(store.events('c1').filter((e) => e.type === 'run_failed').map((e) => e.type === 'run_failed' && e.reason), ['cancelled']);
});

test('extension under bwrap: commits in its cwd, cannot write outside it, and its module directory is bound read-only', async () => {
  const { root, cwd } = repo();
  const outside = join(root, 'outside');
  const adapter = cliAdapter(extensionSpec('ext', EXT), { ...offline, sandbox: { backend: 'bwrap' }, writes: true });
  const o = await adapter.start({ runId: 'r1', role: 'developer', prompt: `do the ticket\nEXT:outside ${outside}\n`, cwd }, new AbortController().signal);
  assert.equal(o.status, 'completed', JSON.stringify(o));
  assert.equal((o as { claim: { escaped: boolean } }).claim.escaped, false);
  assert.ok(!existsSync(outside));
  assert.ok(existsSync(join(cwd, 'done.txt')));

  const writer = join(dir, `ext-writer-${n++}`);
  mkdirSync(writer);
  const module = join(writer, 'ext.ts');
  writeFileSync(module, `import { writeFileSync } from 'node:fs';\nlet ok = true;\ntry { writeFileSync(${JSON.stringify(join(writer, 'x'))}, 'x'); } catch { ok = false; }\nprocess.stdin.resume();\nprocess.stdin.on('end', () => process.stdout.write(JSON.stringify({ status: 'completed', claim: { wrote: ok } })));\n`);
  const own = await cliAdapter(extensionSpec('own', module), { ...offline, sandbox: { backend: 'bwrap' }, writes: true })
    .start({ runId: 'r2', role: 'developer', prompt: 'x', cwd }, new AbortController().signal);
  assert.deepEqual(own, { status: 'completed', claim: { wrote: false } });
});

test('every run outcome event records the runtime name, and the module hash when the adapter has one', async () => {
  const store = fresh();
  const dev = { ...fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', artifacts: ['a'] } } }), name: 'ext', moduleHash: EXT_HASH };
  await execute(store, 'c1', dev, { role: 'developer', prompt: 'p', cwd: dir }, { deadlineMs: 5000, base: 'B1' });
  store.append('c1', { type: 'verification', head: 'H1', checks: PASS_CHECKS });
  await execute(store, 'c1', fakeAdapter({ outcome: { status: 'completed', claim: { head: 'H1', verdict: 'PASS', findings: [] } } }), { role: 'standard_reviewer', prompt: 'p', cwd: dir }, { deadlineMs: 5000 });
  await execute(store, 'c1', fakeAdapter({ outcome: { status: 'failed', reason: 'crash' } }), { role: 'adversarial_reviewer', prompt: 'p', cwd: dir }, { deadlineMs: 5000 });
  const outcomes = store.events('c1').filter((e) => ['developer_result', 'verdict', 'run_failed'].includes(e.type)) as Record<string, unknown>[];
  assert.deepEqual(outcomes.map((e) => [e.type, e.runtime, e.moduleHash]), [
    ['developer_result', 'ext', EXT_HASH],
    ['verdict', 'fake', undefined],
    ['run_failed', 'fake', undefined],
  ]);
});

test('an outcome event whose runtime or moduleHash is not a string is refused by the store', () => {
  const store = fresh();
  store.append('c1', { type: 'claim', runId: 'r1', base: 'B1', runtime: 'ext' });
  for (const extra of [{ runtime: 7 }, { runtime: '' }, { moduleHash: ['x'] }]) {
    assert.throws(() => store.append('c1', { type: 'run_failed', runId: 'r1', reason: 'x', ...extra } as never), undefined, JSON.stringify(extra));
  }
});
