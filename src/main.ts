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
// Ticket 11-a: the decisions' rules live in src/decide.ts, and `main` runs only as a program.
// Ticket 11-a2: `accept` drives the cycle on when the workflow has a stage after the human one.
// Ticket 11-d: `request-changes <job.json> <sha>` records the owner's FAIL for that SHA; every owner
// command takes `--command-id`, which the store records once per cycle.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { loadConfig, storeOf, type Config, type JobFile } from './config.ts';
import { acceptEvent, cancelWork, humanStages, requestChangesEvent, type Decided } from './decide.ts';
import { oneLine, type Job } from './developer.ts';
import { printable } from './prompt.ts';
import { storeFile } from './layout.ts';
import { defaultWorkflow, isSource, type Workflow } from './lifecycle.ts';
import { decideAndDrive, ROLE_ALIASES, run, type Adapters, type RunOptions, type RunResult } from './run.ts';
import { runtimeFor, type RuntimeEntry } from './runtime/registry.ts';
import type { Sandbox } from './sandbox.ts';
import { EventStore, openings, StaleLoad, workflowHash } from './store.ts';
import { FOLLOW_MS, openStream, storeReady } from './stream.ts';

const USAGE = 'usage: node src/main.ts <job.json> | accept <job.json> <sha> [--source <name>] [--command-id <id>] | request-changes <job.json> <sha> [--source <name>] [--command-id <id>] | cancel <job.json> [--source <name>] [--command-id <id>] | events <job.json | runsDir> [--after <seq>] [--follow]';

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
  const db = storeFile(runsDir);
  return existsSync(db) ? new EventStore(db, workflow) : undefined;
}

/**
 * The job's configuration as its existing cycles were opened under. The base ref has usually
 * moved since (the owner merges into it), and the layers at the new tip may not load them, or
 * not load at all (A-078 Q4). The recorded bases come first; the job file's base is the last
 * resort, and its error is the one reported. Then `accept` gets the store's refusal naming both
 * workflows (`drivable`); `cancel` needs no match, since the store reads each cycle under the
 * workflow it recorded (11-c).
 */
async function decisionConfig(file: string) {
  const { runsDir, workId } = storeOf(file);
  const db = storeFile(runsDir);
  const opened = existsSync(db) ? openings(db, workId) : [];
  let unmerged: Error | undefined;
  for (const base of new Set(opened.flatMap((o) => (o.base ? [o.base] : [])))) {
    // A base whose layers no longer load cannot be the one the cycles were opened under.
    const then = await loadConfig(file, process.env, { base }).catch((err: Error & { code?: string }) => {
      if (err.code === 'UNMERGED_BASE') unmerged ??= err;
    });
    if (then && opened.every((o) => o.hash === workflowHash(then.workflow))) return then;
  }
  // A squash-merged and deleted branch leaves the base only on sf/*. The tip still serves if its
  // workflow matches; otherwise the refusal says what to do, where the store's mismatch would not.
  const now = await loadConfig(file).catch((err) => { throw unmerged ?? err; });
  if (unmerged && !opened.every((o) => o.hash === workflowHash(now.workflow))) throw unmerged;
  return now;
}

/** An owner command's flags. */
interface From {
  source: string;
  commandId?: string;
}

/**
 * `--source <name>` and `--command-id <id>`, each at most once, after `positional` words. The
 * source is `owner` without it. No command ID is minted: a fresh one would deduplicate nothing.
 */
function withFlags(rest: string[], positional: number): { args: string[]; from: From } {
  const args = rest.slice(0, positional);
  const flags = rest.slice(positional);
  if (args.length !== positional || flags.length % 2 !== 0) throw new Error(USAGE);
  const given = new Map<string, string>();
  for (let i = 0; i < flags.length; i += 2) {
    if (!['--source', '--command-id'].includes(flags[i]!) || given.has(flags[i]!)) throw new Error(USAGE);
    given.set(flags[i]!, flags[i + 1]!);
  }
  const source = given.get('--source') ?? 'owner';
  if (!isSource(source)) throw new Error('--source must be one line of printable text');
  const commandId = given.get('--command-id');
  // The same rule as --source: the stream prints it.
  if (commandId !== undefined && !(isSource(commandId) && commandId.isWellFormed())) throw new Error('--command-id must be one line of printable text');
  return { args, from: { source, ...(commandId === undefined ? {} : { commandId }) } };
}

/** The store's StaleLoad, with what the owner does about it. */
function again(err: unknown): never {
  if (err instanceof StaleLoad) throw new Error(`${err.message}; run the command again`);
  throw err;
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
  const db = storeFile(runsDir);
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

/** The job the run command builds from its config, and accept when it drives on. */
function jobOf({ path, spec, repo }: Config): Job {
  const ticket = spec.ticket ?? (spec.ticketFile ? readFileSync(resolve(path, '..', spec.ticketFile), 'utf8') : undefined);
  if (!ticket) throw new Error('job needs ticket or ticketFile');
  return { workId: spec.workId, ticket, repo, base: spec.base, parentCycleId: spec.parentCycleId, checks: spec.checks };
}

const optionsOf = ({ spec, runsDir, sandbox, workflowDir, grants }: Config): RunOptions => ({ deadlineMs: spec.deadlineMs ?? 120_000, runsDir, sandbox, workflowDir, grants });

/** Prints what the loop left for the owner; returns the exit code: 0 only at a human stage. */
function report(r: RunResult, { path, repo, workflow, sandbox }: Config): number {
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
      console.log(`${role} ${printable(e.head.slice(0, 7))}: ${e.verdict}`);
      for (const f of Array.isArray(e.findings) ? e.findings : []) console.log(`  - ${printable(oneLine(f))}`);
    }
  }
  if (cycle.escalation) console.log(`Escalation: ${printable(cycle.escalation)}`);
  if (r.error) console.log(`Error: ${printable(r.error)}`);
  if (humanStages(workflow).includes(cycle.stage)) {
    console.log('');
    console.log('To review, accept and merge:');
    console.log(`  git -C ${repo} diff ${cycle.candidate!.base}..${cycle.candidate!.head}`);
    console.log(`  node ${process.argv[1]} accept ${path} ${cycle.candidate!.head}`);
    // By SHA, not branch: the branch can move after the reviews; the SHA is what they passed.
    console.log(`  git -C ${repo} merge --no-ff ${cycle.candidate!.head}`);
    return 0;
  }
  return 1;
}

