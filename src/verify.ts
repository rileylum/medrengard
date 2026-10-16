// Ticket 06-a: the VERIFYING stage. Checks out the candidate fresh, runs the job's declared checks
// there, writes each one's output and exit against the SHA, and appends one verification event.
// The lifecycle decides what the results mean; this module only produces them.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { checkDeadline } from './controller.ts';
import type { Job } from './developer.ts';
import { git } from './git.ts';
import type { Cycle, Event } from './lifecycle.ts';
import { checkScopes } from './runtime/cli-adapter.ts';
import { spawnRuntime, type RunResult } from './runtime/spawn.ts';
import type { EventStore } from './store.ts';

export interface Check {
  /** Evidence file stem: [A-Za-z0-9_.-], unique within the job. */
  name: string;
  /** argv, spawned directly with the candidate checkout as cwd; verify adds no shell. */
  command: string[];
}

export interface VerifyOptions {
  /** Per check. A check still running at the deadline is killed and FAILs. */
  deadlineMs: number;
  /** Same directory `develop` used. Default /var/tmp/software_factory/runs. */
  runsDir?: string;
  /** `cgroup` (default) runs each check in a systemd user scope, as the adapters do, so a check's own children die with it. */
  isolation?: 'cgroup' | 'process-group';
  /** Per stream per check; over it the check FAILs with the output dropped. Default 8 MiB. */
  maxOutputBytes?: number;
  /** SIGTERM to SIGKILL on the deadline, default 5000. */
  graceMs?: number;
}

export interface Verified {
  cycle: Cycle;
  /** `<runsDir>/<cycleId>-verify`, a detached checkout of the candidate head. Kept for the reviewers (06-b). */
  worktree: string;
  /** `<runsDir>/evidence/<head>/`, one `<name>.stdout`, `<name>.stderr`, `<name>.exit` per check. */
  evidenceDir: string;
}

type CheckResult = Extract<Event, { type: 'verification' }>['checks'][number];

const DEFAULT_RUNS_DIR = '/var/tmp/software_factory/runs';
// A file stem, nothing that could leave the evidence directory or hide a sibling's file.
const NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
// The controller's own check, recorded only when it fails: a check that rewrote a tracked file
// (formatter, codegen) left a checkout that is not the commit, so what the reviewers would read
// is not what was verified. Recording it escalates the cycle with evidence instead of leaving it
// in STANDARD_REVIEW with review refusing the dirty checkout on every call (06-c adversarial).
const TREE = 'tree';

