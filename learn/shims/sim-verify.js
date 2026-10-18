// src/verify.ts for the simulator (mapped in by boot.js on sim.html). Same order as the real
// verify: name checks, find each check's binary with the real executables and reachable from
// src/sandbox.ts (so a command that is not installed is MISSING here too), run each, write the
// evidence files, add the tree check when the checkout is dirty, append one verification event.
// Only "run" is the reader's: they say how each check behaves.
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { checkDeadline } from '/src/controller.ts';
import { checkSandbox, executables, reachable } from '/src/sandbox.ts';
import { RUNS, world } from './world.js';

const NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
const TREE = 'tree';

export async function verify(store, cycleId, job, opts) {
  const checks = job.checks ?? [];
  const seen = new Set();
  for (const c of checks) {
    if (typeof c.name !== 'string' || !NAME.test(c.name)) throw new Error(`check name ${JSON.stringify(c.name)} is not a file stem`);
    if (c.name === TREE) throw new Error(`check name ${TREE} is reserved for the controller's own tracked-tree check`);
    if (seen.has(c.name)) throw new Error(`check name ${c.name} is declared twice`);
    seen.add(c.name);
  }
  checkDeadline(opts.deadlineMs);
  const sandbox = opts.sandbox ?? { backend: 'bwrap' };
  checkSandbox(sandbox);
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  if (cycle.stage !== 'VERIFYING' || !cycle.candidate) throw new Error(`verify on a cycle in ${cycle.stage}, expected VERIFYING`);
  const head = cycle.candidate.head;
  const runsDir = opts.runsDir ?? RUNS;
  const worktree = join(runsDir, `${cycleId}-verify`);
  const evidenceDir = join(runsDir, 'evidence', head);
  mkdirSync(worktree);
  mkdirSync(evidenceDir);

  const found = checks.map((check) => {
    const [command = ''] = check.command ?? [];
    const policy = { cwd: worktree, write: [worktree], read: [], network: false };
    const paths = executables(command, worktree);
    if (!paths.length) return { check, missing: `missing: ${command || '(empty command)'} not found` };
    if (!paths.some((p) => reachable(sandbox, policy, p))) return { check, missing: `missing: ${command} resolves to ${paths[0]}, outside the sandbox; add its directory to sandbox.read` };
    return { check, path: paths[0] };
  });
  world.ui.stage('verify', { cycleId, head, worktree, evidenceDir, found });
  const { results: plan, dirty } = await world.ui.checks(found, head, opts.deadlineMs);

  const results = [];
  for (const f of found) {
    const behaviour = plan.find((p) => p.check === f.check)?.behaviour ?? 'pass';
    const r = f.missing ? { stdout: '', stderr: '', result: 'MISSING', exit: f.missing } : evidence(f.check, behaviour, head);
    writeFileSync(join(evidenceDir, `${f.check.name}.stdout`), r.stdout);
    writeFileSync(join(evidenceDir, `${f.check.name}.stderr`), r.stderr);
    writeFileSync(join(evidenceDir, `${f.check.name}.exit`), `${r.exit}\n`);
    results.push({ name: f.check.name, result: r.result });
  }
  if (dirty) {
    writeFileSync(join(evidenceDir, `${TREE}.stdout`), ' M src/todo.js\n');
    writeFileSync(join(evidenceDir, `${TREE}.stderr`), '');
    writeFileSync(join(evidenceDir, `${TREE}.exit`), 'dirty\n');
    results.push({ name: TREE, result: 'FAIL' });
  }
  return { cycle: store.append(cycleId, { type: 'verification', head, checks: results }), worktree, evidenceDir };
}

// What a check of this repository would print: node --test lists the tests in the candidate.
function evidence(check, behaviour, head) {
  if (behaviour === 'timeout') return { stdout: '', stderr: '', result: 'FAIL', exit: 'timeout' };
  const fail = behaviour === 'fail';
  if (check.command?.includes('test')) {
    const src = world.repo.commits.get(head)?.tree['test/todo.test.js'] ?? '';
    const names = [...src.matchAll(/test\('([^']+)'/g)].map((m) => m[1]);
    const lines = names.map((n, i) => (fail && i === names.length - 1 ? `✖ ${n}\n  AssertionError [ERR_ASSERTION]: Missing expected exception (RangeError).` : `✔ ${n}`));
    const failed = fail ? 1 : 0;
    return { stdout: `${lines.join('\n')}\nℹ tests ${names.length}\nℹ pass ${names.length - failed}\nℹ fail ${failed}\n`, stderr: '', result: fail ? 'FAIL' : 'PASS', exit: `exit ${fail ? 1 : 0}` };
  }
  return { stdout: '', stderr: fail ? `${check.command?.at(-1)}: SyntaxError: Unexpected token\n` : '', result: fail ? 'FAIL' : 'PASS', exit: `exit ${fail ? 1 : 0}` };
}

/** review.ts imports this; the simulator's review asks the reader instead. */
export const treeDiff = () => '';
