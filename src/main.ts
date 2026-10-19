// Ticket 07-b: the owner's one command. `node src/main.ts <job.json>` runs one job through the
// loop with the real claude and pi adapters and prints what the owner needs to diff and merge.
// Checks, the developer (08-c) and the reviewers (08-d) run in the job's sandbox.
// Ticket 07-d: `accept <job.json> <sha>` and `cancel <job.json>` record the owner's decision on
// the job's cycle, so the work ID can run again. Both refuse, writing nothing, rather than send
// an event apply would escalate on. Ticket 09-b: the job file may name a workflow module; every
// command runs the job under it, and `runtime` names a CLI per role.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Adapter } from './adapter.ts';
import { oneLine, type DeveloperAdapter, type Job } from './developer.ts';
import { checkWorkflow, defaultWorkflow, type Workflow } from './lifecycle.ts';
import { ROLE_ALIASES, run, type Adapters } from './run.ts';
import { claudeDeveloper, claudeReviewer, cliAdapter, piDeveloper, piReviewer } from './runtime/cli-adapter.ts';
import type { Sandbox } from './sandbox.ts';
import { EventStore, SETTLED } from './store.ts';

interface JobFile extends Omit<Job, 'ticket'> {
  ticket?: string;
  /** Read instead of `ticket`, relative to the job file. */
  ticketFile?: string;
  /** A CLI per role; `standard` and `adversarial` name the default reviewers (ROLE_ALIASES). */
  runtime: Record<string, 'claude' | 'pi'>;
  /** A TypeScript module with a named export `workflow`, relative to the job file. Default defaultWorkflow. */
  workflow?: string;
  runsDir?: string;
  /** Per stage. Default 120000. */
  deadlineMs?: number;
  /** Where checks, the developer and the reviewers run. Default bwrap; `none` must be written out. `read` is relative to the job file. */
  sandbox?: Sandbox;
}

const DEFAULT_RUNS_DIR = '/var/tmp/software_factory/runs';

function developer(name: string | undefined, role: string, sandbox: Sandbox): DeveloperAdapter {
  if (name === 'claude') return (worktree) => cliAdapter(claudeDeveloper(worktree), { sandbox, writes: true });
  if (name === 'pi') return cliAdapter(piDeveloper, { sandbox, writes: true });
  throw new Error(`runtime.${role} must be claude or pi, got ${JSON.stringify(name)}`);
}
function reviewer(name: string | undefined, role: string, sandbox: Sandbox): Adapter {
  if (name === 'claude') return cliAdapter(claudeReviewer, { sandbox, writes: false });
  if (name === 'pi') return cliAdapter(piReviewer, { sandbox, writes: false });
  throw new Error(`runtime.${role} must be claude or pi, got ${JSON.stringify(name)}`);
}

const USAGE = 'usage: node src/main.ts <job.json> | accept <job.json> <sha> | cancel <job.json>';

async function readJob(file: string) {
  const path = resolve(file);
  const spec = JSON.parse(readFileSync(path, 'utf8')) as JobFile;
  return { path, spec, repo: resolve(path, '..', spec.repo), runsDir: resolve(spec.runsDir ?? DEFAULT_RUNS_DIR), workflow: await loadWorkflow(path, spec) };
}

// Checked here, though the store checks it too: the adapters are built from it before the store opens.
async function loadWorkflow(jobPath: string, spec: JobFile): Promise<Workflow> {
  if (spec.workflow === undefined) return defaultWorkflow;
  const file = resolve(jobPath, '..', spec.workflow);
  const mod = (await import(pathToFileURL(file).href)) as { workflow?: Workflow };
  if (mod.workflow === undefined) throw new Error(`${file} has no named export workflow`);
  const refused = checkWorkflow(mod.workflow);
  if (refused.length > 0) throw new Error(`workflow refused: ${refused.join('; ')}`);
  return mod.workflow;
}

