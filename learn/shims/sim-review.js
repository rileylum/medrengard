// src/review.ts for the simulator (mapped in by boot.js on sim.html). The reviewer's prompt is
// built by the real buildPrompt, read from src/review.ts and run against the fake Git and the
// evidence files the simulated verify wrote; the run goes through the real execute.
import { join } from 'node:path';
import { checkDeadline, execute } from '/src/controller.ts';
import { RUNS, world } from './world.js';

const ROLE_FOR_STAGE = { STANDARD_REVIEW: 'standard_reviewer', ADVERSARIAL_REVIEW: 'adversarial_reviewer' };

export async function review(store, adapter, cycleId, job, opts) {
  checkDeadline(opts.deadlineMs);
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  const role = ROLE_FOR_STAGE[cycle.stage];
  if (!role || !cycle.candidate) throw new Error(`review on a cycle in ${cycle.stage}, expected STANDARD_REVIEW or ADVERSARIAL_REVIEW`);
  const { head, base } = cycle.candidate;
  const runsDir = opts.runsDir ?? RUNS;
  const checkout = join(runsDir, `${cycleId}-verify`);
  const evidenceDir = join(runsDir, 'evidence', head);
  const verification = cycle.history.map((h) => h.event).filter((e) => e.type === 'verification').at(-1);
  if (!verification) throw new Error(`cycle ${cycleId} has no verification event`);
  if (verification.head !== head) throw new Error(`cycle ${cycleId}: last verification is for ${verification.head}, candidate is ${head}`);
  const prompt = (await world.live.buildPrompt())(role, job.ticket, head, base, job.repo, opts.instructions ?? ['AGENTS.md'], verification, evidenceDir);
  world.ui.stage('review', { cycleId, role, head });
  return execute(store, cycleId, adapter, { role, prompt, cwd: checkout }, { deadlineMs: opts.deadlineMs });
}