/** Run every declared check on the cycle's candidate and record one verification event. */
export async function verify(store: EventStore, cycleId: string, job: Job, opts: VerifyOptions): Promise<Verified> {
  const checks = job.checks ?? [];
  const seen = new Set<string>();
  for (const c of checks) {
    if (typeof c.name !== 'string' || !NAME.test(c.name)) throw new Error(`check name ${JSON.stringify(c.name)} is not a file stem`);
    if (c.name === TREE) throw new Error(`check name ${TREE} is reserved for the controller's own tracked-tree check`);
    if (seen.has(c.name)) throw new Error(`check name ${c.name} is declared twice`);
    seen.add(c.name);
  }
  checkDeadline(opts.deadlineMs);
  const isolation = opts.isolation ?? 'cgroup';
  if (isolation === 'cgroup') checkScopes();
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  if (cycle.stage !== 'VERIFYING' || !cycle.candidate) throw new Error(`verify on a cycle in ${cycle.stage}, expected VERIFYING`);
  const head = cycle.candidate.head;

  const runsDir = resolve(opts.runsDir ?? DEFAULT_RUNS_DIR);
  const worktree = join(runsDir, `${cycleId}-verify`);
  const evidenceDir = join(runsDir, 'evidence', head);
  // Fresh every time: the spec wants checks that ran independently of the developer, and a
  // checkout of the commit alone is the only thing that proves it. A worktree left by an earlier
  // verification of this cycle (a fix run moved the head) goes first.
  if (existsSync(worktree)) git(job.repo, 'worktree', 'remove', '--force', worktree);
  // A -verify directory deleted by hand stays registered, and `worktree add` refuses the path.
  git(job.repo, 'worktree', 'prune');
  git(job.repo, 'worktree', 'add', '-q', '--detach', worktree, head);
  // Evidence for this SHA is this run's alone: a reader listing the directory must not find a
  // file from an earlier verification with a different check list (standard review 1 minor).
  rmSync(evidenceDir, { recursive: true, force: true });
  mkdirSync(evidenceDir, { recursive: true });

  const results: CheckResult[] = [];
  // In order, all of them: the evidence is for the owner and the reviewers, who want the whole
  // picture, not the first failure.
  for (const check of checks) {
    const r = await runCheck(check, worktree, isolation, opts);
    writeFileSync(join(evidenceDir, `${check.name}.stdout`), r.stdout);
    writeFileSync(join(evidenceDir, `${check.name}.stderr`), r.stderr);
    writeFileSync(join(evidenceDir, `${check.name}.exit`), `${r.exit}\n`);
    results.push({ name: check.name, result: r.result });
  }
  // Not through the git helper: it trims, and the leading column of a porcelain line (" M" is a
  // worktree edit, "M " a staged one) is the evidence.
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (dirty) {
    writeFileSync(join(evidenceDir, `${TREE}.stdout`), dirty);
    writeFileSync(join(evidenceDir, `${TREE}.stderr`), '');
    writeFileSync(join(evidenceDir, `${TREE}.exit`), 'dirty\n');
    results.push({ name: TREE, result: 'FAIL' });
  }
  return { cycle: store.append(cycleId, { type: 'verification', head, checks: results }), worktree, evidenceDir };
}

interface Outcome { result: CheckResult['result']; exit: string; stdout: string; stderr: string }

// The shell's rule: a name with a slash is a path (relative to the checkout), anything else is looked up on PATH.
function executable(command: string, cwd: string): boolean {
  if (command === '') return false;
  const candidates = command.includes('/') || isAbsolute(command)
    ? [resolve(cwd, command)]
    : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, command));
  return candidates.some((p) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } });
}

// `failed` is spawnRuntime's "never started": no binary, no cwd. That is the spec's MISSING,
// evidence that does not exist, as against FAIL, evidence that says no.
async function runCheck(check: Check, cwd: string, isolation: 'cgroup' | 'process-group', opts: VerifyOptions): Promise<Outcome> {
  const [command = '', ...args] = check.command;
  // Resolved here, not by the spawn: under a scope systemd-run does the lookup and exits 1 on a
  // missing binary, which would read as FAIL. MISSING must mean the same under both isolations.
  if (!executable(command, cwd)) return { stdout: '', stderr: '', result: 'MISSING', exit: `missing: ${command || '(empty command)'} not found` };
  const run = spawnRuntime({
    command, args, prompt: '', cwd,
    graceMs: opts.graceMs,
    maxOutputBytes: opts.maxOutputBytes,
    scope: isolation === 'cgroup' ? `sf-verify-${randomUUID()}` : undefined,
  });
  const timer = setTimeout(() => run.cancel(), opts.deadlineMs);
  let r: RunResult;
  try { r = await run; } finally { clearTimeout(timer); }
  const base = { stdout: r.stdout, stderr: r.stderr };
  if (r.status === 'failed') return { ...base, result: 'MISSING', exit: `missing: ${r.stderr.trim()}` };
  if (r.status === 'cancelled') return { ...base, result: 'FAIL', exit: 'timeout' };
  if (r.status === 'overflow') return { ...base, result: 'FAIL', exit: 'overflow' };
  return { ...base, result: r.exitCode === 0 ? 'PASS' : 'FAIL', exit: `exit ${r.exitCode ?? `signal ${r.signal}`}` };
}
