// Ticket 10-a: the runtime contract kit (A-074). A user calls `runtimeKit` from their own test
// file, run with `node --test`, to check an adapter keeps the contract the controller relies on.
// Import it by path: the factory is not a package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, RunOutcome } from '../adapter.ts';
import { defaultWorkflow, type StageDef } from '../lifecycle.ts';
import { reviewPrompt } from '../prompt.ts';

/** How long an aborted run may take to settle: cliAdapter's default grace before SIGKILL, and some. */
const SETTLE_MS = 10_000;

/** Registers node:test cases for the adapter `makeAdapter` builds. Call it once per runtime. */
export function runtimeKit(name: string, makeAdapter: () => Adapter | Promise<Adapter>): void {
  // /var/tmp, not os.tmpdir(): /tmp is often a RAM tmpfs, and a sandboxed run's /tmp goes beside its cwd.
  mkdirSync('/var/tmp/software_factory', { recursive: true });
  const dir = mkdtempSync('/var/tmp/software_factory/sf-runtime-kit-');
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  // A cwd of its own per run, inside the kit's directory: cliAdapter puts a sandboxed run's /tmp beside it.
  // A git repository with one commit, as the controller gives a developer and a reviewer.
  const cwd = () => {
    const d = join(dir, `run${n++}`, 'work');
    mkdirSync(d, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: d });
    execFileSync('git', ['-c', 'user.name=kit', '-c', 'user.email=kit@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'kit'], { cwd: d });
    return d;
  };

  test(`${name}: the adapter has a non-empty name`, async () => {
    const a = await makeAdapter();
    assert.equal(typeof a.name, 'string');
    assert.ok(a.name.length > 0);
  });

  // The reviewer gets the role and prompt the controller sends, so a runtime that tells roles
  // apart takes its reviewer path here.
  const reviewer = defaultWorkflow.stages.STANDARD_REVIEW as Extract<StageDef, { kind: 'agent' }>;
  const cases: Record<string, (head: string) => string> = {
    developer: () => 'You are the developer for the runtime kit.',
    [reviewer.role]: (head) => reviewPrompt(reviewer.roleText, {
      head, base: head, ticket: 'Review the runtime kit commit.', instructions: [], checks: [], paths: '', commits: '', diff: '', evidence: [],
    }).text,
  };
  for (const [role, prompt] of Object.entries(cases)) {
    test(`${name}: a ${role} request settles, without rejecting, to a plain RunOutcome`, async (t) => {
      const a = await makeAdapter();
      const work = cwd();
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).trim();
      const o = await a.start({ runId: `kit-${role}`, role, prompt: prompt(head), cwd: work }, new AbortController().signal);
      assertOutcome(o);
      // Any status keeps the contract; the diagnostic tells the user which path their runtime took.
      // Keys, not the claim: a real runtime's claim can run to pages.
      const claim = o.status === 'completed' && o.claim !== null && typeof o.claim === 'object' ? `, claim keys ${Object.keys(o.claim).join(', ')}` : '';
      t.diagnostic(`outcome ${o.status}${claim}`);
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
  // Stringify first: it throws on a cycle, which `defined` would walk forever.
  const read = JSON.parse(JSON.stringify(o));
  assert.deepEqual(read, defined(o), 'the outcome is not plain data');
  // The union is checked on what the controller reads: `claim: undefined` passes `'claim' in` on
  // the adapter's object, but the round trip drops it, and the controller sees no claim.
  const v = read as Record<string, unknown>;
  const ok = v?.status === 'completed' ? 'claim' in v && (v.sessionId === undefined || typeof v.sessionId === 'string')
    : v?.status === 'failed' ? typeof v.reason === 'string' && v.reason.length > 0
    : v?.status === 'cancelled';
  assert.ok(ok, `not a RunOutcome: ${JSON.stringify(o)}`);
}

// A property set to undefined reads as a missing one, so the round trip dropping it loses nothing;
// claude's parse returns `sessionId: undefined`. Only plain objects, with a null prototype or Object's,
// are copied, as ordinary objects, which is what the round trip makes of them. A Date or a class
// instance stays as is and still fails the comparison, as does undefined inside an array (it becomes null).
function defined(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(defined);
  if (v === null || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return v;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, defined(x)]));
}
