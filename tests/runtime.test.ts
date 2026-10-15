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

test('a missing binary is reported as failed to start, not thrown', async () => {
  const r = await spawnRuntime({ command: join(dir, 'no-such-binary'), args: [], prompt: '', cwd: dir });
  assert.equal(r.status, 'failed');
  assert.match(r.stderr, /ENOENT/);
});