/** One adapter per agent role, from `runtime[role]` or the alias that names the role. */
function adaptersFor(w: Workflow, runtime: JobFile['runtime'], sandbox: Sandbox): Adapters {
  const adapters: Adapters = {};
  for (const def of Object.values(w.stages)) {
    if (def.kind !== 'agent') continue;
    const key = Object.hasOwn(runtime ?? {}, def.role) ? def.role : (Object.entries(ROLE_ALIASES).find(([, r]) => r === def.role)?.[0] ?? def.role);
    const name = runtime?.[key];
    adapters[def.role] = def.produces === 'commit' ? developer(name, key, sandbox) : reviewer(name, key, sandbox);
  }
  return adapters;
}

/** The job's store, or undefined when no run ever made one: nothing to decide on. */
function existingStore(runsDir: string, workflow: Workflow): EventStore | undefined {
  const db = join(runsDir, 'events.sqlite');
  return existsSync(db) ? new EventStore(db, workflow) : undefined;
}

const humanStages = (w: Workflow) => Object.keys(w.stages).filter((s) => w.stages[s]!.kind === 'human');

async function accept(file: string, sha: string): Promise<number> {
  const { path, spec, repo, runsDir, workflow } = await readJob(file);
  const store = existingStore(runsDir, workflow);
  try {
    const open = store?.cycles(spec.workId).find((c) => !SETTLED.includes(c.stage));
    if (!store || !open) throw new Error(`no open cycle for work ${spec.workId} in ${runsDir}`);
    const cycle = store.load(open.cycleId)!;
    if (!humanStages(workflow).includes(cycle.stage)) throw new Error(`cycle ${cycle.cycleId} is ${cycle.stage}, not ${humanStages(workflow).join(' or ') || 'at a human stage'}`);
    // The full SHA only: the owner accepts the exact commit the reviews were bound to.
    const head = cycle.candidate!.head;
    if (sha !== head) throw new Error(`${sha} is not the candidate head ${head} of cycle ${cycle.cycleId} (${path})`);
    const after = store.append(cycle.cycleId, { type: 'accept', head });
    console.log(`Cycle: ${after.cycleId}`);
    console.log(`Stage: ${after.stage}`);
    if (after.stage !== 'ACCEPTED') return 1;
    console.log('');
    console.log('To merge:');
    console.log(`  git -C ${repo} merge --no-ff ${head}`);
    return 0;
  } finally {
    store?.close();
  }
}

