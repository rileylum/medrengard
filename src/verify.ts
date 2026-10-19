// Ticket 06-a: the VERIFYING stage. Checks out the candidate fresh, runs the job's declared checks
// there, writes each one's output and exit against the SHA, and appends one verification event.
// The lifecycle decides what the results mean; this module only produces them.
// Ticket 08-a: the checkout is a plain directory with no .git, written and compared by the
// controller's git through an index outside it, and every check runs inside the job's sandbox.
// Ticket 08-b: owner access is restored before every comparison, git's warnings count as dirt,
// and what a check leaves untracked is removed before review. Ticket 08-d: gitlinks are emptied
// and checked, dangling symlinks removed, and a removal that cannot finish is dirt.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { checkDeadline } from './controller.ts';
import type { Job } from './developer.ts';
import { bounded, git, stopped } from './git.ts';
import type { CommandRequest } from './kits/request.ts';
import { FILE_STEM, TREE_CHECK, fileArgs, type Command, type Cycle, type Event } from './lifecycle.ts';
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
  /** The workflow file's directory. A command's `{ file }` argument names a file there (10-c). */
  workflowDir?: string;
}

export interface Verified {
  cycle: Cycle;
  /** `<runsDir>/<cycleId>-verify`, the candidate head's files with no `.git`. Kept for the reviewers (06-b). */
  worktree: string;
  /** `<runsDir>/evidence/<head>/<stage>/`, one `<name>.stdout`, `<name>.stderr`, `<name>.exit` per check. */
  evidenceDir: string;
}

type CheckResult = Extract<Event, { type: 'verification' }>['checks'][number];

const DEFAULT_RUNS_DIR = '/var/tmp/software_factory/runs';

/** A workflow passed as an object, not loaded from a file, has nowhere to find a file argument. */
export const noWorkflowDir = (stage: string, file: string) => `stage ${stage} names file ${file}, but its workflow has no file of its own to find it beside`;

