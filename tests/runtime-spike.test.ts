// Ticket 03-a: the gated half. Runs the real CLIs only under RUNTIME_SPIKE=1 and skips, with a
// reason, when a binary is absent or not logged in. Each test prints the facts it observed as
// diagnostics; docs/work/03-a-findings.md is written from that output.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnRuntime, type RunResult } from '../src/runtime/spawn.ts';

const LIVE = process.env.RUNTIME_SPIKE === '1';
const PING = 'Reply with the single word pong and nothing else.';

interface Runtime {
  name: string;
  command: string;
  /** Flags for one non-interactive, JSON, tool-less turn. */
  args(extra?: string[]): string[];
  /** Pull the result text and session identifier out of stdout, or throw if the shape is wrong. */
  parse(stdout: string): { text: string; session: string };
  /** Does this stderr/stdout say "not logged in"? Used to skip rather than fail. */
  unauthenticated(r: RunResult): boolean;
}

const runtimes: Runtime[] = [
  {
    name: 'claude',
    command: 'claude',
    args: (extra = []) => ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', ...extra],
    parse(stdout) {
      const o = JSON.parse(stdout);
      assert.equal(o.type, 'result');
      assert.equal(typeof o.result, 'string');
      assert.equal(typeof o.session_id, 'string');
      return { text: o.result, session: o.session_id };
    },
    unauthenticated: (r) => /not logged in/i.test(r.stdout + r.stderr),
  },
  {
    name: 'pi',
    command: 'pi',
    args: (extra = []) => ['-p', '--mode', 'json', '--no-tools', '--no-session', ...extra],
    parse(stdout) {
      // JSON Lines: one event per line. The first is the session header; the assistant's
      // text is in the final turn_end event.
      const events = stdout.trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(events[0].type, 'session');
      assert.equal(typeof events[0].id, 'string');
      const turn = events.findLast((e) => e.type === 'turn_end');
      assert.ok(turn, 'no turn_end event');
      const text = turn.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
      return { text, session: events[0].id };
    },
    unauthenticated: (r) => /no api key found|not logged in/i.test(r.stdout + r.stderr),
  },
];

