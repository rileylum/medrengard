// Ticket 04-d: the claude and pi adapters over spawnRuntime, observed through start() and through
// execute() with store.load(). Offline against tests/fixtures/fake-cli.ts, which replays the
// shapes recorded in docs/work/03-a-findings.md; live against the real CLIs under RUNTIME_SPIKE=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RunOutcome } from '../src/adapter.ts';
import { execute } from '../src/controller.ts';
import { checkScopes, claude, cliAdapter, extensionSpec, pi, scopeHint, type CliSpec } from '../src/runtime/cli-adapter.ts';
import { EventStore } from '../src/store.ts';

const LIVE = process.env.RUNTIME_SPIKE === '1';
const dir = mkdtempSync(join(tmpdir(), 'sf-cli-adapter-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const fixture = join(import.meta.dirname, 'fixtures', 'fake-cli.ts');
/** The real spec's parser over the fixture binary. */
const fake = (spec: CliSpec, kase: string): CliSpec => ({ ...spec, command: process.execPath, args: [fixture, spec.name, kase] });
const offline = { isolation: 'process-group' as const };
const req = (prompt = 'do the ticket') => ({ runId: 'r1', role: 'developer' as const, prompt, cwd: dir });
const start = (spec: CliSpec, kase: string, prompt?: string): Promise<RunOutcome> =>
  cliAdapter(fake(spec, kase), offline).start(req(prompt), new AbortController().signal);

let n = 0;
const fresh = () => {
  const store = new EventStore(join(dir, `${n++}.sqlite`));
  store.open('c1', 'w1');
  return store;
};

for (const spec of [claude, pi]) {
  test(`${spec.name}: a successful run yields completed with the claim from the json block and the session id`, async () => {
    const o = await start(spec, 'ping');
    assert.deepEqual(o, {
      status: 'completed',
      claim: { head: 'H1', artifacts: ['result.json'] },
      sessionId: spec.name === 'claude' ? 'c0ffee00-0000-4000-8000-000000000001' : '019a0000-0000-7000-8000-000000000002',
    });
  });

  test(`${spec.name}: the last json block wins, and a whole-reply object is accepted`, async () => {
    const two = 'first\n```json\n{"head":"OLD","artifacts":[]}\n```\nthen\n```json\n{"head":"NEW","artifacts":["a"]}\n```\n';
    assert.deepEqual((await start(spec, 'echo-prompt', two) as any).claim, { head: 'NEW', artifacts: ['a'] });
    assert.deepEqual((await start(spec, 'echo-prompt', '{"head":"H2","artifacts":[]}') as any).claim, { head: 'H2', artifacts: [] });
  });

  test(`${spec.name}: a reply without a claim block, or with one that is not JSON, is failed with a reason`, async () => {
    const none = await start(spec, 'echo-prompt', 'I did the thing.');
    assert.deepEqual(none, { status: 'failed', reason: 'no claim block in reply' });
    const bad = await start(spec, 'echo-prompt', 'done\n```json\n{head: H1}\n```\n');
    assert.equal(bad.status, 'failed');
    assert.match((bad as any).reason, /claim block is not JSON/);
  });

  test(`${spec.name}: a bad model is failed and the reason names the model`, async () => {
    const o = await start(spec, 'bad-model');
    assert.equal(o.status, 'failed');
    assert.match((o as any).reason, /no-such-model-xyz/);
  });

  test(`${spec.name}: no auth is failed with the CLI's own sentence`, async () => {
    const o = await start(spec, 'no-auth');
    assert.equal(o.status, 'failed');
    assert.match((o as any).reason, /Not logged in|No API key found/);
  });

  test(`${spec.name}: a missing binary is failed, not thrown`, async () => {
    const o = await cliAdapter({ ...spec, command: join(dir, 'no-such-binary') }, offline).start(req(), new AbortController().signal);
    assert.equal(o.status, 'failed');
    assert.match((o as any).reason, /ENOENT/);
  });

  test(`${spec.name}: abort before the child finishes yields cancelled`, async () => {
    const ac = new AbortController();
    const adapter = cliAdapter({ ...spec, command: process.execPath, args: ['-e', 'console.log("x"); setInterval(() => {}, 1000)'] }, offline);
    const p = adapter.start(req(), ac.signal);
    setTimeout(() => ac.abort(), 300);
    assert.deepEqual(await p, { status: 'cancelled' });
  });
}

test('claude: empty stdout and non-JSON stdout are failed with a reason that quotes stderr or the exit code', async () => {
  const empty = await start(claude, 'empty');
  assert.equal(empty.status, 'failed');
  assert.match((empty as any).reason, /not a JSON result/);
  const garbage = await start(claude, 'garbage');
  assert.equal(garbage.status, 'failed');
  assert.match((garbage as any).reason, /not a JSON result/);
  assert.match((garbage as any).reason, /139/);
});

test('pi: a stream cut off before agent_end is failed, with the session id in the reason', async () => {
  const o = await start(pi, 'partial');
  assert.equal(o.status, 'failed');
  assert.match((o as any).reason, /agent_end/);
});

test('pi: an error turn fails with pi\'s errorMessage, not as a missing claim block (04-f)', async () => {
  assert.deepEqual(await start(pi, 'error-turn'), { status: 'failed', reason: 'pi: OAuth refresh failed for openai: OpenAI OAuth token request failed (400): {' });
  assert.deepEqual(await start(pi, 'error-turn-bare'), { status: 'failed', reason: 'pi: run ended with stopReason error' });
});

test('output past maxOutputBytes is failed with the cap in the reason, and never reaches the controller as a claim', async () => {
  const adapter = cliAdapter({ ...claude, command: process.execPath, args: [join(import.meta.dirname, 'fixtures', 'flood.ts')] }, { ...offline, maxOutputBytes: 65536, graceMs: 300 });
  const store = fresh();
  const c = await execute(store, 'c1', adapter, { role: 'developer', prompt: '', cwd: dir }, { deadlineMs: 10_000, base: 'B1', runsDir: dir });
  assert.equal(c.stage, 'ESCALATED');
  assert.match(c.escalation ?? '', /65536 bytes/);
  store.close();
});

test('through execute: a fixture claude run moves DEVELOPING to VERIFYING with the head from the block', async () => {
  const store = fresh();
  const c = await execute(store, 'c1', cliAdapter(fake(claude, 'ping'), offline), { role: 'developer', prompt: 'ping', cwd: dir }, { deadlineMs: 10_000, base: 'B1', runsDir: dir });
  assert.equal(c.stage, 'VERIFYING');
  assert.equal(c.candidate?.head, 'H1');
  assert.deepEqual(c, store.load('c1'));
  store.close();
});

test('cgroup isolation is the default and refuses at construction when systemd-run --user is unavailable', () => {
  const path = process.env.PATH;
  process.env.PATH = dir;
  try {
    assert.throws(() => cliAdapter(claude), /systemd-run/);
  } finally {
    process.env.PATH = path;
  }
});

const hasUserSystemd = spawnSync('systemd-run', ['--user', '--scope', '-q', '--', 'true']).status === 0;

test('cgroup isolation: the deadline through execute kills a setsid grandchild of the runtime', async (t) => {
  if (!hasUserSystemd) return void t.skip('no user systemd');
  const marker = join(dir, 'execute-escape-marker.txt');
  const adapter = cliAdapter({ ...claude, command: process.execPath, args: [join(import.meta.dirname, 'fixtures', 'escape.ts'), marker] }, { graceMs: 300 });
  const store = fresh();
  const c = await execute(store, 'c1', adapter, { role: 'developer', prompt: '', cwd: dir }, { deadlineMs: 500, base: 'B1', runsDir: dir });
  assert.equal(c.stage, 'ESCALATED');
  assert.match(c.escalation ?? '', /timeout/);
  await new Promise((res) => setTimeout(res, 3000));
  assert.equal(existsSync(marker), false, 'grandchild outlived the deadline');
  store.close();
});

test('cgroup isolation: the fixture runs under a scope and a run through execute still completes', async (t) => {
  if (!hasUserSystemd) return void t.skip('no user systemd');
  const store = fresh();
  const c = await execute(store, 'c1', cliAdapter(fake(pi, 'ping')), { role: 'developer', prompt: 'ping', cwd: dir }, { deadlineMs: 10_000, base: 'B1', runsDir: dir });
  assert.equal(c.stage, 'VERIFYING');
  store.close();
});

// Live: four paid runs, each bounded by the controller's deadline.
const CLAIM_PROMPT = 'Reply with exactly the following and nothing else, including the fence:\n```json\n{"head":"H1","artifacts":["result.json"]}\n```';
for (const spec of [claude, pi]) {
  test(`live ${spec.name}: a real ping through execute reaches VERIFYING with the claim from the block`, async (t) => {
    if (!LIVE) return void t.skip('RUNTIME_SPIKE is not set');
    const store = fresh();
    const c = await execute(store, 'c1', cliAdapter(spec), { role: 'developer', prompt: CLAIM_PROMPT, cwd: dir }, { deadlineMs: 60_000, base: 'B1', runsDir: dir });
    t.diagnostic(`${spec.name} live: ${c.stage} ${c.escalation ?? ''}`);
    assert.equal(c.stage, 'VERIFYING');
    assert.equal(c.candidate?.head, 'H1');
    store.close();
  });

  test(`live ${spec.name}: a bad model escalates with the model named`, async (t) => {
    if (!LIVE) return void t.skip('RUNTIME_SPIKE is not set');
    const store = fresh();
    const adapter = cliAdapter({ ...spec, args: [...spec.args, '--model', 'no-such-model-xyz'] });
    const c = await execute(store, 'c1', adapter, { role: 'developer', prompt: CLAIM_PROMPT, cwd: dir }, { deadlineMs: 60_000, base: 'B1', runsDir: dir });
    assert.equal(c.stage, 'ESCALATED');
    assert.match(c.escalation ?? '', /no-such-model-xyz/);
    store.close();
  });
}

// Ticket 04-e: the 04-d adversarial findings.
for (const spec of [claude, pi]) {
  test(`${spec.name}: an unclosed fence followed by 100 000 blank lines is rejected in linear time`, async () => {
    const reply = 'Here is the claim:\n```json\n' + ' \n'.repeat(100_000) + 'oops';
    // The parser alone, against the done-when bound; the fixture spawn below proves the same
    // path through start().
    const stdout = spec.name === 'claude'
      ? JSON.stringify({ type: 'result', is_error: false, result: reply })
      : [{ type: 'session', id: 's' }, { type: 'turn_end', message: { content: [{ type: 'text', text: reply }] } }, { type: 'agent_end' }].map((e) => JSON.stringify(e)).join('\n');
    const started = Date.now();
    const direct = spec.parse(stdout, '', 0);
    const took = Date.now() - started;
    assert.deepEqual(direct, { status: 'failed', reason: 'no claim block in reply' });
    assert.ok(took < 200, `parse took ${took}ms`);
    const o = await start(spec, 'echo-prompt', reply);
    assert.deepEqual(o, { status: 'failed', reason: 'no claim block in reply' });
    const closed = await start(spec, 'echo-prompt', '```json\n' + ' \n'.repeat(100_000) + '{"head":"H9","artifacts":[]}\n```');
    assert.deepEqual((closed as any).claim, { head: 'H9', artifacts: [] });
  });

  test(`${spec.name}: fences with no newline after the tag or before the closer are accepted`, async () => {
    // The last variant is a closed block followed by a fence the model never closed.
    for (const reply of ['```json{"head":"H3","artifacts":[]}```', 'ok\n```json\n{"head":"H3","artifacts":[]}```\n', '```json {"head":"H3","artifacts":[]}\n```', '```json\n{"head":"H3","artifacts":[]}\n```\nand also\n```json\n{"head":']) {
      assert.deepEqual((await start(spec, 'echo-prompt', reply) as any).claim, { head: 'H3', artifacts: [] }, JSON.stringify(reply));
    }
  });
}

test('a run ID that is not a valid unit-name fragment is failed before anything is spawned under cgroup isolation', async (t) => {
  if (!hasUserSystemd) return void t.skip('no user systemd');
  const marker = join(dir, 'bad-unit-marker.txt');
  const adapter = cliAdapter({ ...claude, command: process.execPath, args: ['-e', `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`] });
  // A name ending in a unit type is kept as is by systemd, not given `.scope`, so cgroup.kill would miss it (04-e adversarial).
  for (const runId of ['r 1', 'é', 'a/b', 'x'.repeat(201), 'x.scope', 'x.service', 'x.slice']) {
    const o = await adapter.start({ ...req(), runId }, new AbortController().signal);
    assert.equal(o.status, 'failed', runId);
    assert.match((o as any).reason, /run ID .* unit name/, runId);
  }
  assert.equal(existsSync(marker), false, 'a child was spawned for an invalid run ID');
});

test('a reason cut at 1 KB is well-formed even when the cut lands inside a surrogate pair', async () => {
  // claude's result text, some ASCII then astral characters, lands as the is_error reason with a
  // prefix of unknown length; two adjacent ASCII lengths guarantee one cut splits a pair.
  for (const ascii of [900, 901]) {
    const reply = 'a'.repeat(ascii) + '\u{1F600}'.repeat(200);
    const adapter = cliAdapter({ ...claude, command: process.execPath, args: ['-e', `process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: ${JSON.stringify(reply)} }))`] }, offline);
    const o = await adapter.start(req(), new AbortController().signal);
    assert.equal(o.status, 'failed');
    assert.ok((o as any).reason.isWellFormed(), `reason has a lone surrogate at ascii=${ascii}`);
    assert.ok((o as any).reason.length <= 1024);
  }
});

// Ticket 08-c: a runtime inside the job's sandbox (A-038). The fixture stands in for the CLI;
// HOME is pointed at a scratch home so the config binds are the test's, not the owner's.
test('sandboxed adapter: writes its cwd and its own /tmp only; read config is read-only, overlay config is dropped; the per-run /tmp is removed', async () => {
  const root = mkdtempSync('/var/tmp/software_factory/sf-cli-sandbox-');
  const home = join(root, 'home');
  const runs = join(root, 'runs');
  const cwd = join(runs, 'cycle');
  mkdirSync(join(home, '.ro'), { recursive: true });
  mkdirSync(join(home, '.ov'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(home, '.ro', 'config'), 'ro\n');
  writeFileSync(join(home, '.ov', 'config'), 'ov\n');
  const probe = join(import.meta.dirname, 'fixtures', 'sandbox-probe.ts');
  const targets = { cwd: join(cwd, 'f'), tmp: '/tmp/sf-probe', ro: join(home, '.ro', 'config'), ov: join(home, '.ov', 'config'), home: join(home, 'f'), runs: join(runs, 'sibling'), varTmp: '/var/tmp/sf-cli-sandbox-escape' };
  const spec: CliSpec = { ...claude, command: process.execPath, args: [probe, `read:ro=${targets.ro}`, ...Object.entries(targets).map(([k, v]) => `${k}=${v}`)], config: { read: ['.ro'], overlay: ['.ov'] } };
  // Outside the scratch root: a run that escaped (or a red run with no sandbox) leaves them on the host.
  const outside = [targets.tmp, targets.varTmp];
  for (const f of outside) rmSync(f, { force: true });
  const was = process.env.HOME;
  process.env.HOME = home;
  try {
    const adapter = cliAdapter(spec, { ...offline, sandbox: { backend: 'bwrap', read: [dirname(dirname(realpathSync(process.execPath))), import.meta.dirname] } });
    const o = await adapter.start({ runId: 'r-sandboxed', role: 'developer', prompt: '', cwd }, new AbortController().signal);
    assert.equal(o.status, 'completed', JSON.stringify(o));
    const r = (o as { claim: Record<string, string> }).claim;
    assert.equal(r.HOME, home);
    assert.equal(r['read:ro'], 'ro\n', 'the read config is bound');
    assert.equal(r.cwd, 'ok');
    assert.equal(r.tmp, 'ok');
    assert.equal(r.ov, 'ok');
    for (const k of ['ro', 'home', 'runs', 'varTmp']) assert.notEqual(r[k], 'ok', k);
    assert.equal(readFileSync(targets.ro, 'utf8'), 'ro\n');
    assert.equal(readFileSync(targets.ov, 'utf8'), 'ov\n');
    assert.ok(!existsSync(targets.home) && !existsSync(targets.runs) && !existsSync(targets.varTmp) && !existsSync(targets.tmp));
    assert.ok(existsSync(targets.cwd));
    // The run's /tmp lived beside its cwd and is gone after the run.
    assert.deepEqual(readdirSync(runs), ['cycle']);
  } finally {
    process.env.HOME = was;
    rmSync(root, { recursive: true, force: true });
    for (const f of outside) rmSync(f, { force: true });
  }
});

test('sandboxed adapter: a binary reached through a symlink outside the bound roots still runs, by its resolved path', async () => {
  const root = mkdtempSync('/var/tmp/software_factory/sf-cli-sandbox-');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node-link'));
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const adapter = cliAdapter({ ...fake(claude, 'ping'), command: 'node-link', config: { read: [], overlay: [] } }, { ...offline, sandbox: { backend: 'bwrap', read: [import.meta.dirname] } });
    // A cwd inside the scratch root, so the run's /tmp (beside the cwd) is inside it too.
    const cwd = join(root, 'cwd');
    mkdirSync(cwd);
    const o = await adapter.start({ ...req(), cwd }, new AbortController().signal);
    assert.equal(o.status, 'completed', JSON.stringify(o));
  } finally {
    process.env.PATH = path;
    rmSync(root, { recursive: true, force: true });
  }
});

// 08-g: the path a write config names keeps its writes through the overlay; a missing one is not created on the host.
test('sandboxed adapter: write config outlives the run, the rest of the overlay does not, and a missing write path stays missing', async () => {
  const root = mkdtempSync('/var/tmp/software_factory/sf-cli-sandbox-');
  const home = join(root, 'home');
  const cwd = join(root, 'runs', 'cycle');
  mkdirSync(join(home, '.ov'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(home, '.ov', 'auth.json'), 'old\n');
  writeFileSync(join(home, '.ov', 'config'), 'ov\n');
  const probe = join(import.meta.dirname, 'fixtures', 'sandbox-probe.ts');
  const targets = { auth: join(home, '.ov', 'auth.json'), ov: join(home, '.ov', 'config'), missing: join(home, '.ov', 'missing.json') };
  const spec: CliSpec = { ...claude, command: process.execPath, args: [probe, ...Object.entries(targets).map(([k, v]) => `${k}=${v}`)], config: { read: [], overlay: ['.ov'], write: ['.ov/auth.json', '.ov/missing.json'] } };
  const was = process.env.HOME;
  process.env.HOME = home;
  try {
    const adapter = cliAdapter(spec, { ...offline, sandbox: { backend: 'bwrap', read: [dirname(dirname(realpathSync(process.execPath))), import.meta.dirname] } });
    // A reviewer: the write config does not depend on the run writing its cwd.
    const o = await adapter.start({ runId: 'r-write-config', role: 'standard_reviewer', prompt: '', cwd }, new AbortController().signal);
    assert.equal(o.status, 'completed', JSON.stringify(o));
    const r = (o as { claim: Record<string, string> }).claim;
    for (const k of ['auth', 'ov', 'missing']) assert.equal(r[k], 'ok', k);
    assert.equal(readFileSync(targets.auth, 'utf8'), 'x\n');
    assert.equal(readFileSync(targets.ov, 'utf8'), 'ov\n');
    assert.ok(!existsSync(targets.missing));
  } finally {
    process.env.HOME = was;
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime specs bind claude config read-only and overlay pi config, with pi auth.json writable (08-g)', () => {
  assert.deepEqual(claude.config, { read: ['.claude', '.claude.json'], overlay: [] });
  assert.deepEqual(pi.config, { read: [], overlay: ['.pi'], write: ['.pi/agent/auth.json'] });
});

test('a sandbox that cannot start refuses at construction, naming none, before any run', () => {
  const path = process.env.PATH;
  process.env.PATH = join(dir, 'empty-path');
  try {
    assert.throws(() => cliAdapter(fake(claude, 'ping'), { ...offline, sandbox: { backend: 'bwrap' } }), /"none"/);
    cliAdapter(fake(claude, 'ping'), { ...offline, sandbox: { backend: 'none' } });
  } finally {
    process.env.PATH = path;
  }
});

// Ticket 08-d: a reviewer reads its cwd (the verify checkout) and writes only its own /tmp.
test('sandboxed adapter: a reviewer run cannot write its cwd; a developer run can (08-d)', async () => {
  const root = mkdtempSync('/var/tmp/software_factory/sf-cli-sandbox-');
  const cwd = join(root, 'checkout');
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'README.md'), 'tracked\n');
  const probe = join(import.meta.dirname, 'fixtures', 'sandbox-probe.ts');
  // Outside the scratch root: an escaped run (or a red run with no sandbox) leaves them on the host.
  const outside = { home: join(process.env.HOME!, `sf-review-escape-${process.pid}`), varTmp: '/var/tmp/sf-review-escape' };
  for (const f of Object.values(outside)) rmSync(f, { force: true });
  const targets = { cwd: join(cwd, 'README.md'), tmp: '/tmp/x', runs: join(root, 'sibling'), ...outside };
  const spec: CliSpec = { ...claude, command: process.execPath, args: [probe, `read:readme=${join(cwd, 'README.md')}`, ...Object.entries(targets).map(([k, v]) => `${k}=${v}`)], config: { read: [], overlay: [] } };
  const adapter = cliAdapter(spec, { ...offline, sandbox: { backend: 'bwrap', read: [dirname(dirname(realpathSync(process.execPath))), import.meta.dirname] } });
  try {
    for (const [role, writes] of [['standard_reviewer', false], ['adversarial_reviewer', false], ['developer', true]] as const) {
      writeFileSync(join(cwd, 'README.md'), 'tracked\n');
      const o = await adapter.start({ runId: `r-${role}`, role, prompt: '', cwd }, new AbortController().signal);
      assert.equal(o.status, 'completed', JSON.stringify(o));
      const r = (o as { claim: Record<string, string> }).claim;
      assert.equal(r['read:readme'], 'tracked\n', role);
      assert.equal(r.cwd === 'ok', writes, role);
      assert.equal(readFileSync(join(cwd, 'README.md'), 'utf8'), writes ? 'x\n' : 'tracked\n', role);
      assert.equal(r.tmp, 'ok', role);
      for (const k of ['runs', 'home', 'varTmp'] as const) {
        assert.notEqual(r[k], 'ok', `${role} ${k}`);
        assert.ok(!existsSync(targets[k]), `${role} ${k}`);
      }
    }
    assert.deepEqual(readdirSync(root), ['checkout']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    for (const f of Object.values(outside)) rmSync(f, { force: true });
  }
});

test('a directory chain past PATH_MAX left in the run\'s /tmp does not turn a completed run into a throw (08-d, 08-c adversarial minor)', async () => {
  const root = mkdtempSync('/var/tmp/software_factory/sf-cli-sandbox-');
  const cwd = join(root, 'cwd');
  mkdirSync(cwd);
  const reply = JSON.stringify({ type: 'result', is_error: false, session_id: 's', result: '```json\n{"head":"H1"}\n```' });
  const script = `p=$(printf "d/%.0s" $(seq 1100)); cd /tmp && mkdir -p "$p" && cd "$p" && mkdir -p "$p"; chmod 000 /tmp/d; echo '${reply}'`;
  const adapter = cliAdapter({ ...claude, command: 'sh', args: ['-c', script], config: { read: [], overlay: [] } }, { ...offline, sandbox: { backend: 'bwrap' } });
  try {
    const o = await adapter.start({ runId: 'r-deep', role: 'developer', prompt: '', cwd }, new AbortController().signal);
    assert.deepEqual(o, { status: 'completed', claim: { head: 'H1' }, sessionId: 's' });
    assert.deepEqual(readdirSync(root), ['cwd'], 'the run\'s /tmp is removed');
  } finally {
    spawnSync('chmod', ['-R', 'u+rwX', root]);
    spawnSync('rm', ['-rf', root]);
  }
});

// Ticket 11-e: the controller names a run folder per run; the adapter's run lives in it.
test('through execute: a run leaves its stdin, stdout, stderr and exit in <runsDir>/runs/<runId>/', async () => {
  const store = fresh();
  const runsDir = join(dir, 'execute-runs');
  const c = await execute(store, 'c1', cliAdapter(fake(claude, 'ping'), offline), { role: 'developer', prompt: 'ping', cwd: dir }, { deadlineMs: 10_000, base: 'B1', runsDir });
  assert.equal(c.stage, 'VERIFYING');
  const runDir = join(runsDir, 'runs', c.runs[0]!.runId);
  assert.equal(readFileSync(join(runDir, 'stdin'), 'utf8'), 'ping');
  assert.match(readFileSync(join(runDir, 'stdout'), 'utf8'), /"session_id"/);
  assert.equal(readFileSync(join(runDir, 'exit'), 'utf8'), '0\n');
  store.close();
});

test('an extension runtime\'s request JSON, kept as the run\'s stdin, carries neither the run folder nor the deadline', async () => {
  const runDir = join(dir, 'runs', 'ext-request');
  await cliAdapter(extensionSpec('ext', join(import.meta.dirname, 'fixtures', 'ext-runtime.ts')), offline).start({ ...req(), runDir, deadlineMs: 1000 }, new AbortController().signal);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(runDir, 'stdin'), 'utf8'))).sort(), ['cwd', 'prompt', 'role', 'runId']);
});

