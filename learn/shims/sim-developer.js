// src/developer.ts for the simulator (mapped in by boot.js on sim.html). The same steps in the
// same order as the real develop and fix, with the clone and the fetch replaced by the fake Git:
// the developer commits on the clone's branch (refs/clone/<cycleId>), the prompt is the real
// developerPrompt from src/prompt.ts, and the claim's guard is the real `refuse`, read from
// src/developer.ts, judging that branch as the real `land` does.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { checkDeadline, execute } from '/src/controller.ts';
import { developerPrompt } from '/src/prompt.ts';
import { checkSandbox } from '/src/sandbox.ts';
import { RUNS, world } from './world.js';

export { oneLine } from '/src/prompt.ts';
export const DEFAULT_RUNS_DIR = RUNS;

const cloneRef = (cycleId) => `refs/clone/${cycleId}`;

export async function develop(store, adapter, job, opts) {
  const base = world.git(job.repo, 'rev-parse', '--verify', '--end-of-options', `${job.base ?? 'HEAD'}^{commit}`);
  const cycleId = randomUUID();
  const branch = `sf/${cycleId}`;
  const worktree = join(opts.runsDir ?? RUNS, cycleId);
  checkDeadline(opts.deadlineMs);
  const sandbox = opts.sandbox ?? { backend: 'bwrap' };
  checkSandbox(sandbox);
  const start = store.workflow.stages[store.workflow.start];
  if (start?.kind !== 'agent' || start.produces !== 'commit') throw new Error(`start stage ${store.workflow.start} is not a commit stage; develop cannot open the cycle`);
  const developer = typeof adapter === 'function' ? adapter(worktree) : adapter;
  store.open(cycleId, job.workId, job.parentCycleId, base);
  world.repo.refs.set(cloneRef(cycleId), base);
  world.ui.stage('develop', { cycleId, branch, base, worktree });
  const { text, ...versions } = developerPrompt(start, job.ticket);
  const refuse = await world.live.refuse();
  try {
    const cycle = await execute(store, cycleId, developer, { role: start.role, prompt: text, cwd: worktree },
      { deadlineMs: opts.deadlineMs, base, versions, accept: (claim) => land(refuse, branch, cycleId, base, undefined, claim) });
    return { cycle, worktree, branch };
  } catch (err) {
    try { store.append(cycleId, { type: 'cancel', source: 'controller' }); } catch { /* the store is the error */ }
    throw err;
  }
}

export async function fix(store, adapter, cycleId, job, opts) {
  checkDeadline(opts.deadlineMs);
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  const def = store.workflow.stages[cycle.stage];
  if (def?.kind !== 'agent' || def.produces !== 'commit' || !cycle.candidate?.head) throw new Error(`fix on a cycle in ${cycle.stage}${cycle.candidate?.head ? '' : ' with no candidate'}, expected a commit stage after a FAIL`);
  if (cycle.runs.some((r) => !cycle.consumed.includes(r.runId))) throw new Error(`cycle ${cycleId} has a developer run still active`);
  const { head, base } = cycle.candidate;
  const verdict = cycle.history.map((h) => h.event).filter((e) => e.type === 'verdict').at(-1);
  if (!verdict || verdict.verdict !== 'FAIL' || verdict.head !== head) throw new Error(`cycle ${cycleId}: last verdict is not a FAIL for the candidate ${head}`);
  const worktree = join(opts.runsDir ?? RUNS, cycleId);
  const branch = `sf/${cycleId}`;
  const tip = world.repo.refs.get(cloneRef(cycleId));
  if (tip !== head) throw new Error(`worktree ${worktree} is at ${tip}, not at the candidate ${head}`);
  const developer = typeof adapter === 'function' ? adapter(worktree) : adapter;
  world.ui.stage('fix', { cycleId, branch, head, findings: verdict.findings, stage: cycle.stage });
  const { text, ...versions } = developerPrompt(def, job.ticket, { head, findings: verdict.findings });
  const refuse = await world.live.refuse();
  const after = await execute(store, cycleId, developer, { role: def.role, prompt: text, cwd: worktree },
    { deadlineMs: opts.deadlineMs, base, versions, accept: (claim) => land(refuse, branch, cycleId, base, head, claim) });
  return { cycle: after, worktree, branch };
}

// src/developer.ts#land without the fetch: the clone's branch is already in the fake repository.
// `refuse` is passed in loaded, because execute calls `accept` synchronously.
function land(refuse, branch, cycleId, base, previous, claim) {
  const head = claim?.head;
  if (typeof head !== 'string' || !head) return undefined; // not ours to judge; the store rejects it
  if (claim.dispute !== undefined) {
    const refused = previous === undefined || head === previous ? undefined : `a dispute must name the previous candidate ${previous}, not ${head}`;
    world.ui.stage('land', { head, refused, branch, dispute: claim.dispute });
    return refused;
  }
  const refused = refuse(world.repo.path, cloneRef(cycleId), branch, base, previous, head);
  if (refused === undefined) world.repo.refs.set(`refs/heads/${branch}`, head);
  world.ui.stage('land', { head, refused, branch });
  return refused;
}

/** The clone's branch, where the simulated developer commits. */
export { cloneRef };
