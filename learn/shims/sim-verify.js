// src/verify.ts for the simulator (mapped in by boot.js on sim.html). Same order as the real
// verify: take the stage's own `run`, or the job's checks; check the names; find each command's
// binary with the real executables and reachable from src/sandbox.ts (so a command that is not
// installed is MISSING here too); write request.json and diff.patch; run each; write the evidence
// files under evidence/<head>/<stage>/; add the tree check when the checkout is dirty; append one
// verification event. Only "run" is the reader's: they say how each command behaves.
import { join } from 'node:path';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { checkDeadline } from '/src/controller.ts';
import { FILE_STEM, TREE_CHECK, fileArgs } from '/src/lifecycle.ts';
import { checkSandbox, confines, executables, reachable } from '/src/sandbox.ts';
import { liveFunction } from '../live.js';
import { RUNS, world } from './world.js';

// src/run.ts calls these before the developer starts, so they are the real ones, cut out of
// src/verify.ts: this module stands in for that file and cannot import it.
export const noWorkflowDir = await liveFunction('src/verify.ts', 'noWorkflowDir');
export const stageGrants = await liveFunction('src/verify.ts', 'stageGrants', { confines });
export const checkCommands = await liveFunction('src/verify.ts', 'checkCommands', { FILE_STEM, TREE_CHECK });
export const missingProgram = await liveFunction('src/verify.ts', 'missingProgram', { executables, reachable });
export const stageFiles = await liveFunction('src/verify.ts', 'stageFiles', { fileArgs, noWorkflowDir, statSync, join });
export const grantValues = await liveFunction('src/verify.ts', 'grantValues', { readFileSync });
// src/run.ts's decideAndDrive calls it on the cycle an owner's event leads to.
export const headGate = await liveFunction('src/verify.ts', 'headGate');

export async function verify(store, cycleId, job, opts) {
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  const def = store.workflow.stages[cycle.stage];
  if (def?.kind !== 'command' || !cycle.candidate) throw new Error(`verify on a cycle in ${cycle.stage}, expected a command stage`);
  const checks = def.run ?? job.checks ?? [];
  checkCommands(checks, def.run !== undefined);
  stageGrants(cycle.stage, def, opts.grants, opts.sandbox);
  checkDeadline(opts.deadlineMs);
  const sandbox = opts.sandbox ?? { backend: 'bwrap' };
  checkSandbox(sandbox);
  const { head, base } = cycle.candidate;
  const runsDir = opts.runsDir ?? RUNS;
  const worktree = join(runsDir, `${cycleId}-verify`);
  const evidenceDir = join(runsDir, 'evidence', head, cycle.stage);
  const outputDir = join(evidenceDir, 'output');
  mkdirSync(worktree, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  const diffFile = join(evidenceDir, 'diff.patch');
  writeFileSync(diffFile, world.git(job.repo, 'diff', base, head));
  const requestFile = join(evidenceDir, 'request.json');
  writeFileSync(requestFile, `${JSON.stringify({ cycleId, workId: cycle.workId, stage: cycle.stage, head, base, ticket: job.ticket, diffFile, outputDir }, null, 2)}\n`);
  const policy = { cwd: worktree, write: [worktree, outputDir], read: [evidenceDir], network: def.network ?? false, env: { SF_REQUEST: requestFile } };

  const found = checks.map((check) => {
    const [command = ''] = check.command ?? [];
    const why = missingProgram(command, sandbox, policy);
    return why ? { check, missing: `missing: ${why}` } : { check, path: executables(command, worktree)[0] };
  });
  world.ui.stage('verify', { cycleId, stage: cycle.stage, head, worktree, evidenceDir, found, policy, own: def.run !== undefined });
  const { results: plan, dirty } = await world.ui.checks(found, head, opts.deadlineMs, cycle.stage);

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
    writeFileSync(join(evidenceDir, `${TREE_CHECK}.stdout`), ' M src/todo.js\n');
    writeFileSync(join(evidenceDir, `${TREE_CHECK}.stderr`), '');
    writeFileSync(join(evidenceDir, `${TREE_CHECK}.exit`), 'dirty\n');
    results.push({ name: TREE_CHECK, result: 'FAIL' });
  }
  return { cycle: store.append(cycleId, { type: 'verification', head, checks: results }), worktree, evidenceDir };
}

// What a command run on this repository would print: node --test lists the tests in the candidate.
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
  return { stdout: fail ? '' : `${check.name}: ok\n`, stderr: fail ? `${check.command?.at(-1)}: failed\n` : '', result: fail ? 'FAIL' : 'PASS', exit: `exit ${fail ? 1 : 0}` };
}

/** review.ts imports this; the simulator's review asks the reader instead. */
export const treeDiff = () => '';
