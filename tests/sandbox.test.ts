// Ticket 08-a: the sandbox seam. `wrap` turns a command and a policy into the argv to spawn;
// under bwrap the command writes only its write roots, reads only the system directories and
// its read roots, has no network unless asked and none of the controller's environment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkSandbox, wrap, type Policy, type Sandbox } from '../src/sandbox.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-sandbox-');
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

// Async, not spawnSync: the network test's listener must keep accepting while the child runs.
function run(sandbox: Sandbox, policy: Policy, command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const [cmd, argv] = wrap(sandbox, policy, command, args);
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(cmd, argv, { cwd: policy.cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
const sh = (sandbox: Sandbox, policy: Policy, script: string, env?: NodeJS.ProcessEnv) => run(sandbox, policy, 'sh', ['-c', script], env);

test('backend none returns the command unchanged', () => {
  const policy: Policy = { cwd: '/x', write: ['/x'], read: [], network: false };
  assert.deepEqual(wrap({ backend: 'none' }, policy, 'npm', ['test']), ['npm', ['test']]);
});

test('bwrap: the command writes in its write root and nowhere else', async () => {
  const { root, work } = scratch();
  const policy: Policy = { cwd: work, write: [work], read: [], network: false };
  const r = await sh(BWRAP, policy, `echo in > in.txt; echo out > ${root}/out.txt; true`);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readFileSync(join(work, 'in.txt'), 'utf8'), 'in\n');
  assert.ok(!existsSync(join(root, 'out.txt')), 'a sibling of the write root is not writable');
  const ro = await sh(BWRAP, policy, 'touch /usr/sf-sandbox-probe');
  assert.notEqual(ro.code, 0);
  assert.ok(!existsSync('/usr/sf-sandbox-probe'));
  // bwrap's own root is a tmpfs; remounted read-only, nothing outside the binds takes a write.
  const top = await sh(BWRAP, policy, 'touch /sf-sandbox-root-probe');
  assert.notEqual(top.code, 0);
  assert.match(top.stderr, /Read-only file system/);
});

test('bwrap: an undeclared path is not readable; a declared read root is, and is read-only', async () => {
  const { root, work } = scratch();
  const shared = join(root, 'shared');
  mkdirSync(shared);
  writeFileSync(join(shared, 'secret.txt'), 'secret\n');
  const without: Policy = { cwd: work, write: [work], read: [], network: false };
  const hidden = await sh(BWRAP, without, `cat ${shared}/secret.txt`);
  assert.notEqual(hidden.code, 0);
  assert.doesNotMatch(hidden.stdout, /secret/);
  // The owner's read list (Sandbox.read) and the stage's own (Policy.read) both bind read-only.
  for (const [sandbox, policy] of [[{ backend: 'bwrap', read: [shared] }, without], [BWRAP, { ...without, read: [shared] }]] as [Sandbox, Policy][]) {
    const seen = await sh(sandbox, policy, `cat ${shared}/secret.txt; echo changed > ${shared}/secret.txt`);
    assert.equal(seen.stdout, 'secret\n');
    assert.equal(readFileSync(join(shared, 'secret.txt'), 'utf8'), 'secret\n');
  }
});

test('bwrap: the controller environment is cleared to PATH, HOME=/tmp and LANG; /tmp is private', async () => {
  const { work } = scratch();
  const policy: Policy = { cwd: work, write: [work], read: [], network: false };
  const r = await sh(BWRAP, policy, 'echo "secret=${SF_SANDBOX_SECRET:-unset} home=$HOME"; test -n "$PATH"; ls -A /tmp | wc -l', { SF_SANDBOX_SECRET: 'leaked' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^secret=unset home=\/tmp$/m);
  assert.match(r.stdout, /^0$/m);
});

test('bwrap: the command runs in a session of its own, so it cannot push input into the controller terminal', async () => {
  const { work } = scratch();
  // Field 6 of stat is the session ID; a session led from outside the PID namespace reads as 0.
  const r = await sh(BWRAP, { cwd: work, write: [work], read: [], network: false }, 'cut -d" " -f6 /proc/$$/stat');
  assert.equal(r.code, 0, r.stderr);
  assert.notEqual(r.stdout.trim(), '0');
});

test('bwrap: no network unless the policy asks for it', async () => {
  const { work } = scratch();
  const server = createServer((s) => s.end());
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const port = (server.address() as AddressInfo).port;
  const connect = `require('node:net').connect(${port}, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(7))`;
  try {
    const policy: Policy = { cwd: work, write: [work], read: [NODE_PREFIX], network: false };
    const off = await run(BWRAP, policy, process.execPath, ['-e', connect]);
    assert.equal(off.code, 7, off.stderr);
    const on = await run(BWRAP, { ...policy, network: true }, process.execPath, ['-e', connect]);
    assert.equal(on.code, 0, on.stderr);
  } finally {
    server.close();
  }
});

test('checkSandbox: passes for none and for a working bwrap; throws naming none when bwrap cannot start or a read path is wrong', () => {
  checkSandbox({ backend: 'none' });
  checkSandbox(BWRAP);
  checkSandbox({ backend: 'bwrap', read: [NODE_PREFIX] });
  assert.throws(() => checkSandbox({ backend: 'bwrap', read: ['relative/path'] }), /absolute/);
  assert.throws(() => checkSandbox({ backend: 'bwrap', read: [join(dir, 'no-such-dir')] }), /does not exist/);
  assert.throws(() => checkSandbox({ backend: 'docker' } as unknown as Sandbox), /backend/);
  const path = process.env.PATH;
  process.env.PATH = join(dir, 'empty-path');
  try {
    assert.throws(() => checkSandbox(BWRAP), /"none"/);
  } finally {
    process.env.PATH = path;
  }
});