/** Record a decision at a human stage and drive on (11-a2); `decide` holds its refusals. */
async function decideAt(file: string, decide: (store: EventStore | undefined, workId: string, where: { runsDir: string; file: string }) => Decided) {
  const config = await decisionConfig(file);
  const { path, spec, runsDir, workflow, registry, sandbox } = config;
  const store = existingStore(runsDir, workflow);
  try {
    const { cycleId, event, after } = decide(store, spec.workId, { runsDir, file: path });
    const r = await decideAndDrive(store!, cycleId, event, async () =>
      ({ adapters: adaptersFor(workflow, registry, spec.runtime, sandbox), job: jobOf(config), opts: optionsOf(config) }), after).catch(again);
    return { config, ...r };
  } finally {
    store?.close();
  }
}

async function accept(file: string, sha: string, { source, commandId }: From): Promise<number> {
  const { config, cycle: after, driven } = await decideAt(file, (store, workId, where) => acceptEvent(store, workId, sha, source, where, commandId));
  const { repo } = config;
  if (driven) {
    // A further human stage prints its own next steps; ACCEPTED gets the merge lines below.
    const code = report(driven, config);
    if (driven.cycle.stage !== 'ACCEPTED') return code;
    console.log('');
    console.log('To merge:');
    console.log(`  git -C ${repo} merge --no-ff ${driven.cycle.candidate!.head}`);
    return 0;
  }
  console.log(`Cycle: ${after.cycleId}`);
  console.log(`Stage: ${after.stage}`);
  if (after.stage !== 'ACCEPTED') return 1;
  console.log('');
  console.log('To merge:');
  console.log(`  git -C ${repo} merge --no-ff ${after.candidate!.head}`);
  return 0;
}

/** The owner's FAIL: exit 0 once it is recorded, or what the driven loop's report says. */
async function requestChanges(file: string, sha: string, { source, commandId }: From): Promise<number> {
  const { config, cycle, driven } = await decideAt(file, (store, workId, where) => requestChangesEvent(store, workId, sha, source, where, commandId));
  if (driven) return report(driven, config);
  console.log(`Cycle: ${cycle.cycleId}`);
  console.log(`Stage: ${cycle.stage}`);
  if (cycle.escalation) console.log(`Escalation: ${printable(cycle.escalation)}`);
  return 0;
}

async function cancel(file: string, { source, commandId }: From): Promise<number> {
  const { path, spec, runsDir, workflow } = await decisionConfig(file);
  const store = existingStore(runsDir, workflow);
  try {
    let code = 0;
    for (const after of cancelWork(store, spec.workId, source, { runsDir, file: path }, commandId)) {
      console.log(`Cycle: ${after.cycleId}`);
      console.log(`Stage: ${after.stage}`);
      if (after.stage !== 'CANCELLED') code = 1;
    }
    return code;
  } finally {
    store?.close();
  }
}

/** Runs one command; returns its exit code, or throws a message for the owner. */
export async function main(argv: string[]): Promise<number> {
  const [first, ...rest] = argv;
  if (first === 'accept' || first === 'request-changes') {
    const { args, from } = withFlags(rest, 2);
    return (first === 'accept' ? accept : requestChanges)(args[0]!, args[1]!, from);
  }
  if (first === 'cancel') {
    const { args, from } = withFlags(rest, 1);
    return cancel(args[0]!, from);
  }
  if (first === 'events') return events(rest);
  // Extra words are refused, not ignored: `job.json cancel` would otherwise start a paid run.
  if (!first || rest.length !== 0) throw new Error(USAGE);
  const config = await loadConfig(first);
  const { path, spec, runsDir, workflow, registry, sandbox } = config;
  const job = jobOf(config);
  const adapters = adaptersFor(workflow, registry, spec.runtime, sandbox);
  // develop makes runsDir, but the store opens first.
  mkdirSync(runsDir, { recursive: true });
  const store = new EventStore(storeFile(runsDir), workflow);
  try {
    // `cancel` can settle the parent a job file still names. The store would refuse it too, but
    // without saying that the fix is in the job file.
    const parent = job.parentCycleId === undefined ? undefined : store.load(job.parentCycleId);
    if (parent && parent.stage !== 'ESCALATED')
      throw new Error(`parentCycleId ${parent.cycleId} is ${parent.stage}, not ESCALATED; remove parentCycleId from ${path} to start the work fresh`);
    return report(await run(store, adapters, job, optionsOf(config)), config);
  } finally {
    store.close();
  }
}

if (import.meta.main) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(printable(err instanceof Error ? err.message : err)); process.exitCode = 2; });