const dir = mkdtempSync(join(tmpdir(), 'sf-spike-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const probes = new Map<string, Promise<RunResult>>();
/** One ping per runtime, shared by every test, so the skip reason is decided once. */
function probe(rt: Runtime) {
  let p = probes.get(rt.name);
  if (!p) {
    p = spawnRuntime({ command: rt.command, args: rt.args(), prompt: PING, cwd: dir });
    probes.set(rt.name, p);
  }
  return p;
}

/** Returns the ping result, or skips the test with the reason and returns undefined. */
async function live(t: TestContext, rt: Runtime): Promise<RunResult | undefined> {
  if (!LIVE) return void t.skip('RUNTIME_SPIKE is not set');
  const r = await probe(rt);
  if (r.status === 'failed') return void t.skip(`${rt.name} binary absent: ${r.stderr.trim()}`);
  if (rt.unauthenticated(r)) return void t.skip(`${rt.name} not authenticated: ${(r.stderr || r.stdout).trim().slice(0, 120)}`);
  return r;
}

/** The fields the findings document cites for a failed run, parsed rather than a byte prefix. */
function errorFields(rt: Runtime, stdout: string): string {
  if (stdout.trim() === '') return '(empty)';
  const first = JSON.parse(stdout.trim().split('\n')[0]);
  if (rt.name === 'claude') {
    const { type, subtype, is_error, terminal_reason, api_error_status, session_id, result } = first;
    return JSON.stringify({ type, subtype, is_error, terminal_reason, api_error_status, session_id, result });
  }
  return `${stdout.trim().split('\n').length} line(s), first: ${JSON.stringify(first)}`;
}

const summary = (r: RunResult) =>
  `status=${r.status} exit=${r.exitCode} signal=${r.signal} wall=${r.wallMs}ms stdout=${r.stdout.length}B stderr=${r.stderr.length}B`;

for (const rt of runtimes) {
  test(`${rt.name}: JSON output has a result text and a session id`, { timeout: 120_000 }, async (t) => {
    const r = await live(t, rt);
    if (!r) return;
    assert.equal(r.exitCode, 0, summary(r) + '\n' + r.stderr);
    const { text, session } = rt.parse(r.stdout);
    assert.match(text, /pong/i);
    assert.ok(session.length > 0);
    const v = await spawnRuntime({ command: rt.command, args: ['--version'], prompt: '', cwd: dir });
    t.diagnostic(`${rt.name} --version: ${v.stdout.trim()}`);
    t.diagnostic(`${rt.name} flags: ${rt.args().join(' ')}`);
    t.diagnostic(`${rt.name} ping: ${summary(r)} session=${session} text=${JSON.stringify(text)}`);
    t.diagnostic(`${rt.name} stdout keys: ${rt.name === 'claude'
      ? Object.keys(JSON.parse(r.stdout)).join(',')
      : [...new Set(r.stdout.trim().split('\n').map((l) => JSON.parse(l).type))].join(',')}`);
  });

  test(`${rt.name}: with tools disabled, asking for a file does not create it`, { timeout: 120_000 }, async (t) => {
    if (!(await live(t, rt))) return;
    const cwd = mkdtempSync(join(dir, `${rt.name}-deny-`));
    const marker = join(cwd, 'marker.txt');
    const run = spawnRuntime({
      command: rt.command,
      args: rt.args(),
      prompt: `Create a file named marker.txt in the current working directory containing the word hello. Do it now without asking.`,
      cwd,
    });
    // The owner's first run saw claude take over 120 s on this prompt (4 s the time before).
    // A denied run that will not finish is still a denied run: cap it, cancel, and record that.
    const cap = setTimeout(() => run.cancel(), 60_000);
    const r = await run;
    clearTimeout(cap);
    t.diagnostic(`${rt.name} deny: ${summary(r)} created=${existsSync(marker)}`);
    assert.equal(existsSync(marker), false, 'marker file was created');
    if (r.status === 'cancelled') {
      t.diagnostic(`${rt.name} deny: did not finish within 60 s; cancelled, nothing created`);
      return;
    }
    assert.equal(r.exitCode, 0, r.stderr);
    t.diagnostic(`${rt.name} deny reply: ${JSON.stringify(rt.parse(r.stdout).text.slice(0, 200))}`);
  });

  test(`${rt.name}: cancel mid-flight reports cancelled, not exit 0`, { timeout: 120_000 }, async (t) => {
    if (!(await live(t, rt))) return;
    const run = spawnRuntime({
      command: rt.command,
      args: rt.args(),
      prompt: 'Write the numbers from 1 to 3000, one per line, with no other text.',
      cwd: dir,
      graceMs: 2000,
    });
    // claude -p prints nothing until the turn ends, so "first byte" is not a usable ready signal
    // for it. Three seconds is past process start-up for both and well before 3000 lines finish.
    await new Promise((res) => setTimeout(res, 3000));
    const started = Date.now();
    run.cancel();
    const r = await run;
    const took = Date.now() - started;
    t.diagnostic(`${rt.name} cancel: ${summary(r)} cancel-to-exit=${took}ms`);
    // `status` is the signal. The exit code is recorded above, not asserted: a CLI that flushes
    // and exits 0 on SIGTERM was still cancelled.
    assert.equal(r.status, 'cancelled');
    assert.ok(took < 2000 + 1000, `cancel took ${took}ms`);
  });

  test(`${rt.name}: a bad model name fails with a message`, { timeout: 120_000 }, async (t) => {
    if (!(await live(t, rt))) return;
    const r = await spawnRuntime({ command: rt.command, args: rt.args(['--model', 'no-such-model-xyz']), prompt: PING, cwd: dir });
    t.diagnostic(`${rt.name} bad model: ${summary(r)}`);
    t.diagnostic(`${rt.name} bad model stderr: ${JSON.stringify(r.stderr.trim().split('\n')[0] ?? '')}`);
    t.diagnostic(`${rt.name} bad model stdout: ${errorFields(rt, r.stdout)}`);
    assert.notEqual(r.exitCode, 0);
  });

  test(`${rt.name}: missing auth fails with a message`, { timeout: 120_000 }, async (t) => {
    if (!(await live(t, rt))) return;
    // An empty HOME hides the stored credentials; the env carries no API keys either.
    const home = mkdtempSync(join(dir, `${rt.name}-home-`));
    const r = await spawnRuntime({ command: rt.command, args: rt.args(), prompt: PING, cwd: dir, env: { PATH: process.env.PATH!, HOME: home } });
    t.diagnostic(`${rt.name} no auth: ${summary(r)}`);
    t.diagnostic(`${rt.name} no auth stderr: ${JSON.stringify(r.stderr.trim().split('\n')[0] ?? '')}`);
    t.diagnostic(`${rt.name} no auth stdout: ${errorFields(rt, r.stdout)}`);
    assert.notEqual(r.exitCode, 0);
    assert.ok(rt.unauthenticated(r), 'no auth message found');
  });
}
