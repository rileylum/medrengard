// Ticket 07-b: the owner's one command. `node src/main.ts <job.json>` runs one job through the
// loop with the real claude and pi adapters and prints what the owner needs to diff and merge.
// Checks run in the job's sandbox (08-a); developer and reviewer runs do not yet (08-c), so
// scratch repositories only until then (A-029).
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Adapter } from './adapter.ts';
import { oneLine, type DeveloperAdapter, type Job } from './developer.ts';
import { run } from './run.ts';
import { claudeDeveloper, claudeReviewer, cliAdapter, piDeveloper, piReviewer } from './runtime/cli-adapter.ts';
import type { Sandbox } from './sandbox.ts';
import { EventStore } from './store.ts';

interface JobFile extends Omit<Job, 'ticket'> {
  ticket?: string;
  /** Read instead of `ticket`, relative to the job file. */
  ticketFile?: string;
  runtime: { developer: 'claude' | 'pi'; standard: 'claude' | 'pi'; adversarial: 'claude' | 'pi' };
  runsDir?: string;
  /** Per stage. Default 120000. */
  deadlineMs?: number;
  /** Where checks run. Default bwrap; `none` must be written out. `read` is relative to the job file. */
  sandbox?: Sandbox;
}

const DEFAULT_RUNS_DIR = '/var/tmp/software_factory/runs';

function developer(name: string): DeveloperAdapter {
  if (name === 'claude') return (worktree) => cliAdapter(claudeDeveloper(worktree));
  if (name === 'pi') return cliAdapter(piDeveloper);
  throw new Error(`runtime.developer must be claude or pi, got ${JSON.stringify(name)}`);
}
function reviewer(name: string, role: string): Adapter {
  if (name === 'claude') return cliAdapter(claudeReviewer);
  if (name === 'pi') return cliAdapter(piReviewer);
  throw new Error(`runtime.${role} must be claude or pi, got ${JSON.stringify(name)}`);
}

async function main(file: string | undefined): Promise<number> {
  if (!file) throw new Error('usage: node src/main.ts <job.json>');
  const path = resolve(file);
  const spec = JSON.parse(readFileSync(path, 'utf8')) as JobFile;
  const ticket = spec.ticket ?? (spec.ticketFile ? readFileSync(resolve(path, '..', spec.ticketFile), 'utf8') : undefined);
  if (!ticket) throw new Error('job needs ticket or ticketFile');
  const job: Job = { workId: spec.workId, ticket, repo: resolve(path, '..', spec.repo), base: spec.base, parentCycleId: spec.parentCycleId, checks: spec.checks };
  const runsDir = resolve(spec.runsDir ?? DEFAULT_RUNS_DIR);
  const sandbox: Sandbox = spec.sandbox
    ? { ...spec.sandbox, read: spec.sandbox.read?.map((p) => (typeof p === 'string' ? resolve(path, '..', p) : p)) }
    : { backend: 'bwrap' };
  const adapters = { developer: developer(spec.runtime?.developer), standard: reviewer(spec.runtime?.standard, 'standard'), adversarial: reviewer(spec.runtime?.adversarial, 'adversarial') };
  // develop makes runsDir, but the store opens first.
  mkdirSync(runsDir, { recursive: true });
  const store = new EventStore(join(runsDir, 'events.sqlite'));
  try {
    const r = await run(store, adapters, job, { deadlineMs: spec.deadlineMs ?? 120_000, runsDir, sandbox });
    const { cycle } = r;
    console.log(`Stage: ${cycle.stage}`);
    console.log(`Cycle: ${cycle.cycleId}`);
    console.log(`Branch: ${r.branch}`);
    console.log(`Head: ${cycle.candidate?.head || '(none)'}`);
    console.log(`Base: ${cycle.candidate?.base ?? '(none)'}`);
    console.log(`Worktree: ${r.worktree}`);
    console.log(`Sandbox: ${sandbox.backend}`);
    console.log(`Reviews: standard ${cycle.standard}, adversarial ${cycle.adversarial}`);
    for (const h of cycle.history) {
      const e = h.event;
      if (e.type === 'verification') console.log(`verification ${e.head.slice(0, 7)}: ${e.checks.map((c) => `${c.name} ${c.result}`).join(', ') || 'no checks'}`);
      if (e.type === 'verdict') {
        const role = h.from === 'STANDARD_REVIEW' ? 'standard_reviewer' : h.from === 'ADVERSARIAL_REVIEW' ? 'adversarial_reviewer' : 'reviewer';
        console.log(`${role} ${e.head.slice(0, 7)}: ${e.verdict}`);
        for (const f of Array.isArray(e.findings) ? e.findings : []) console.log(`  - ${oneLine(f)}`);
      }
    }
    if (cycle.escalation) console.log(`Escalation: ${cycle.escalation}`);
    if (r.error) console.log(`Error: ${r.error}`);
    if (cycle.stage === 'AWAITING_ACCEPTANCE') {
      console.log('');
      console.log('To review and merge:');
      console.log(`  git -C ${job.repo} diff ${cycle.candidate!.base}..${cycle.candidate!.head}`);
      console.log(`  git -C ${job.repo} merge --no-ff ${r.branch}`);
      return 0;
    }
    return 1;
  } finally {
    store.close();
  }
}

main(process.argv[2]).then((code) => { process.exitCode = code; }, (err) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 2; });
