// Ticket 06-a: the VERIFYING stage. Checks out the candidate fresh, runs the job's declared checks
// there, writes each one's output and exit against the SHA, and appends one verification event.
// The lifecycle decides what the results mean; this module only produces them.
// Ticket 08-a: the checkout is a plain directory with no .git, written and compared by the
// controller's git through an index outside it, and every check runs inside the job's sandbox.
// Ticket 08-b: owner access is restored before every comparison, git's warnings count as dirt,
// and what a check leaves untracked is removed before review.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkDeadline } from './controller.ts';
import type { Job } from './developer.ts';
import { git } from './git.ts';
import type { Cycle, Event } from './lifecycle.ts';
import { checkScopes } from './runtime/cli-adapter.ts';
import { spawnRuntime, type RunResult } from './runtime/spawn.ts';
import { checkSandbox, executables, reachable, restoreAccess, wrap, type Policy, type Sandbox } from './sandbox.ts';
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
  /** Where checks run. Default bwrap; `none` runs them as the owner, unconfined (scratch repositories only). */
  sandbox?: Sandbox;
}

export interface Verified {
  cycle: Cycle;
  /** `<runsDir>/<cycleId>-verify`, the candidate head's files with no `.git`. Kept for the reviewers (06-b). */
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
  const sandbox = opts.sandbox ?? { backend: 'bwrap' };
  checkSandbox(sandbox);
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  if (cycle.stage !== 'VERIFYING' || !cycle.candidate) throw new Error(`verify on a cycle in ${cycle.stage}, expected VERIFYING`);
  const head = cycle.candidate.head;

  const runsDir = resolve(opts.runsDir ?? DEFAULT_RUNS_DIR);
  const worktree = join(runsDir, `${cycleId}-verify`);
  const evidenceDir = join(runsDir, 'evidence', head);
  // Fresh every time: the spec wants checks that ran independently of the developer, and a
  // checkout of the commit alone is the only thing that proves it. A checkout left by an earlier
  // verification of this cycle (a fix run moved the head) goes first.
  // Anything run in the old checkout after verify (the reviewers, until 08-c) may have locked it,
  // and rmSync cannot clear a directory it cannot read (08-b standard review 1).
  if (existsSync(worktree)) restoreAccess(worktree);
  rmSync(worktree, { recursive: true, force: true });
  // Before 08-a the checkout was a registered worktree; prune drops a registration left behind.
  git(job.repo, 'worktree', 'prune');
  mkdirSync(worktree, { recursive: true });
  const tree = checkoutGit(job.repo, worktree, head);
  tree('read-tree', head);
  tree('checkout-index', '--all', '--force');
  // Evidence for this SHA is this run's alone: a reader listing the directory must not find a
  // file from an earlier verification with a different check list (standard review 1 minor).
  rmSync(evidenceDir, { recursive: true, force: true });
  mkdirSync(evidenceDir, { recursive: true });

  const results: CheckResult[] = [];
  // In order, all of them: the evidence is for the owner and the reviewers, who want the whole
  // picture, not the first failure.
  for (const check of checks) {
    const r = await runCheck(check, worktree, isolation, sandbox, opts);
    writeFileSync(join(evidenceDir, `${check.name}.stdout`), r.stdout);
    writeFileSync(join(evidenceDir, `${check.name}.stderr`), r.stderr);
    writeFileSync(join(evidenceDir, `${check.name}.exit`), `${r.exit}\n`);
    results.push({ name: check.name, result: r.result });
  }
  const dirty = treeDiff(job.repo, worktree, head);
  if (dirty) {
    writeFileSync(join(evidenceDir, `${TREE}.stdout`), dirty);
    writeFileSync(join(evidenceDir, `${TREE}.stderr`), '');
    writeFileSync(join(evidenceDir, `${TREE}.exit`), 'dirty\n');
    results.push({ name: TREE, result: 'FAIL' });
  }
  // The reviewer reads this directory unsandboxed (08-c): a planted .git with its own config, or a
  // symlink to the owner's files, must not be there when it does (08-a adversarial).
  removeUntracked(worktree, git(job.repo, 'ls-tree', '-r', '-z', '--name-only', head).split('\0').filter(Boolean));
  return { cycle: store.append(cycleId, { type: 'verification', head, checks: results }), worktree, evidenceDir };
}

