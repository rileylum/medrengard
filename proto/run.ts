// Prototype (A-046): `node proto/run.ts <job.json>` is `node src/main.ts <job.json>` with every
// stage run as interactive claude in a herdr tab. Run it from a herdr pane; the board does.
import { mkdirSync } from 'node:fs';
import { oneLine } from '../src/developer.ts';
import { run } from '../src/run.ts';
import { EventStore } from '../src/store.ts';
import { inHerdr } from './herdr.ts';
import { herdrClaude } from './herdr-adapter.ts';
import { loadJob } from './job.ts';

// Per stage. Long, because the owner may be talking to the agent; the deadline still kills it.
const DEFAULT_DEADLINE_MS = 2 * 60 * 60 * 1000;

async function main(file: string | undefined): Promise<number> {
  if (!file) throw new Error('usage: node proto/run.ts <job.json>');
  if (!inHerdr()) throw new Error('run this inside herdr: each stage opens a herdr tab');
  const { spec, job, runsDir, db, sandbox } = loadJob(file);
  if (!job.ticket) throw new Error('job needs ticket or ticketFile');
  const opts = { workId: job.workId, runsDir, model: spec.model, sandbox };
  const adapters = {
    developer: (worktree: string) => herdrClaude(opts, worktree),
    standard: herdrClaude(opts),
    adversarial: herdrClaude(opts),
  };
  mkdirSync(runsDir, { recursive: true });
  const store = new EventStore(db);
  try {
    const r = await run(store, adapters, job, { deadlineMs: spec.deadlineMs ?? DEFAULT_DEADLINE_MS, runsDir, sandbox });
    const { cycle } = r;
    console.log(`\nStage: ${cycle.stage}  Cycle: ${cycle.cycleId}`);
    console.log(`Head: ${cycle.candidate?.head || '(none)'}  Reviews: standard ${cycle.standard}, adversarial ${cycle.adversarial}`);
    for (const { event: e } of cycle.history) {
      if (e.type === 'verification') console.log(`verification: ${e.checks.map((c) => `${c.name} ${c.result}`).join(', ') || 'no checks'}`);
      if (e.type === 'verdict') {
        console.log(`verdict ${e.head.slice(0, 7)}: ${e.verdict}`);
        for (const f of Array.isArray(e.findings) ? e.findings : []) console.log(`  - ${oneLine(f)}`);
      }
    }
    if (cycle.escalation) console.log(`Escalation: ${cycle.escalation}`);
    if (r.error) console.log(`Error: ${r.error}`);
    return cycle.stage === 'AWAITING_ACCEPTANCE' ? 0 : 1;
  } finally {
    store.close();
  }
}

main(process.argv[2]).then((code) => { process.exitCode = code; }, (err) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 2; });
