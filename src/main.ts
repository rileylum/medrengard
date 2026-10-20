// Ticket 07-b: the owner's one command. `node src/main.ts <job.json>` runs one job through the
// loop with the real claude and pi adapters and prints what the owner needs to diff and merge.
// Checks, the developer (08-c) and the reviewers (08-d) run in the job's sandbox.
// Ticket 07-d: `accept <job.json> <sha>` and `cancel <job.json>` record the owner's decision on
// the job's cycle, so the work ID can run again. Both refuse, writing nothing, rather than send
// an event apply would escalate on. Ticket 09-b: the job file may name a workflow module; every
// command runs the job under it, and `runtime` names a CLI per role. Ticket 10-a: `runtime` names
// any registered runtime, and `runtimes` adds extension modules to the registry.
// Ticket 10-b: the job's settings come from four layers, read by src/config.ts.
// Ticket 10-d: `events <job.json | runsDir>` prints the observation stream as JSON lines, and
// `accept` and `cancel` record who ran them (`--source`, default `owner`).
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { loadConfig, storeOf, type JobFile } from './config.ts';
import { oneLine, type Job } from './developer.ts';
import { defaultWorkflow, isSource, type Workflow } from './lifecycle.ts';
import { ROLE_ALIASES, run, type Adapters } from './run.ts';
import { runtimeFor, type RuntimeEntry } from './runtime/registry.ts';
import type { Sandbox } from './sandbox.ts';
import { EventStore, openings, SETTLED, workflowHash } from './store.ts';
import { FOLLOW_MS, openStream, storeReady } from './stream.ts';

const USAGE = 'usage: node src/main.ts <job.json> | accept <job.json> <sha> [--source <name>] | cancel <job.json> [--source <name>] | events <job.json | runsDir> [--after <seq>] [--follow]';

/** One adapter per agent role, from `runtime[role]` or the alias that names the role. */
function adaptersFor(w: Workflow, registry: Record<string, RuntimeEntry>, runtime: JobFile['runtime'], sandbox: Sandbox): Adapters {
  const adapters: Adapters = {};
  for (const def of Object.values(w.stages)) {
    if (def.kind !== 'agent') continue;
    const key = Object.hasOwn(runtime ?? {}, def.role) ? def.role : (Object.entries(ROLE_ALIASES).find(([, r]) => r === def.role)?.[0] ?? def.role);
    const name = runtime?.[key];
    adapters[def.role] = runtimeFor(registry, name, key).adapter({ sandbox, writes: def.produces === 'commit' });
  }
  return adapters;
}

/** The job's store, or undefined when no run ever made one: nothing to decide on. */
function existingStore(runsDir: string, workflow: Workflow): EventStore | undefined {
  const db = join(runsDir, 'events.sqlite');
  return existsSync(db) ? new EventStore(db, workflow) : undefined;
}

const humanStages = (w: Workflow) => Object.keys(w.stages).filter((s) => w.stages[s]!.kind === 'human');

/**
 * The job's configuration as its existing cycles were opened under. The base ref has usually
 * moved since (the owner merges into it), and the layers at the new tip may not load them, or
 * not load at all (A-078 Q4). The recorded bases come first; the job file's base is the last
 * resort, and its error, or the store's refusal naming both workflows, is the one reported.
 */
async function decisionConfig(file: string) {
  const { runsDir, workId } = storeOf(file);
  const db = join(runsDir, 'events.sqlite');
  const opened = existsSync(db) ? openings(db, workId) : [];
  for (const base of new Set(opened.flatMap((o) => (o.base ? [o.base] : [])))) {
    // A base whose layers no longer load cannot be the one the cycles were opened under.
    const then = await loadConfig(file, process.env, { base }).catch(() => undefined);
    if (then && opened.every((o) => o.hash === workflowHash(then.workflow))) return then;
  }
  return loadConfig(file);
}

/** `--source <name>` at the end of `rest`, after `positional` words; the source is `owner` without it. */
function withSource(rest: string[], positional: number): { args: string[]; source: string } {
  const args = rest.slice(0, positional);
  const flag = rest.slice(positional);
  if (args.length !== positional) throw new Error(USAGE);
  if (flag.length === 0) return { args, source: 'owner' };
  if (flag.length !== 2 || flag[0] !== '--source') throw new Error(USAGE);
  if (!isSource(flag[1])) throw new Error('--source must be one line of printable text');
  return { args, source: flag[1]! };
}