/**
 * The controller's git over a verify checkout: the repository's own git dir, an index next to the
 * checkout and not in it, attributes from the head. Nothing inside the checkout is read as git
 * state, so a check that writes a `.git` pointer, a `.gitattributes` or index flags changes
 * nothing here (07-b adversarial). Not the git helper: it trims, and the buffer must stay 64 MiB
 * for a formatter that touched every file of a large tree.
 */
function checkoutGit(repo: string, checkout: string, head: string) {
  const gitDir = git(repo, 'rev-parse', '--absolute-git-dir');
  const env = { ...process.env, GIT_INDEX_FILE: `${checkout}.index` };
  // cwd is the repository: --work-tree names the checkout, and a checkout a check locked cannot be
  // a working directory at all (08-a adversarial).
  return (...args: string[]) => {
    const r = spawnSync('git', [`--git-dir=${gitDir}`, `--work-tree=${checkout}`, `--attr-source=${head}`, ...args], {
      cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`git ${args[0]} for ${checkout} failed: ${r.stderr.trim()}`);
    return { stdout: r.stdout, stderr: r.stderr };
  };
}

/** Delete everything under `checkout` that is not a tracked path or a directory holding one. */
function removeUntracked(checkout: string, tracked: string[]): void {
  const keep = new Set(tracked);
  const dirs = new Set(tracked.flatMap((t) => t.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(checkout, rel))) {
      const p = rel ? `${rel}/${entry}` : entry;
      if (keep.has(p)) continue;
      if (dirs.has(p) && lstatSync(join(checkout, p)).isDirectory()) walk(p);
      else rmSync(join(checkout, p), { recursive: true, force: true });
    }
  };
  walk('');
}

/**
 * Tracked files in the checkout that differ from the head, as `git diff-files --name-status`
 * lines; empty when the checkout is the commit. The index is rebuilt from the head each time, so
 * no stat data a check could have arranged is trusted: every file is compared by content and mode.
 * Untracked files are not dirt. Shared with review, which refuses a checkout that is not clean.
 */
export function treeDiff(repo: string, checkout: string, head: string): string {
  // A tree the controller cannot walk (a chain past PATH_MAX) is not one it can call the commit.
  try { restoreAccess(checkout); } catch (err) { return `cannot restore owner access in the checkout: ${(err as Error).message}\n`; }
  const tree = checkoutGit(repo, checkout, head);
  tree('read-tree', head);
  // -q: a file that differs is not an error (exit 0); diff-files reports it. Any throw is a real git failure.
  const refresh = tree('update-index', '-q', '--refresh');
  const diff = tree('diff-files', '--name-status');
  // A warning means git skipped something it could not compare: that is dirt, and its own evidence.
  return diff.stdout + refresh.stderr + diff.stderr;
}

interface Outcome { result: CheckResult['result']; exit: string; stdout: string; stderr: string }

// `failed` is spawnRuntime's "never started": no binary, no cwd. That is the spec's MISSING,
// evidence that does not exist, as against FAIL, evidence that says no.
async function runCheck(check: Check, cwd: string, isolation: 'cgroup' | 'process-group', sandbox: Sandbox, opts: VerifyOptions): Promise<Outcome> {
  const [command = '', ...args] = check.command;
  // Resolved here, not by the spawn: under a scope systemd-run does the lookup and exits 1 on a
  // missing binary, which would read as FAIL. MISSING must mean the same under both isolations.
  const found = executables(command, cwd);
  if (!found.length) return { stdout: '', stderr: '', result: 'MISSING', exit: `missing: ${command || '(empty command)'} not found` };
  // Writes the checkout only; reads the system directories and the owner's list; no network.
  const policy: Policy = { cwd, write: [cwd], read: [], network: false };
  // Inside, PATH lookup skips directories that are not bound, so any reachable match will run.
  if (!found.some((p) => reachable(sandbox, policy, p))) {
    return { stdout: '', stderr: '', result: 'MISSING', exit: `missing: ${command} resolves to ${found[0]}, outside the sandbox; add its directory to sandbox.read` };
  }
  const [wrapped, wrappedArgs] = wrap(sandbox, policy, command, args);
  const run = spawnRuntime({
    command: wrapped, args: wrappedArgs, prompt: '', cwd,
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
