// Ticket 04-d: the claude and pi adapters over spawnRuntime, observed through start() and through
// execute() with store.load(). Offline against tests/fixtures/fake-cli.ts, which replays the
// shapes recorded in docs/work/03-a-findings.md; live against the real CLIs under RUNTIME_SPIKE=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunOutcome } from '../src/adapter.ts';
import { execute } from '../src/controller.ts';
import { claude, cliAdapter, pi, type CliSpec } from '../src/runtime/cli-adapter.ts';
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

test('output past maxOutputBytes is failed with the cap in the reason, and never reaches the controller as a claim', async () => {
  const adapter = cliAdapter({ ...claude, command: process.execPath, args: [join(import.meta.dirname, 'fixtures', 'flood.ts')] }, { ...offline, maxOutputBytes: 65536, graceMs: 300 });
  const store = fresh();
  const c = await execute(store, 'c1', adapter, { role: 'developer', prompt: '', cwd: dir }, { deadlineMs: 10_000, base: 'B1' });
  assert.equal(c.stage, 'ESCALATED');
  assert.match(c.escalation ?? '', /65536 bytes/);
  store.close();
});

test('through execute: a fixture claude run moves DEVELOPING to VERIFYING with the head from the block', async () => {
  const store = fresh();
  const c = await execute(store, 'c1', cliAdapter(fake(claude, 'ping'), offline), { role: 'developer', prompt: 'ping', cwd: dir }, { deadlineMs: 10_000, base: 'B1' });
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
  const c = await execute(store, 'c1', adapter, { role: 'developer', prompt: '', cwd: dir }, { deadlineMs: 500, base: 'B1' });
  assert.equal(c.stage, 'ESCALATED');
  assert.match(c.escalation ?? '', /timeout/);
  await new Promise((res) => setTimeout(res, 3000));
  assert.equal(existsSync(marker), false, 'grandchild outlived the deadline');
  store.close();
});

test('cgroup isolation: the fixture runs under a scope and a run through execute still completes', async (t) => {
  if (!hasUserSystemd) return void t.skip('no user systemd');
  const store = fresh();
  const c = await execute(store, 'c1', cliAdapter(fake(pi, 'ping')), { role: 'developer', prompt: 'ping', cwd: dir }, { deadlineMs: 10_000, base: 'B1' });
  assert.equal(c.stage, 'VERIFYING');
  store.close();
});

// Live: four paid runs, each bounded by the controller's deadline.
const CLAIM_PROMPT = 'Reply with exactly the following and nothing else, including the fence:\n```json\n{"head":"H1","artifacts":["result.json"]}\n```';
for (const spec of [claude, pi]) {
  test(`live ${spec.name}: a real ping through execute reaches VERIFYING with the claim from the block`, async (t) => {
    if (!LIVE) return void t.skip('RUNTIME_SPIKE is not set');
    const store = fresh();
    const c = await execute(store, 'c1', cliAdapter(spec), { role: 'developer', prompt: CLAIM_PROMPT, cwd: dir }, { deadlineMs: 60_000, base: 'B1' });
    t.diagnostic(`${spec.name} live: ${c.stage} ${c.escalation ?? ''}`);
    assert.equal(c.stage, 'VERIFYING');
    assert.equal(c.candidate?.head, 'H1');
    store.close();
  });

  test(`live ${spec.name}: a bad model escalates with the model named`, async (t) => {
    if (!LIVE) return void t.skip('RUNTIME_SPIKE is not set');
    const store = fresh();
    const adapter = cliAdapter({ ...spec, args: [...spec.args, '--model', 'no-such-model-xyz'] });
    const c = await execute(store, 'c1', adapter, { role: 'developer', prompt: CLAIM_PROMPT, cwd: dir }, { deadlineMs: 60_000, base: 'B1' });
    assert.equal(c.stage, 'ESCALATED');
    assert.match(c.escalation ?? '', /no-such-model-xyz/);
    store.close();
  });
}

// Ticket 04-e: the 04-d adversarial findings.
for (const spec of [claude, pi]) {
  test(`${spec.name}: an unclosed fence followed by 100 000 blank lines is rejected in linear time`, async () => {
    const started = Date.now();
    const o = await start(spec, 'echo-prompt', 'Here is the claim:\n```json\n' + ' \n'.repeat(100_000) + 'oops');
    const took = Date.now() - started;
    assert.deepEqual(o, { status: 'failed', reason: 'no claim block in reply' });
    assert.ok(took < 2000, `took ${took}ms including the fixture spawn`);
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
  for (const runId of ['r 1', 'é', 'a/b', 'x'.repeat(201)]) {
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
