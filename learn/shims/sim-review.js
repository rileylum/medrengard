// src/review.ts for the simulator (mapped in by boot.js on sim.html). The same refusals in the
// same order as the real review; what the reviewer is shown is gathered by the real `gather`,
// read from src/review.ts and run against the fake Git and the evidence files the simulated
// verify wrote, and worded by the real reviewPrompt from src/prompt.ts. The run goes through the
// real execute.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkDeadline, execute } from '/src/controller.ts';
import { reviewPrompt } from '/src/prompt.ts';
import { took } from '/src/lifecycle.ts';
import { RUNS, world } from './world.js';

export async function review(store, adapter, cycleId, job, opts) {
  checkDeadline(opts.deadlineMs);
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  const def = store.workflow.stages[cycle.stage];
  if (def?.kind !== 'agent' || def.produces !== 'verdict' || !cycle.candidate) throw new Error(`review on a cycle in ${cycle.stage}, expected a review stage`);
  const { role } = def;
  const { head, base } = cycle.candidate;
  const runsDir = opts.runsDir ?? RUNS;
  const checkout = join(runsDir, `${cycleId}-verify`);
  if (!existsSync(checkout)) throw new Error(`no verify checkout at ${checkout}; run verify first`);
  const all = cycle.history.filter((h) => h.event.type === 'verification' && took(store.workflow, h));
  const last = all.at(-1);
  if (!last) throw new Error(`cycle ${cycleId} has no verification event`);
  if (last.event.head !== head) throw new Error(`cycle ${cycleId}: last verification is for ${last.event.head}, candidate is ${head}`);
  const byStage = new Map();
  for (const h of all) if (h.event.head === head) byStage.set(h.from, h.event);
  const stages = [...byStage].map(([stage, verification]) => ({ stage, verification, dir: join(runsDir, 'evidence', head, stage) }));
  const gather = await world.live.gather();
  const { text, ...versions } = reviewPrompt(def.roleText, gather(job.ticket, head, base, job.repo, opts.instructions ?? ['AGENTS.md'], stages));
  world.ui.stage('review', { cycleId, role, head, stage: cycle.stage });
  return execute(store, cycleId, adapter, { role, prompt: text, cwd: checkout }, { deadlineMs: opts.deadlineMs, versions });
}
