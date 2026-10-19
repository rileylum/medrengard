// Ticket 10-a: the runtime contract kit (A-074). A user calls `runtimeKit` from their own test
// file, run with `node --test`, to check an adapter keeps the contract the controller relies on.
// Import it by path: the factory is not a package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Adapter, RunOutcome } from '../adapter.ts';

/** How long an aborted run may take to settle: cliAdapter's default grace before SIGKILL, and some. */
const SETTLE_MS = 10_000;

/** Registers node:test cases for the adapter `makeAdapter` builds. Call it once per runtime. */
export function runtimeKit(name: string, makeAdapter: () => Adapter | Promise<Adapter>): void {
  const dir = mkdtempSync(join(tmpdir(), 'sf-runtime-kit-'));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  // A cwd of its own per run, inside the kit's directory: cliAdapter puts a sandboxed run's /tmp beside it.
  const cwd = () => { const d = join(dir, `run${n++}`, 'work'); mkdirSync(d, { recursive: true }); return d; };

  test(`${name}: the adapter has a non-empty name`, async () => {
    const a = await makeAdapter();
    assert.equal(typeof a.name, 'string');
    assert.ok(a.name.length > 0);
  });

  for (const role of ['developer', 'reviewer']) {
    test(`${name}: a ${role} request settles, without rejecting, to a plain RunOutcome`, async () => {
      const a = await makeAdapter();
      const o = await a.start({ runId: `kit-${role}`, role, prompt: `You are the ${role} for the runtime kit.`, cwd: cwd() }, new AbortController().signal);
      assertOutcome(o);
    });
  }

  test(`${name}: an aborted run settles within ${SETTLE_MS / 1000} s`, async () => {
    const a = await makeAdapter();
    const ac = new AbortController();
    const run = a.start({ runId: 'kit-abort', role: 'developer', prompt: 'You are the developer for the runtime kit.', cwd: cwd() }, ac.signal);
    ac.abort();
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<'late'>((res) => { timer = setTimeout(() => res('late'), SETTLE_MS); });
    try {
      const o = await Promise.race([run, late]);
      assert.notEqual(o, 'late', `start did not settle within ${SETTLE_MS} ms of the abort`);
      assertOutcome(o as RunOutcome);
    } finally {
      clearTimeout(timer);
    }
  });
}

// The controller reads an outcome only after a JSON round trip and turns anything outside the
// union into a failed run; an adapter that relies on that has a bug the kit should name.
function assertOutcome(o: unknown): void {
  assert.deepEqual(JSON.parse(JSON.stringify(o)), o, 'the outcome is not plain data');
  const v = o as Record<string, unknown>;
  const ok = v?.status === 'completed' ? 'claim' in v && (v.sessionId === undefined || typeof v.sessionId === 'string')
    : v?.status === 'failed' ? typeof v.reason === 'string' && v.reason.length > 0
    : v?.status === 'cancelled';
  assert.ok(ok, `not a RunOutcome: ${JSON.stringify(o)}`);
}