async function cancel(file: string): Promise<number> {
  const { spec, runsDir, workflow } = await readJob(file);
  const store = existingStore(runsDir, workflow);
  try {
    const all = store?.cycles(spec.workId) ?? [];
    const open = all.filter((c) => !SETTLED.includes(c.stage));
    // With none open, every ESCALATED cycle: the store would ask a new cycle to name any of them
    // as its parent, so cancelling only one would not free the work ID.
    const targets = open.length > 0 ? open : all.filter((c) => c.stage === 'ESCALATED');
    if (!store || targets.length === 0) throw new Error(`nothing to cancel for work ${spec.workId} in ${runsDir}`);
    let code = 0;
    for (const { cycleId } of targets) {
      const after = store.append(cycleId, { type: 'cancel' });
      console.log(`Cycle: ${cycleId}`);
      console.log(`Stage: ${after.stage}`);
      if (after.stage !== 'CANCELLED') code = 1;
    }
    return code;
  } finally {
    store?.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const [first, ...rest] = argv;
  if (first === 'accept') {
    if (rest.length !== 2) throw new Error(USAGE);
    return accept(rest[0]!, rest[1]!);
  }
  if (first === 'cancel') {
    if (rest.length !== 1) throw new Error(USAGE);
    return cancel(rest[0]!);
  }
  // Extra words are refused, not ignored: `job.json cancel` would otherwise start a paid run.
  if (!first || rest.length !== 0) throw new Error(USAGE);
  const { path, spec, repo, runsDir, workflow } = await readJob(first);
  const ticket = spec.ticket ?? (spec.ticketFile ? readFileSync(resolve(path, '..', spec.ticketFile), 'utf8') : undefined);
  if (!ticket) throw new Error('job needs ticket or ticketFile');
  const job: Job = { workId: spec.workId, ticket, repo, base: spec.base, parentCycleId: spec.parentCycleId, checks: spec.checks };
  const sandbox: Sandbox = spec.sandbox
    ? { ...spec.sandbox, read: spec.sandbox.read?.map((p) => (typeof p === 'string' ? resolve(path, '..', p) : p)) }
    : { backend: 'bwrap' };
  const adapters = adaptersFor(workflow, spec.runtime, sandbox);
  // develop makes runsDir, but the store opens first.
  mkdirSync(runsDir, { recursive: true });
  const store = new EventStore(join(runsDir, 'events.sqlite'), workflow);
  try {
    // `cancel` can settle the parent a job file still names. The store would refuse it too, but
    // without saying that the fix is in the job file.
    const parent = job.parentCycleId === undefined ? undefined : store.load(job.parentCycleId);
    if (parent && parent.stage !== 'ESCALATED')
      throw new Error(`parentCycleId ${parent.cycleId} is ${parent.stage}, not ESCALATED; remove parentCycleId from ${path} to start the work fresh`);
    const r = await run(store, adapters, job, { deadlineMs: spec.deadlineMs ?? 120_000, runsDir, sandbox });
    const { cycle } = r;
    console.log(`Stage: ${cycle.stage}`);
    console.log(`Cycle: ${cycle.cycleId}`);
    console.log(`Branch: ${r.branch}`);
    console.log(`Head: ${cycle.candidate?.head || '(none)'}`);
    console.log(`Base: ${cycle.candidate?.base ?? '(none)'}`);
    console.log(`Worktree: ${r.worktree}`);
    console.log(`Sandbox: ${sandbox.backend}`);
    const budgeted = Object.keys(workflow.stages).filter((s) => workflow.stages[s]!.budget !== undefined);
    console.log(workflow === defaultWorkflow
      ? `Reviews: standard ${cycle.budgets.STANDARD_REVIEW ?? 0}, adversarial ${cycle.budgets.ADVERSARIAL_REVIEW ?? 0}`
      : `Reviews: ${budgeted.map((s) => `${s} ${cycle.budgets[s] ?? 0}`).join(', ')}`);
    for (const h of cycle.history) {
      const e = h.event;
      if (e.type === 'verification') console.log(`verification ${e.head.slice(0, 7)}: ${e.checks.map((c) => `${c.name} ${c.result}`).join(', ') || 'no checks'}`);
      if (e.type === 'verdict') {
        const def = workflow.stages[h.from];
        const role = def?.kind === 'agent' ? def.role : 'reviewer';
        console.log(`${role} ${e.head.slice(0, 7)}: ${e.verdict}`);
        for (const f of Array.isArray(e.findings) ? e.findings : []) console.log(`  - ${oneLine(f)}`);
      }
    }
    if (cycle.escalation) console.log(`Escalation: ${cycle.escalation}`);
    if (r.error) console.log(`Error: ${r.error}`);
    if (humanStages(workflow).includes(cycle.stage)) {
      console.log('');
      console.log('To review, accept and merge:');
      console.log(`  git -C ${job.repo} diff ${cycle.candidate!.base}..${cycle.candidate!.head}`);
      console.log(`  node ${process.argv[1]} accept ${path} ${cycle.candidate!.head}`);
      // By SHA, not branch: the branch can move after the reviews; the SHA is what they passed.
      console.log(`  git -C ${job.repo} merge --no-ff ${cycle.candidate!.head}`);
      return 0;
    }
    return 1;
  } finally {
    store.close();
  }
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 2; });
