// The sandbox executes a command with the declared mounts;
// under bwrap the command writes only its write roots, reads only the system directories and
// its read roots, and has no network and none of the controller's environment unless declared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execute, type Policy, type Sandbox } from '../src/sandbox.ts';

mkdirSync('/var/tmp/medrengard', { recursive: true });
const dir = mkdtempSync('/var/tmp/medrengard/sf-sandbox-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

// The node install this test runs on; on this machine it lives under ~/.config/nvm, outside /usr.
const NODE_PREFIX = dirname(dirname(realpathSync(process.execPath)));
const BWRAP: Sandbox = { backend: 'bwrap' };

let n = 0;
function scratch() {
  const root = join(dir, String(n++));
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  return { root, work };
}

function run(sandbox: Sandbox, policy: Policy, command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  try { return execute(sandbox, policy, [command, ...args], AbortSignal.timeout(5000)); }
  finally { process.env = previous; }
}
const sh = (sandbox: Sandbox, policy: Policy, script: string, env?: NodeJS.ProcessEnv) => run(sandbox, policy, 'sh', ['-c', script], env);

test('bwrap: the command writes in its write root and nowhere else', async () => {
  const { root, work } = scratch();
  const policy: Policy = { cwd: work, write: [work], read: [] };
  const r = await sh(BWRAP, policy, `echo in > in.txt; echo out > ${root}/out.txt; true`);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(readFileSync(join(work, 'in.txt'), 'utf8'), 'in\n');
  assert.ok(!existsSync(join(root, 'out.txt')), 'a sibling of the write root is not writable');
  const ro = await sh(BWRAP, policy, 'touch /usr/sf-sandbox-probe');
  assert.notEqual(ro.exitCode, 0);
  assert.ok(!existsSync('/usr/sf-sandbox-probe'));
  // bwrap's own root is a tmpfs; remounted read-only, nothing outside the binds takes a write.
  const top = await sh(BWRAP, policy, 'touch /sf-sandbox-root-probe');
  assert.notEqual(top.exitCode, 0);
  assert.match(top.stderr, /Read-only file system/);
});

test('bwrap: an undeclared path is not readable; a declared read root is, and is read-only', async () => {
  const { root, work } = scratch();
  const shared = join(root, 'shared');
  mkdirSync(shared);
  writeFileSync(join(shared, 'secret.txt'), 'secret\n');
  const without: Policy = { cwd: work, write: [work], read: [] };
  const hidden = await sh(BWRAP, without, `cat ${shared}/secret.txt`);
  assert.notEqual(hidden.exitCode, 0);
  assert.doesNotMatch(hidden.stdout, /secret/);
  // The owner's read list (Sandbox.read) and the stage's own (Policy.read) both bind read-only.
  for (const [sandbox, policy] of [[{ backend: 'bwrap', read: [shared] }, without], [BWRAP, { ...without, read: [shared] }]] as [Sandbox, Policy][]) {
    const seen = await sh(sandbox, policy, `cat ${shared}/secret.txt; echo changed > ${shared}/secret.txt`);
    assert.equal(seen.stdout, 'secret\n');
    assert.equal(readFileSync(join(shared, 'secret.txt'), 'utf8'), 'secret\n');
  }
});

test('bwrap: nested roots keep their own mode whichever way they nest (08-a standard 1)', async () => {
  const { work } = scratch();
  const ro = join(work, 'vendor');
  const rw = join(work, 'vendor', 'cache');
  mkdirSync(rw, { recursive: true });
  // A read root inside a write root stays read-only; a write root inside that read root stays writable.
  for (const policy of [{ cwd: work, write: [work, rw], read: [ro] }, { cwd: work, write: [rw, work], read: [ro] }]) {
    const r = await sh(BWRAP, policy, `touch ${ro}/f; touch ${rw}/g; touch ${work}/h; true`);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.ok(!existsSync(join(ro, 'f')), 'the read root under a write root is read-only');
    assert.ok(existsSync(join(rw, 'g')), 'the write root under a read root is writable');
    assert.ok(existsSync(join(work, 'h')));
    rmSync(join(rw, 'g'));
    rmSync(join(work, 'h'));
  }
});

test('bwrap: the controller environment is cleared to PATH, HOME=/tmp and LANG; /tmp is private', async () => {
  const { work } = scratch();
  const policy: Policy = { cwd: work, write: [work], read: [] };
  const r = await sh(BWRAP, policy, 'echo "secret=${SF_SANDBOX_SECRET:-unset} home=$HOME"; test -n "$PATH"; ls -A /tmp | wc -l', { SF_SANDBOX_SECRET: 'leaked' });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /^secret=unset home=\/tmp$/m);
  assert.match(r.stdout, /^0$/m);
});

test('bwrap: the command runs in a session of its own, so it cannot push input into the controller terminal', async () => {
  const { work } = scratch();
  // Field 6 of stat is the session ID; a session led from outside the PID namespace reads as 0.
  const r = await sh(BWRAP, { cwd: work, write: [work], read: [] }, 'cut -d" " -f6 /proc/$$/stat');
  assert.equal(r.exitCode, 0, r.stderr);
  assert.notEqual(r.stdout.trim(), '0');
});

test('bwrap: no network unless declared, then the host network', async () => {
  const { work } = scratch();
  const server = createServer((s) => s.end());
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const port = (server.address() as AddressInfo).port;
  const connect = `require('node:net').connect(${port}, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(7))`;
  try {
    const policy: Policy = { cwd: work, write: [work], read: [NODE_PREFIX] };
    const off = await run(BWRAP, policy, process.execPath, ['-e', connect]);
    assert.equal(off.exitCode, 7, off.stderr);
    const on = await run({ ...BWRAP, network: true }, policy, process.execPath, ['-e', connect]);
    assert.equal(on.exitCode, 0, on.stderr);
  } finally {
    server.close();
  }
});

test('bwrap: only declared variables are copied from the controller environment', async () => {
  const { work } = scratch();
  const policy: Policy = { cwd: work, write: [work], read: [] };
  const r = await sh({ ...BWRAP, env: ['SF_SANDBOX_TOKEN'] }, policy, 'echo "token=${SF_SANDBOX_TOKEN:-unset} secret=${SF_SANDBOX_SECRET:-unset}"', { SF_SANDBOX_TOKEN: 'declared', SF_SANDBOX_SECRET: 'leaked' });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.stdout, 'token=declared secret=unset\n');
});

test('bwrap: a declared value reaches bwrap through its environment, not its command line', async () => {
  const { root, work } = scratch();
  // A stand-in bwrap reports the arguments and environment the real one would receive.
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'bwrap'), '#!/bin/sh\nprintf "arg %s\\n" "$@"; env\n', { mode: 0o755 });
  const r = await run({ ...BWRAP, env: ['SF_SANDBOX_TOKEN'] }, { cwd: work, write: [work], read: [] }, 'true', [], { PATH: `${bin}:${process.env.PATH}`, SF_SANDBOX_TOKEN: 'declared-value', SF_SANDBOX_SECRET: 'leaked' });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /^arg .*declared-value/m);
  assert.match(r.stdout, /^SF_SANDBOX_TOKEN=declared-value$/m);
  assert.doesNotMatch(r.stdout, /leaked/, 'bwrap itself receives only the variables the sandbox gets');
});