test('sandboxed adapter: a developer run cannot write its own run folder (11-e)', async () => {
  const root = mkdtempSync('/var/tmp/software_factory/sf-cli-sandbox-');
  const cwd = join(root, 'cycle');
  mkdirSync(cwd);
  const runDir = join(root, 'runs', 'r-dev');
  const probe = join(import.meta.dirname, 'fixtures', 'sandbox-probe.ts');
  const targets = { exit: join(runDir, 'exit'), stdout: join(runDir, 'stdout'), other: join(runDir, 'other') };
  const spec: CliSpec = { ...claude, command: process.execPath, args: [probe, ...Object.entries(targets).map(([k, v]) => `${k}=${v}`)], config: { read: [], overlay: [] } };
  const adapter = cliAdapter(spec, { ...offline, sandbox: { backend: 'bwrap', read: [dirname(dirname(realpathSync(process.execPath))), import.meta.dirname] } });
  try {
    const o = await adapter.start({ runId: 'r-dev', role: 'developer', prompt: '', cwd, runDir }, new AbortController().signal);
    assert.equal(o.status, 'completed', JSON.stringify(o));
    const r = (o as { claim: Record<string, string> }).claim;
    for (const k of Object.keys(targets)) assert.notEqual(r[k], 'ok', k);
    assert.equal(readFileSync(join(runDir, 'exit'), 'utf8'), '0\n');
    assert.equal(existsSync(targets.other), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a cgroup-isolation refusal from a login session\'s scope names the systemd-run --user --scope workaround (11-d2 parked)', () => {
  assert.match(scopeHint('0::/user.slice/user-1000.slice/session-4.scope'), /systemd-run --user --scope/);
  assert.equal(scopeHint('0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-foot.scope'), '');
});

test('cgroup isolation: execute\'s deadline reaches the scope as RuntimeMaxSec, deadline plus grace, so a run with no controller still stops (11-e, standard 1)', async (t) => {
  if (!hasUserSystemd) return void t.skip('no user systemd');
  const runsDir = join(dir, 'deadline-runs');
  const adapter = cliAdapter({ ...claude, command: process.execPath, args: ['-e', 'setTimeout(() => {}, 1500)'] }, { graceMs: 500 });
  const store = fresh();
  const running = execute(store, 'c1', adapter, { role: 'developer', prompt: '', cwd: dir }, { deadlineMs: 3000, base: 'B1', runsDir });
  let limit = '';
  for (const end = Date.now() + 1500; Date.now() < end && !limit; await new Promise((res) => setTimeout(res, 50))) {
    const runId = existsSync(join(runsDir, 'runs')) ? readdirSync(join(runsDir, 'runs'))[0] : undefined;
    if (!runId) continue;
    // The run folder exists before systemd registers the scope, and `show` on a unit not yet
    // loaded answers the default, `infinity`, with LoadState=not-found (11-e2).
    const show = spawnSync('systemctl', ['--user', 'show', `sf-${runId}.scope`, '-p', 'LoadState', '-p', 'RuntimeMaxUSec'], { encoding: 'utf8' }).stdout;
    if (/^LoadState=loaded$/m.test(show)) limit = /^RuntimeMaxUSec=(.*)$/m.exec(show)![1];
  }
  await running;
  store.close();
  assert.equal(limit, '3.500000s');
});

test('a checkScopes refusal names the systemd-run --user --scope workaround when this process is in a login session\'s scope (11-e, standard 1)', () => {
  const cgroup = join(dir, 'session-cgroup');
  writeFileSync(cgroup, '0::/user.slice/user-1000.slice/session-4.scope\n');
  const path = process.env.PATH;
  // No systemd-run on PATH, so the probe fails as it would from an SSH shell.
  process.env.PATH = join(dir, 'empty-path');
  try {
    assert.throws(() => checkScopes(cgroup), /login session's scope.*systemd-run --user --scope --quiet/);
  } finally {
    process.env.PATH = path;
  }
});

test('sandboxed adapter: a run cannot rewrite its kept prompt through /proc/self/fd/0, directly or after an fchmod of fd 0 (11-e, standards 2 and 3)', async () => {
  const root = mkdtempSync('/var/tmp/software_factory/sf-cli-sandbox-');
  const cwd = join(root, 'checkout');
  mkdirSync(cwd);
  const runDir = join(root, 'runs', 'r-rev');
  const probe = join(import.meta.dirname, 'fixtures', 'sandbox-probe.ts');
  const spec: CliSpec = { ...claude, command: process.execPath, args: [probe, 'stdin=/proc/self/fd/0', 'fchmod:stdin=/proc/self/fd/0'], config: { read: [], overlay: [] } };
  const adapter = cliAdapter(spec, { ...offline, sandbox: { backend: 'bwrap', read: [dirname(dirname(realpathSync(process.execPath))), import.meta.dirname] } });
  try {
    for (const role of ['standard_reviewer', 'developer'] as const) {
      const dir = `${runDir}-${role}`;
      const o = await adapter.start({ runId: `r-${role}`, role, prompt: 'THE REAL PROMPT', cwd, runDir: dir }, new AbortController().signal);
      assert.equal(o.status, 'completed', JSON.stringify(o));
      // Both writes ran; whether they reached anything is for the kept file to say. A pipe on fd 0
      // takes the write and goes nowhere, so the probe's own report is not the evidence.
      const claim = (o as { claim: Record<string, string> }).claim;
      assert.ok('stdin' in claim && 'fchmod:stdin' in claim, JSON.stringify(claim));
      assert.equal(readFileSync(join(dir, 'stdin'), 'utf8'), 'THE REAL PROMPT', role);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