/** Run every declared check on the cycle's candidate and record one verification event. */
export async function verify(store: EventStore, cycleId: string, job: Job, opts: VerifyOptions): Promise<Verified> {
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  const def = store.workflow.stages[cycle.stage];
  if (def?.kind !== 'command' || !cycle.candidate) throw new Error(`verify on a cycle in ${cycle.stage}, expected a command stage`);
  const checks: Command[] = def.run ?? job.checks ?? [];
  const seen = new Set<string>();
  for (const c of checks) {
    if (typeof c.name !== 'string' || !FILE_STEM.test(c.name)) throw new Error(`check name ${JSON.stringify(c.name)} is not a file stem`);
    if (c.name === TREE_CHECK) throw new Error(`check name ${TREE_CHECK} is reserved for the controller's own tracked-tree check`);
    if (seen.has(c.name)) throw new Error(`check name ${c.name} is declared twice`);
    seen.add(c.name);
  }
  // Before anything is written: a missing file is the owner's setup, not a FAIL of the candidate.
  const files = [...new Set(checks.flatMap(fileArgs))];
  for (const f of files) {
    if (opts.workflowDir === undefined) throw new Error(noWorkflowDir(cycle.stage, f));
    if (!existsSync(join(opts.workflowDir, f))) throw new Error(`stage ${cycle.stage} names file ${f}, which is not in ${opts.workflowDir}`);
  }
  checkDeadline(opts.deadlineMs);
  const isolation = opts.isolation ?? 'cgroup';
  if (isolation === 'cgroup') checkScopes();
  const sandbox = opts.sandbox ?? { backend: 'bwrap' };
  checkSandbox(sandbox);
  const { head, base } = cycle.candidate;

  const runsDir = resolve(opts.runsDir ?? DEFAULT_RUNS_DIR);
  const worktree = join(runsDir, `${cycleId}-verify`);
  // Per stage: a second command stage on the same head must not delete the first one's evidence.
  const evidenceDir = join(runsDir, 'evidence', head, cycle.stage);
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
  const tree = checkoutGit(job.repo, worktree, head, opts.deadlineMs);
  tree('read-tree', head);
  tree('checkout-index', '--all', '--force');
  // Evidence for this SHA is this run's alone: a reader listing the directory must not find a
  // file from an earlier verification with a different check list (standard review 1 minor).
  rmSync(evidenceDir, { recursive: true, force: true });
  const outputDir = join(evidenceDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  // The checkout has no .git, so a command cannot work the diff out itself. Uncut: review cuts what it quotes, a command reads it whole.
  const diffFile = join(evidenceDir, 'diff.patch');
  git(job.repo, 'diff', '--text', `--output=${diffFile}`, base, head);
  const request: CommandRequest = { cycleId, workId: cycle.workId, stage: cycle.stage, head, base, ticket: job.ticket, diffFile, outputDir };
  const requestFile = join(evidenceDir, 'request.json');
  writeFileSync(requestFile, `${JSON.stringify(request, null, 2)}\n`);
  // The command runs the copy: the bytes hashed are the bytes run, whatever happens to the original.
  const hashes = new Map<string, string>();
  for (const f of files) {
    const copy = join(evidenceDir, 'files', f);
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(join(opts.workflowDir!, f), copy);
    hashes.set(f, createHash('sha256').update(readFileSync(copy)).digest('hex'));
  }
  // The stage directory is read-only inside, so a command cannot rewrite the evidence the reviewer
  // reads; output/ is bound writable over it. Another stage's directory is not bound at all.
  const policy: Policy = { cwd: worktree, write: [worktree, outputDir], read: [evidenceDir], network: def.network ?? false, env: { SF_REQUEST: requestFile } };

  const results: CheckResult[] = [];
  // In order, all of them: the evidence is for the owner and the reviewers, who want the whole
  // picture, not the first failure.
  for (const check of checks) {
    const argv = check.command.map((a) => (typeof a === 'string' ? a : join(evidenceDir, 'files', a.file)));
    const r = await runCheck(argv, policy, isolation, sandbox, opts);
    writeFileSync(join(evidenceDir, `${check.name}.stdout`), r.stdout);
    writeFileSync(join(evidenceDir, `${check.name}.stderr`), r.stderr);
    writeFileSync(join(evidenceDir, `${check.name}.exit`), `${r.exit}\n`);
    const named = fileArgs(check);
    results.push({ name: check.name, result: r.result, ...(named.length ? { files: Object.fromEntries(named.map((f) => [f, hashes.get(f)!])) } : {}) });
  }
  let dirty = treeDiff(job.repo, worktree, head, opts.deadlineMs);
  // The reviewer reads this directory: a planted .git with its own config, or a symlink to the
  // owner's files, must not be there when it does (08-a adversarial). The full ls-tree format, not
  // --name-only: each record starts with its mode, so no trimming can eat a path that starts with
  // whitespace (08-b adversarial). Paths are latin1 strings, one char per byte, so a name that is
  // not valid UTF-8 still matches the bytes readdir returns for it (08-d adversarial).
  const entries = tree('ls-tree', '-r', '-z', head).bytes.toString('latin1').split('\0').filter(Boolean)
    .map((e) => ({ gitlink: e.startsWith('160000 '), path: e.slice(e.indexOf('\t') + 1) }));
  // A removal that cannot finish (a locked directory under a chain past PATH_MAX) leaves entries
  // the reviewer would read; that is dirt with its reason, not a throw (08-b adversarial).
  try { dirty += removeUntracked(worktree, entries); } catch (err) { dirty += `cannot remove untracked entries: ${(err as Error).message}\n`; }
  if (dirty) {
    writeFileSync(join(evidenceDir, `${TREE_CHECK}.stdout`), dirty);
    writeFileSync(join(evidenceDir, `${TREE_CHECK}.stderr`), '');
    writeFileSync(join(evidenceDir, `${TREE_CHECK}.exit`), 'dirty\n');
    results.push({ name: TREE_CHECK, result: 'FAIL' });
  }
  return { cycle: store.append(cycleId, { type: 'verification', head, checks: results }), worktree, evidenceDir };
}

/**
 * The controller's git over a verify checkout: the repository's own git dir, an index next to the
 * checkout and not in it, attributes from the head. Nothing inside the checkout is read as git
 * state, so a check that writes a `.git` pointer, a `.gitattributes` or index flags changes
 * nothing here (07-b adversarial). Not the git helper: it trims, and the buffer must stay 64 MiB
 * for a formatter that touched every file of a large tree. Each call gets the stage deadline.
 */
function checkoutGit(repo: string, checkout: string, head: string, timeoutMs: number) {
  const gitDir = git(repo, 'rev-parse', '--absolute-git-dir');
  const index = `${checkout}.index`;
  const env = { ...process.env, GIT_INDEX_FILE: index };
  // cwd is the repository: --work-tree names the checkout, and a checkout a check locked cannot be
  // a working directory at all (08-a adversarial).
  return (...args: string[]) => {
    const r = spawnSync('git', [`--git-dir=${gitDir}`, `--work-tree=${checkout}`, `--attr-source=${head}`, ...args], {
      cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...bounded(timeoutMs),
    });
    const why = stopped(r, timeoutMs);
    if (why) {
      // A killed git leaves its lock, and every later call on this index would fail on it. Only
      // the controller writes this index, one call at a time, so the lock is the killed call's.
      rmSync(`${index}.lock`, { force: true });
      throw new Error(`git ${args[0]} for ${checkout} ${why}`);
    }
    if (r.error) throw r.error;
    const stderr = r.stderr.toString();
    if (r.status !== 0) throw new Error(`git ${args[0]} for ${checkout} failed: ${stderr.trim()}`);
    return { stdout: r.stdout.toString(), stderr, bytes: r.stdout };
  };
}

/**
 * Delete everything under `checkout` that is not a tracked path or a directory holding one, and
 * empty every gitlink. A gitlink checks out as an empty directory, and diff-files compares only
 * the nested repository's HEAD there, not the files, so anything a check put in one is returned as
 * dirt (08-b adversarial); the rest of what a check leaves untracked is not dirt, only removed.
 */
function removeUntracked(checkout: string, entries: { gitlink: boolean; path: string }[]): string {
  // Names as bytes: a name that is not valid UTF-8 read as a string becomes U+FFFD, and the path
  // built from it names nothing (08-d adversarial). `rel` is latin1, one char per byte, as in entries.
  const at = (rel: string) => Buffer.concat([Buffer.from(`${checkout}/`), Buffer.from(rel, 'latin1')]);
  const shown = (rel: string) => Buffer.from(rel, 'latin1').toString();
  const keep = new Set(entries.filter((e) => !e.gitlink).map((e) => e.path));
  const gitlinks = new Set(entries.filter((e) => e.gitlink).map((e) => e.path));
  const dirs = new Set(entries.flatMap((e) => e.path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
  let dirt = '';
  const walk = (rel: string) => {
    for (const entry of readdirSync(at(rel), { encoding: 'buffer' })) {
      const p = rel ? `${rel}/${entry.toString('latin1')}` : entry.toString('latin1');
      if (keep.has(p)) continue;
      const path = at(p);
      const isDir = lstatSync(path).isDirectory();
      if (isDir && gitlinks.has(p)) {
        const inside = readdirSync(path);
        if (inside.length) dirt += `gitlink ${shown(p)} is not empty: ${inside.join(', ')}\n`;
        walk(p);
      } else if (isDir && dirs.has(p)) walk(p);
      // rmSync returns without error on a dangling symlink and leaves it (08-b adversarial).
      else if (isDir) rmSync(path, { recursive: true, force: true });
      else unlinkSync(path);
    }
  };
  walk('');
  return dirt;
}

/**
 * Tracked files in the checkout that differ from the head, as `git diff-files --name-status`
 * lines; empty when the checkout is the commit. The index is rebuilt from the head each time, so
 * no stat data a check could have arranged is trusted: every file is compared by content and mode.
 * Untracked files are not dirt. Shared with review, which refuses a checkout that is not clean.
 */
export function treeDiff(repo: string, checkout: string, head: string, timeoutMs: number): string {
  // A tree the controller cannot walk (a chain past PATH_MAX) is not one it can call the commit.
  try { restoreAccess(checkout); } catch (err) { return `cannot restore owner access in the checkout: ${(err as Error).message}\n`; }
  const tree = checkoutGit(repo, checkout, head, timeoutMs);
  tree('read-tree', head);
  // -q: a file that differs is not an error (exit 0); diff-files reports it. A failure here is git
  // unable to compare what a check left, such as a malformed repository at a gitlink, which
  // diff-files opens (08-d adversarial), or a FIFO there that holds it to the deadline (08-e
  // adversarial): the checkout is not the commit, so that is dirt too.
  try {
    const refresh = tree('update-index', '-q', '--refresh');
    const diff = tree('diff-files', '--name-status');
    // A warning means git skipped something it could not compare: that is dirt, and its own evidence.
    return diff.stdout + refresh.stderr + diff.stderr;
  } catch (err) {
    return `${(err as Error).message}\n`;
  }
}

interface Outcome { result: CheckResult['result']; exit: string; stdout: string; stderr: string }

// `failed` is spawnRuntime's "never started": no binary, no cwd. That is the spec's MISSING,
// evidence that does not exist, as against FAIL, evidence that says no.
async function runCheck(argv: string[], policy: Policy, isolation: 'cgroup' | 'process-group', sandbox: Sandbox, opts: VerifyOptions): Promise<Outcome> {
  const { cwd } = policy;
  const [command = '', ...args] = argv;
  // Resolved here, not by the spawn: under a scope systemd-run does the lookup and exits 1 on a
  // missing binary, which would read as FAIL. MISSING must mean the same under both isolations.
  const found = executables(command, cwd);
  if (!found.length) return { stdout: '', stderr: '', result: 'MISSING', exit: `missing: ${command || '(empty command)'} not found` };
  // Inside, PATH lookup skips directories that are not bound, so any reachable match will run.
  if (!found.some((p) => reachable(sandbox, policy, p))) {
    return { stdout: '', stderr: '', result: 'MISSING', exit: `missing: ${command} resolves to ${found[0]}, outside the sandbox; add its directory to sandbox.read` };
  }
  const [wrapped, wrappedArgs] = wrap(sandbox, policy, command, args);
  const run = spawnRuntime({
    command: wrapped, args: wrappedArgs, prompt: '', cwd,
    // bwrap clears this and sets policy.env again inside; `none` runs in it as is.
    env: { ...process.env, ...policy.env },
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
