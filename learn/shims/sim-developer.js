// src/developer.ts for the simulator (mapped in by boot.js on sim.html). The same steps in the
// same order as the real develop and fix, with the clone and the fetch replaced by the fake Git:
// the developer commits on the clone's branch (refs/clone/<cycleId>), and the claim's guard is
// the real `refuse`, read from src/developer.ts, judging that branch as the real `land` does.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { checkDeadline, execute } from '/src/controller.ts';
import { checkSandbox } from '/src/sandbox.ts';
import { RUNS, world } from './world.js';

const cloneRef = (cycleId) => `refs/clone/${cycleId}`;


export async function develop(store, adapter, job, opts) {
  const base = world.git(job.repo, 'rev-parse', '--verify', '--end-of-options', `${job.base ?? 'HEAD'}^{commit}`);
  const cycleId = randomUUID();
  const branch = `sf/${cycleId}`;
  const worktree = join(opts.runsDir ?? RUNS, cycleId);
  checkDeadline(opts.deadlineMs);
  checkSandbox(opts.sandbox ?? { backend: 'bwrap' });
  const developer = typeof adapter === 'function' ? adapter(worktree) : adapter;
  store.open(cycleId, job.workId, job.parentCycleId);
  world.repo.refs.set(cloneRef(cycleId), base);
  world.ui.stage('develop', { cycleId, branch, base, worktree });
  const prompt = (await world.live.prompt())(job.ticket);
  const refuse = await world.live.refuse();
  try {
    const cycle = await execute(store, cycleId, developer, { role: 'developer', prompt, cwd: worktree },
      { deadlineMs: opts.deadlineMs, base, accept: (claim) => land(refuse, branch, cycleId, base, undefined, claim) });
    return { cycle, worktree, branch };
  } catch (err) {
    try { store.append(cycleId, { type: 'cancel' }); } catch { /* the store is the error */ }
    throw err;
  }
}

export async function fix(store, adapter, cycleId, job, opts) {
  checkDeadline(opts.deadlineMs);
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  if (cycle.stage !== 'DEVELOPING' || !cycle.candidate?.head) throw new Error(`fix on a cycle in ${cycle.stage}, expected DEVELOPING after a standard FAIL`);
  const { head, base } = cycle.candidate;
  const verdict = cycle.history.map((h) => h.event).filter((e) => e.type === 'verdict').at(-1);
  if (!verdict || verdict.verdict !== 'FAIL' || verdict.head !== head) throw new Error(`cycle ${cycleId}: last verdict is not a FAIL for the candidate ${head}`);
  const worktree = join(opts.runsDir ?? RUNS, cycleId);
  const branch = `sf/${cycleId}`;
  const tip = world.repo.refs.get(cloneRef(cycleId));
  if (tip !== head) throw new Error(`worktree ${worktree} is at ${tip}, not at the candidate ${head}`);
  const developer = typeof adapter === 'function' ? adapter(worktree) : adapter;
  world.ui.stage('fix', { cycleId, branch, head, findings: verdict.findings });
  const prompt = (await world.live.prompt())(job.ticket, { head, findings: verdict.findings });
  const refuse = await world.live.refuse();
  const after = await execute(store, cycleId, developer, { role: 'developer', prompt, cwd: worktree },
    { deadlineMs: opts.deadlineMs, base, accept: (claim) => land(refuse, branch, cycleId, base, head, claim) });
  return { cycle: after, worktree, branch };
}

// src/developer.ts#land without the fetch: the clone's branch is already in the fake repository.
// `refuse` is passed in loaded, because execute calls `accept` synchronously.
function land(refuse, branch, cycleId, base, previous, claim) {
  const head = claim?.head;
  if (typeof head !== 'string' || !head) return undefined; // not ours to judge; the store rejects it
  const refused = refuse(world.repo.path, cloneRef(cycleId), branch, base, previous, head);
  if (refused === undefined) world.repo.refs.set(`refs/heads/${branch}`, head);
  world.ui.stage('land', { head, refused, branch });
  return refused;
}

/** The clone's branch, where the simulated developer commits. */
export { cloneRef };
