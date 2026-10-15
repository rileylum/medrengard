// Ticket 03-a: how a runtime behaves as a launched, observed and cancelled child process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnRuntime } from '../src/runtime/spawn.ts';

const dir = mkdtempSync(join(tmpdir(), 'sf-runtime-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name);

test('spawnRuntime returns exit code, stdout, stderr and wall time', async () => {
  const r = await spawnRuntime({
    command: process.execPath,
    args: [fixture('echo-prompt.ts')],
    prompt: 'hello runtime',
    cwd: dir,
  });
  assert.equal(r.status, 'exited');
  assert.equal(r.exitCode, 3);
  assert.equal(r.stdout, `prompt=hello runtime cwd=${dir}\n`);
  assert.equal(r.stderr, 'to stderr\n');
  assert.ok(r.wallMs >= 0 && r.wallMs < 10_000, `wallMs ${r.wallMs}`);
});

test('cancel: SIGTERM is ignored, SIGKILL after the grace period, reported as cancelled', async () => {
  const run = spawnRuntime({
    command: process.execPath,
    args: [fixture('ignore-sigterm.ts')],
    prompt: '',
    cwd: dir,
    graceMs: 500,
  });
  // The child prints "ready" once its SIGTERM handler is installed; cancelling earlier would
  // make the default handler exit and prove nothing.
  await run.ready;
  const started = Date.now();
  run.cancel();
  const r = await run;
  const took = Date.now() - started;
  assert.equal(r.status, 'cancelled');
  assert.notEqual(r.exitCode, 0);
  assert.equal(r.signal, 'SIGKILL');
  assert.ok(took < 500 + 1000, `cancel took ${took}ms`);
  assert.match(r.stdout, /ready/);
});

test('cancel of a child that honours SIGTERM is still cancelled, before the grace period', async () => {
  const run = spawnRuntime({
    command: process.execPath,
    args: ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'],
    prompt: '',
    cwd: dir,
    graceMs: 5000,
  });
  await run.ready;
  const started = Date.now();
  run.cancel();
  const r = await run;
  assert.equal(r.status, 'cancelled');
  assert.equal(r.signal, 'SIGTERM');
  assert.ok(Date.now() - started < 2000);
});

// Ticket 03-b: descendants and pipes must not stretch the cancel bound.
test('cancel kills the process group: a grandchild on the pipe neither delays the result nor outlives it', async () => {
  const marker = join(dir, 'late-marker.txt');
  const run = spawnRuntime({
    command: process.execPath,
    args: [fixture('grandchild.ts'), marker],
    prompt: '',
    cwd: dir,
    graceMs: 300,
  });
  await run.ready;
  const started = Date.now();
  run.cancel();
  const r = await run;
  const took = Date.now() - started;
  assert.equal(r.status, 'cancelled');
  assert.ok(took < 300 + 1000, `cancel took ${took}ms`);
  // The grandchild would write 2.5 s after start; wait past that to prove it is dead.
  await new Promise((res) => setTimeout(res, 3000));
  assert.equal(existsSync(marker), false, 'grandchild outlived the cancel');
});

test('cancel after the child exited but a grandchild holds the pipe still resolves promptly', async () => {
  const run = spawnRuntime({ command: process.execPath, args: [fixture('exit-early.ts')], prompt: '', cwd: dir, graceMs: 300 });
  await run.ready;
  await new Promise((res) => setTimeout(res, 400));
  const started = Date.now();
  run.cancel();
  const r = await run;
  assert.ok(Date.now() - started < 1000, 'cancel did not unstick the run');
  assert.equal(r.status, 'exited');
  assert.equal(r.exitCode, 0);
});

test('a child that died by its own signal before cancel is reported exited, not cancelled', async () => {
  const run = spawnRuntime({
    // sh, not node: node writes a diagnostic report on SIGSEGV and takes most of a second to die.
    command: 'sh',
    args: ['-c', 'echo ready; kill -SEGV $$'],
    prompt: '',
    cwd: dir,
  });
  await run.ready;
  await new Promise((res) => setTimeout(res, 200));
  run.cancel();
  const r = await run;
  assert.equal(r.status, 'exited');
  assert.equal(r.signal, 'SIGSEGV');
});

test('a missing cwd is reported as failed and names the directory, not the binary', async () => {
  const cwd = join(dir, 'no-such-dir');
  const r = await spawnRuntime({ command: process.execPath, args: ['-e', '1'], prompt: '', cwd });
  assert.equal(r.status, 'failed');
  assert.match(r.stderr, /no-such-dir/);
  assert.match(r.stderr, /^cwd /);
});

test('a missing binary is reported as failed to start, not thrown', async () => {
  const r = await spawnRuntime({ command: join(dir, 'no-such-binary'), args: [], prompt: '', cwd: dir });
  assert.equal(r.status, 'failed');
  assert.match(r.stderr, /ENOENT/);
});