async function events(rest: string[]): Promise<number> {
  const [target, ...flags] = rest;
  let after = 0;
  let follow = false;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--follow') follow = true;
    else if (flags[i] === '--after' && /^\d+$/.test(flags[i + 1] ?? '')) after = Number(flags[++i]);
    else throw new Error(USAGE);
  }
  if (!target) throw new Error(USAGE);
  const dir = existsSync(target) && statSync(target).isDirectory();
  // A job file names one work and the workflow its older cycles need; a runs directory names neither.
  const { runsDir, workId, workflow } = dir ? { runsDir: target, workId: undefined, workflow: undefined } : { ...(await decisionConfig(target)), workId: storeOf(target).workId };
  const db = join(runsDir, 'events.sqlite');
  if (!storeReady(db) && !follow) throw new Error(`no event store at ${db}`);
  while (!storeReady(db)) await sleep(FOLLOW_MS);
  const stream = openStream(db, { workId, after, workflow });
  try {
    for (;;) {
      for (const line of stream.poll()) process.stdout.write(`${JSON.stringify(line)}\n`);
      if (!follow) return 0;
      await sleep(FOLLOW_MS);
    }
  } finally {
    stream.close();
  }
}

async function accept(file: string, sha: string, source: string): Promise<number> {
  const { path, spec, repo, runsDir, workflow } = await decisionConfig(file);
  const store = existingStore(runsDir, workflow);
  try {
    const open = store?.cycles(spec.workId).find((c) => !SETTLED.includes(c.stage));
    if (!store || !open) throw new Error(`no open cycle for work ${spec.workId} in ${runsDir}`);
    const cycle = store.load(open.cycleId)!;
    if (!humanStages(workflow).includes(cycle.stage)) throw new Error(`cycle ${cycle.cycleId} is ${cycle.stage}, not ${humanStages(workflow).join(' or ') || 'at a human stage'}`);
    // The full SHA only: the owner accepts the exact commit the reviews were bound to.
    const head = cycle.candidate!.head;
    if (sha !== head) throw new Error(`${sha} is not the candidate head ${head} of cycle ${cycle.cycleId} (${path})`);
    const after = store.append(cycle.cycleId, { type: 'accept', head, source });
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

async function cancel(file: string, source: string): Promise<number> {
  const { spec, runsDir, workflow } = await decisionConfig(file);
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
      const after = store.append(cycleId, { type: 'cancel', source });
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
    const { args, source } = withSource(rest, 2);
    return accept(args[0]!, args[1]!, source);
  }
  if (first === 'cancel') {
    const { args, source } = withSource(rest, 1);
    return cancel(args[0]!, source);
  }
  if (first === 'events') return events(rest);
  // Extra words are refused, not ignored: `job.json cancel` would otherwise start a paid run.
  if (!first || rest.length !== 0) throw new Error(USAGE);
  const { path, spec, repo, runsDir, workflow, registry, sandbox, workflowDir, grants } = await loadConfig(first);
  const ticket = spec.ticket ?? (spec.ticketFile ? readFileSync(resolve(path, '..', spec.ticketFile), 'utf8') : undefined);
  if (!ticket) throw new Error('job needs ticket or ticketFile');
  const job: Job = { workId: spec.workId, ticket, repo, base: spec.base, parentCycleId: spec.parentCycleId, checks: spec.checks };
  const adapters = adaptersFor(workflow, registry, spec.runtime, sandbox);
  // develop makes runsDir, but the store opens first.
  mkdirSync(runsDir, { recursive: true });
  const store = new EventStore(join(runsDir, 'events.sqlite'), workflow);
  try {
    // `cancel` can settle the parent a job file still names. The store would refuse it too, but
    // without saying that the fix is in the job file.
    const parent = job.parentCycleId === undefined ? undefined : store.load(job.parentCycleId);
    if (parent && parent.stage !== 'ESCALATED')
      throw new Error(`parentCycleId ${parent.cycleId} is ${parent.stage}, not ESCALATED; remove parentCycleId from ${path} to start the work fresh`);
    const r = await run(store, adapters, job, { deadlineMs: spec.deadlineMs ?? 120_000, runsDir, sandbox, workflowDir, grants });
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
