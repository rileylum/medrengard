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
  // The grandchild writes the marker once its parent is gone (its ppid changes): a fixed wait was
  // too short under the full suite's load, and cancel then landed on a live child (11-f2).
  const marker = join(dir, 'segv-dead');
  const watch = `const p = process.ppid; setInterval(() => { if (process.ppid !== p) require('fs').writeFileSync(${JSON.stringify(marker)}, ''); }, 10); setTimeout(() => process.exit(), 3000);`;
  const run = spawnRuntime({
    // sh, not node: node writes a diagnostic report on SIGSEGV and takes most of a second to die.
    // The backgrounded grandchild holds stdout so the run is still pending when cancel() lands.
    command: 'sh',
    args: ['-c', `"${process.execPath}" -e ${JSON.stringify(watch).replace(/\$/g, '\\$')} & echo ready; kill -SEGV $$`],
    prompt: '',
    cwd: dir,
  });
  await run.ready;
  for (const end = Date.now() + 10_000; !existsSync(marker) && Date.now() < end; ) await new Promise((res) => setTimeout(res, 10));
  // This process hears of the death through SIGCHLD; give its event loop a moment to take it.
  await new Promise((res) => setTimeout(res, 100));
  const started = Date.now();
  run.cancel();
  const r = await run;
  assert.ok(Date.now() - started < 1000, 'cancel did not unstick the run');
  assert.equal(r.status, 'exited');
  assert.equal(r.signal, 'SIGSEGV');
});

test('a cancelled child that honours SIGTERM resolves at once, not at the grace period, when a grandchild holds the pipe', async () => {
  const run = spawnRuntime({
    command: 'sh',
    // The grandchild ignores SIGTERM: otherwise the group SIGTERM would free the pipe by itself
    // and the test could not tell the exit-time SIGKILL from the grace-period one.
    // The grandchild prints "ready" itself, after its handler is installed; an earlier echo from
    // sh would let the cancel land while node is still booting with the default handler.
    args: ['-c', `"${process.execPath}" -e "process.on('SIGTERM', () => {}); console.log('ready'); setTimeout(() => {}, 3000)" & sleep 10`],
    prompt: '',
    cwd: dir,
    graceMs: 2000,
  });
  await run.ready;
  const started = Date.now();
  run.cancel();
  const r = await run;
  assert.equal(r.status, 'cancelled');
  assert.ok(Date.now() - started < 1000, 'waited for the grace period or the grandchild');
});

test('a missing binary is reported as failed to start, not thrown', async () => {
  const r = await spawnRuntime({ command: join(dir, 'no-such-binary'), args: [], prompt: '', cwd: dir });
  assert.equal(r.status, 'failed');
  assert.match(r.stderr, /ENOENT/);
});

test('cancel() after the run has resolved signals nothing', async () => {
  const run = spawnRuntime({ command: process.execPath, args: ['-e', '1'], prompt: '', cwd: dir });
  await run;
  const kill = process.kill;
  let calls = 0;
  process.kill = ((...args: Parameters<typeof kill>) => { calls++; return kill(...args); }) as typeof kill;
  try {
    run.cancel();
    run.cancel();
  } finally {
    process.kill = kill;
  }
  assert.equal(calls, 0, 'cancel after resolve called process.kill');
});

test('ready resolves on the first stderr byte of a child that never writes stdout', async () => {
  const run = spawnRuntime({
    command: process.execPath,
    args: ['-e', 'console.error("ready"); setInterval(() => {}, 1000)'],
    prompt: '',
    cwd: dir,
  });
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('ready never fired')), 3000));
  await Promise.race([run.ready, timeout]);
  run.cancel();
  await run;
});

test('output past maxOutputBytes stops the run inside the grace bound and reports overflow with nothing kept', async () => {
  const started = Date.now();
  const r = await spawnRuntime({
    command: process.execPath,
    args: [fixture('flood.ts')],
    prompt: '',
    cwd: dir,
    graceMs: 300,
    maxOutputBytes: 65536,
  });
  const took = Date.now() - started;
  assert.equal(r.status, 'overflow');
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /stdout exceeded 65536 bytes/);
  assert.ok(took < 300 + 1000, `took ${took}ms`);
});
