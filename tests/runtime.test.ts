// Ticket 03-a: how a runtime behaves as a launched, observed and cancelled child process.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRun, spawnRuntime } from '../src/runtime/spawn.ts';

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
    // The backgrounded grandchild holds stdout so the run is still pending when cancel() lands.
    command: 'sh',
    args: ['-c', `"${process.execPath}" -e "setTimeout(() => {}, 3000)" & echo ready; kill -SEGV $$`],
    prompt: '',
    cwd: dir,
  });
  await run.ready;
  await new Promise((res) => setTimeout(res, 300));
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

// Ticket 04-d: the 03-b minors, the size bound and cgroup isolation.
const hasUserSystemd = spawnSync('systemd-run', ['--user', '--scope', '-q', '--', 'true']).status === 0;
const scoped = (t: TestContext) => (hasUserSystemd ? true : (t.skip('no user systemd: systemd-run --user --scope failed'), false));

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

test('an empty command is reported as failed, not thrown', async () => {
  const r = await spawnRuntime({ command: '', args: [], prompt: '', cwd: dir });
  assert.equal(r.status, 'failed');
  assert.match(r.stderr, /command is empty/);
});

test('an unreadable cwd is reported against the cwd, not the binary', async (t) => {
  if (process.getuid?.() === 0) return void t.skip('root can read anything');
  const cwd = join(dir, 'locked');
  mkdirSync(cwd);
  chmodSync(cwd, 0o000);
  try {
    const r = await spawnRuntime({ command: process.execPath, args: ['-e', '1'], prompt: '', cwd });
    assert.equal(r.status, 'failed');
    assert.match(r.stderr, /^cwd .*locked/);
    assert.doesNotMatch(r.stderr, /spawn/);
  } finally {
    chmodSync(cwd, 0o700);
  }
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

test('scope: cancel kills a grandchild that left the process group with setsid', async (t) => {
  if (!scoped(t)) return;
  const marker = join(dir, 'escaped-marker.txt');
  const run = spawnRuntime({
    command: process.execPath,
    args: [fixture('escape.ts'), marker],
    prompt: '',
    cwd: dir,
    graceMs: 300,
    scope: `sf-test-${process.pid}-escape`,
  });
  await run.ready;
  run.cancel();
  const r = await run;
  assert.equal(r.status, 'cancelled');
  await new Promise((res) => setTimeout(res, 3000));
  assert.equal(existsSync(marker), false, 'setsid grandchild outlived the cancel');
});

test('scope: a child that re-parents itself with exec setsid leaves no worker behind', async (t) => {
  if (!scoped(t)) return;
  const marker = join(dir, 'reparent-marker.txt');
  const worker = `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(marker)}, "late"), 2500)`;
  const r = await spawnRuntime({
    command: 'sh',
    args: ['-c', `exec setsid "${process.execPath}" -e ${JSON.stringify(worker)}`],
    prompt: '',
    cwd: dir,
    scope: `sf-test-${process.pid}-reparent`,
  });
  assert.equal(r.status, 'exited');
  await new Promise((res) => setTimeout(res, 3000));
  assert.equal(existsSync(marker), false, 'worker outlived the exited child');
});

test('scope: a child that writes a large result and exits at once loses none of it', async (t) => {
  if (!scoped(t)) return;
  const r = await spawnRuntime({
    command: process.execPath,
    // Exit in the write callback: a bare process.exit after an async pipe write flushes only 64 KB
    // in the child itself, which would make the test about the fixture, not the pipe.
    args: ['-e', 'process.stdout.write("y".repeat(1 << 20), () => process.exit(0))'],
    prompt: '',
    cwd: dir,
    scope: `sf-test-${process.pid}-large`,
  });
  assert.equal(r.status, 'exited');
  assert.equal(r.stdout.length, 1 << 20);
});

// Ticket 04-e: after the child exited under a scope, the group is reaped and must not be signalled.
// Smoke test only: under a scope the exit-time cgroup.kill frees the pipe within one event-loop
// turn, so no test can hold the run in "exited but not settled" to observe the cancel() branch.
// The branch itself is verified by reading; this guards that the call is harmless.
test('scope: cancel() after the child exited while a grandchild held the pipe signals no group', async (t) => {
  if (!scoped(t)) return;
  const run = spawnRuntime({ command: process.execPath, args: [fixture('exit-early.ts')], prompt: '', cwd: dir, scope: `sf-test-${process.pid}-exit-early` });
  await run.ready;
  await new Promise((res) => setTimeout(res, 400));
  const kill = process.kill;
  let calls = 0;
  process.kill = ((...args: Parameters<typeof kill>) => { calls++; return kill(...args); }) as typeof kill;
  try {
    run.cancel();
    const r = await run;
    assert.equal(r.status, 'exited');
  } finally {
    process.kill = kill;
  }
  assert.equal(calls, 0, 'cancel after exit under a scope signalled the process group');
});

// Ticket 11-e: a run folder holds the run's stdin, output and exit code, so the run outlives the controller.
test('with a run folder: stdin, stdout, stderr and exit are files in it, and the result is read back from them', async () => {
  const runDir = join(dir, 'runs', 'echo');
  const r = await spawnRuntime({ command: process.execPath, args: [fixture('echo-prompt.ts')], prompt: 'hello folder', cwd: dir, dir: runDir });
  assert.equal(r.status, 'exited');
  assert.equal(r.exitCode, 3);
  assert.equal(r.stdout, `prompt=hello folder cwd=${dir}\n`);
  assert.equal(r.stderr, 'to stderr\n');
  assert.equal(readFileSync(join(runDir, 'stdin'), 'utf8'), 'hello folder');
  assert.equal(readFileSync(join(runDir, 'stdout'), 'utf8'), `prompt=hello folder cwd=${dir}\n`);
  assert.equal(readFileSync(join(runDir, 'stderr'), 'utf8'), 'to stderr\n');
  assert.equal(readFileSync(join(runDir, 'exit'), 'utf8').trim(), '3');
});

/** Polls until `exit` appears in `runDir`, up to `ms`. */
async function exitFile(runDir: string, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((res) => setTimeout(res, 50))) if (existsSync(join(runDir, 'exit'))) return true;
  return false;
}

// A controller in its own process, SIGKILLed while the run goes on, as a crash or a Ctrl-C would end it.
function killedController(runDir: string, shell: string, scope?: string, extra: object = {}): void {
  const spawnTs = join(import.meta.dirname, '..', 'src', 'runtime', 'spawn.ts');
  const opts = { command: 'sh', args: ['-c', shell], prompt: 'p', cwd: dir, dir: runDir, scope, ...extra };
  // The options go on stdin: a 2 MB prompt is past Linux's 128 KiB cap on one argument.
  const script = `import { readFileSync } from 'node:fs';
import { spawnRuntime } from ${JSON.stringify(spawnTs)};
spawnRuntime(JSON.parse(readFileSync(0, 'utf8')));
setTimeout(() => process.kill(process.pid, 'SIGKILL'), 300);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { input: JSON.stringify(opts), timeout: 10_000 });
  assert.equal(r.signal, 'SIGKILL', `controller did not die as planned: ${r.stderr}`);
}

for (const isolation of ['process-group', 'cgroup'] as const) {
  test(`${isolation}: a run whose controller was SIGKILLed finishes, and readRun gives its output and exit code`, async (t) => {
    if (isolation === 'cgroup' && !scoped(t)) return;
    const runDir = join(dir, 'runs', `orphan-${isolation}`);
    killedController(runDir, 'cat; sleep 1; echo done; echo oops >&2; exit 5', isolation === 'cgroup' ? `sf-test-${process.pid}-orphan` : undefined);
    assert.equal(readRun(runDir), undefined, 'the run had already ended when its controller died');
    assert.ok(await exitFile(runDir, 5000), 'the run left no exit file');
    const r = readRun(runDir)!;
    assert.equal(r.status, 'exited');
    assert.equal(r.exitCode, 5);
    assert.equal(r.stdout, 'pdone\n');
    assert.equal(r.stderr, 'oops\n');
  });
}

test('a controller SIGKILLed while a pipe would still be taking its 2 MB prompt leaves the run the whole prompt (11-e2)', async () => {
  const runDir = join(dir, 'runs', 'orphan-prompt');
  // Numbered lines, so a truncated or reordered prompt changes the digest as well as the length.
  const prompt = Array.from({ length: 2 * 1024 * 1024 / 8 }, (_, i) => `${i}`.padStart(7, '0') + '\n').join('');
  assert.equal(prompt.length, 2 * 1024 * 1024);
  // The controller dies 300 ms in, and the run reads nothing for 1 s: a pipe from the controller
  // would have taken one pipe buffer by then, far short of 2 MB.
  killedController(runDir, `exec "${process.execPath}" "${fixture('stdin-digest.ts')}"`, undefined, { prompt });
  assert.ok(await exitFile(runDir, 5000), 'the run left no exit file');
  assert.equal(readRun(runDir)!.stdout, `${2 * 1024 * 1024} ${createHash('sha256').update(prompt).digest('hex')}\n`);
});

test('cgroup: a run whose controller is dead is stopped by systemd at maxRuntimeMs, and the wrapper still writes its status', async (t) => {
  if (!scoped(t)) return;
  const runDir = join(dir, 'runs', 'orphan-deadline');
  const unit = `sf-test-${process.pid}-deadline`;
  // systemd keeps a scope it stopped for its time limit as `failed` until told to forget it.
  t.after(() => { spawnSync('systemctl', ['--user', 'reset-failed', `${unit}.scope`]); });
  const started = Date.now();
  killedController(runDir, 'sleep 30', unit, { maxRuntimeMs: 1000, graceMs: 1000 });
  assert.ok(await exitFile(runDir, 6000), 'the run was not stopped');
  assert.ok(Date.now() - started < 4000, `stopped after ${Date.now() - started}ms`);
  // 128 + SIGTERM: systemd's stop signal reached the command, and the wrapper outlived it.
  assert.equal(readRun(runDir)!.exitCode, 143);
});

test('readRun polled in a tight loop while the wrapper writes exit sees no status or the whole one, never an empty or partial one (11-e2)', async () => {
  // One run catches a non-atomic write (`echo "$s" > "$e"`) mid-way most of the time, not always;
  // twenty make a miss on all of them negligible.
  for (let i = 0; i < 20; i++) {
    const runDir = join(dir, 'runs', `exit-race-${i}`);
    const run = spawnRuntime({ command: 'sh', args: ['-c', 'exit 7'], prompt: '', cwd: dir, dir: runDir });
    for (const end = Date.now() + 5000; ;) {
      assert.ok(Date.now() < end, 'the run left no exit file');
      const r = readRun(runDir);
      if (r === undefined) continue;
      assert.equal(r.exitCode, 7, `run ${i}`);
      break;
    }
    await run;
  }
});

test('with a run folder: output past maxOutputBytes stops the run inside the grace bound and reports overflow with nothing kept', async () => {
  const started = Date.now();
  const r = await spawnRuntime({ command: process.execPath, args: [fixture('flood.ts')], prompt: '', cwd: dir, graceMs: 300, maxOutputBytes: 65536, dir: join(dir, 'runs', 'flood') });
  const took = Date.now() - started;
  assert.equal(r.status, 'overflow');
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /stdout exceeded 65536 bytes/);
  assert.ok(took < 300 + 1000, `took ${took}ms`);
});

test('readRun: a file past the cap is overflow, and the cap holds for stderr too', () => {
  const runDir = join(dir, 'runs', 'big');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'stdout'), 'x'.repeat(100));
  writeFileSync(join(runDir, 'stderr'), 'y'.repeat(101));
  writeFileSync(join(runDir, 'exit'), '0\n');
  assert.deepEqual(readRun(runDir, 100), { status: 'overflow', exitCode: 0, signal: null, stdout: '', stderr: 'stderr exceeded 100 bytes', wallMs: 0 });
  writeFileSync(join(runDir, 'stderr'), 'y');
  assert.deepEqual(readRun(runDir, 100), { status: 'exited', exitCode: 0, signal: null, stdout: 'x'.repeat(100), stderr: 'y', wallMs: 0 });
});

test('with a run folder: a cancel stays cancelled even when the run wrote past the cap since the last poll (11-e, standard 1)', async () => {
  const run = spawnRuntime({ command: 'sh', args: ['-c', 'head -c 200000 /dev/zero; echo ready >&2; sleep 5'], prompt: '', cwd: dir, maxOutputBytes: 100_000, dir: join(dir, 'runs', 'cancel-over') });
  await new Promise((res) => setTimeout(res, 30));
  run.cancel();
  assert.equal((await run).status, 'cancelled');
});

test('a relative run folder is refused before anything is created (11-e, standard 1)', async () => {
  const r = await spawnRuntime({ command: 'true', args: [], prompt: '', cwd: dir, dir: 'rel-run-folder' });
  assert.equal(r.status, 'failed');
  assert.match(r.stderr, /absolute/);
  assert.equal(existsSync('rel-run-folder'), false);
});

test('readRun on a 1 GiB output reports overflow without reading it: a whole read could not even become a string (11-e, standard 1)', () => {
  const runDir = join(dir, 'runs', 'huge');
  mkdirSync(runDir, { recursive: true });
  // Sparse: no memory or disk behind it, but V8's string cap is about 512 MiB.
  writeFileSync(join(runDir, 'stdout'), '');
  truncateSync(join(runDir, 'stdout'), 1 << 30);
  writeFileSync(join(runDir, 'exit'), '0\n');
  assert.equal(readRun(runDir)!.status, 'overflow');
});

test('a run folder that exists is refused, and its files are left as they were (11-e, standard 2)', async () => {
  const runDir = join(dir, 'runs', 'taken');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'stdin'), 'the first run\'s prompt');
  const r = await spawnRuntime({ command: 'true', args: [], prompt: 'a second prompt', cwd: dir, dir: runDir });
  assert.equal(r.status, 'failed');
  assert.match(r.stderr, /EEXIST/);
  assert.equal(readFileSync(join(runDir, 'stdin'), 'utf8'), 'the first run\'s prompt');
});

test('process-group isolation with a run folder: a descendant left behind dies when the run exits, and the exit code still comes through (11-e, standard 2)', async () => {
  const marker = join(dir, 'left-behind-marker.txt');
  const worker = `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(marker)}, "late"), 1500)`;
  const r = await spawnRuntime({ command: 'sh', args: ['-c', `"${process.execPath}" -e ${JSON.stringify(worker)} & echo hi; exit 4`], prompt: '', cwd: dir, dir: join(dir, 'runs', 'left-behind') });
  assert.equal(r.status, 'exited');
  assert.equal(r.exitCode, 4);
  assert.equal(r.stdout, 'hi\n');
  await new Promise((res) => setTimeout(res, 2500));
  assert.equal(existsSync(marker), false, 'the descendant outlived the run');
});
