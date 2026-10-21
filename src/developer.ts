// Ticket 05-a: one developer run from open to outcome. Resolves the base, opens the cycle, makes
// a worktree on the cycle's branch, assembles the prompt, calls execute, and refuses any claim
// whose commit is not the branch tip. Ticket 07-a adds the fix run: the same developer on the
// same worktree after a standard FAIL, prompted with the findings, under the same head guard.
// Ticket 08-c: the worktree is a clone of its own, which the developer's sandbox may write; the
// controller fetches the branch back into the repository and judges the head there.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Adapter } from './adapter.ts';
import { checkDeadline, execute } from './controller.ts';
import { bounded, git, stopped } from './git.ts';
import { cyclePaths, mirrorPath, runsRoot } from './layout.ts';
import type { Cycle, Event } from './lifecycle.ts';
import { developerPrompt } from './prompt.ts';
import { checkSandbox, wrap, type Sandbox } from './sandbox.ts';
import type { EventStore } from './store.ts';
import type { Check } from './verify.ts';

// main.ts and the tests import it from here, where it lived before the prompt moved (09-c).
export { oneLine } from './prompt.ts';

export interface Job {
  workId: string;
  /** The contract: ticket text as the developer sees it. */
  ticket: string;
  /** Path of the repository to work in; the worktree is made from it. */
  repo: string;
  /** Ref to start from; resolved to a SHA before the cycle opens. Default HEAD. */
  base?: string;
  /** Required when the work already has an ESCALATED cycle. */
  parentCycleId?: string;
  /**
   * The repository's declared checks, run by the controller on the candidate (06-a). Owner-supplied
   * with the job, not read from the candidate: a file at the candidate SHA is the developer's to edit.
   */
  checks?: Check[];
}

export interface DevelopOptions {
  deadlineMs: number;
  /** Where worktrees live, one per cycle. Default /var/tmp/software_factory/runs (on disk; /tmp is RAM here). */
  runsDir?: string;
  /**
   * Where the controller runs git that reads the clone: the fetch's upload-pack and fix's branch
   * checks. Default bwrap. The developer's own sandbox is its adapter's (cliAdapter's `sandbox`).
   */
  sandbox?: Sandbox;
}

/**
 * Either a ready adapter or one built once the worktree path is known: claude's allow list is
 * scoped to the worktree (claudeDeveloper), pi's is not (piDeveloper).
 */
export type DeveloperAdapter = Adapter | ((worktree: string) => Adapter);

export interface Developed {
  cycle: Cycle;
  /**
   * `<runsDir>/<cycleId>`, a clone of the repository checked out on `branch`. Kept for the owner and the fix run;
   * nothing here deletes it. Its `.git` is the developer's: the controller never runs git there outside the sandbox.
   */
  worktree: string;
  branch: string;
}

/** Open a cycle for the job, run the developer once, return the replayed Cycle and where its branch lives. */
export async function develop(store: EventStore, adapter: DeveloperAdapter, job: Job, opts: DevelopOptions): Promise<Developed> {
  // Resolve before open: a ref that does not exist must not leave an empty cycle behind.
  const base = git(job.repo, 'rev-parse', '--verify', '--end-of-options', `${job.base ?? 'HEAD'}^{commit}`);
  const cycleId = randomUUID();
  const runsDir = runsRoot(opts.runsDir);
  const { clone: worktree, branch } = cyclePaths(runsDir, cycleId);
  // Everything that can throw without Git or the store goes before open, so a setup failure
  // (no user systemd for cliAdapter, a bad deadline) leaves nothing to clean up.
  checkDeadline(opts.deadlineMs);
  const sandbox = opts.sandbox ?? { backend: 'bwrap' };
  checkSandbox(sandbox);
  // apply would escalate the first claim anyway; refusing here leaves no cycle behind.
  const start = store.workflow.stages[store.workflow.start];
  if (start?.kind !== 'agent' || start.produces !== 'commit') throw new Error(`start stage ${store.workflow.start} is not a commit stage; develop cannot open the cycle`);
  const developer = typeof adapter === 'function' ? adapter(worktree) : adapter;
  store.open(cycleId, job.workId, job.parentCycleId, base);
  try {
    mkdirSync(runsDir, { recursive: true });
    const mirror = mirrorPath(runsDir, job.repo);
    mirrorBase(job.repo, mirror, base);
    clone(job.repo, mirror, worktree, branch, base);
    const read = [join(mirror, 'objects')];
    const { text, ...versions } = developerPrompt(start, job.ticket);
    const cycle = await execute(
      store,
      cycleId,
      developer,
      { role: start.role, prompt: text, cwd: worktree, read },
      { deadlineMs: opts.deadlineMs, base, versions, accept: (claim) => land(job.repo, worktree, read, branch, cycleId, base, undefined, sandbox, opts.deadlineMs, claim) },
    );
    return { cycle, worktree, branch };
  } catch (err) {
    // An open cycle with no outcome would hold the one-open-cycle guard against this work until
    // the owner cancelled it by hand; a failure that never produced a run outcome is ours to close.
    try { store.append(cycleId, { type: 'cancel', source: 'controller' }); } catch { /* the store is the error; the original wins */ }
    throw err;
  }
}

type Verdict = Extract<Event, { type: 'verdict' }>;

/**
 * Run the developer again on the cycle's worktree after a standard FAIL. Everything comes from
 * the store and runsDir, as for verify and review: the findings are the last verdict's, the base
 * the candidate's, the worktree where develop left it. Returns the replayed Cycle and where its
 * branch lives.
 */
export async function fix(store: EventStore, adapter: DeveloperAdapter, cycleId: string, job: Job, opts: DevelopOptions): Promise<Developed> {
  checkDeadline(opts.deadlineMs);
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  // A commit stage with a head is a stage re-entered after a FAIL; without one it is the first
  // run, which develop owns.
  const def = store.workflow.stages[cycle.stage];
  if (def?.kind !== 'agent' || def.produces !== 'commit' || !cycle.candidate?.head) throw new Error(`fix on a cycle in ${cycle.stage}${cycle.candidate?.head ? '' : ' with no candidate'}, expected a commit stage after a FAIL`);
  // Only claims create runs, so any run without an outcome is a commit stage's.
  if (cycle.runs.some((r) => !cycle.consumed.includes(r.runId))) throw new Error(`cycle ${cycleId} has a developer run still active`);
  const { head, base } = cycle.candidate;
  const verdict = cycle.history.map((h) => h.event).filter((e): e is Verdict => e.type === 'verdict').at(-1);
  if (!verdict || verdict.verdict !== 'FAIL' || verdict.head !== head) throw new Error(`cycle ${cycleId}: last verdict is not a FAIL for the candidate ${head}`);

  const { clone: worktree, branch } = cyclePaths(opts.runsDir, cycleId);
  const sandbox = opts.sandbox ?? { backend: 'bwrap' };
  checkSandbox(sandbox);
  if (!existsSync(join(worktree, '.git'))) throw new Error(`no clone at ${worktree}; the cycle's branch has nowhere to be fixed`);
  // A clone made before 11-b2 has every object itself and no mirror to bind; bwrap refuses to bind
  // a path that does not exist.
  const objects = join(mirrorPath(opts.runsDir, job.repo), 'objects');
  const read = existsSync(objects) ? [objects] : [];
  // The tip must be the candidate: anything else is a head change outside a fix run, which the
  // spec gives to the owner, not to a run that would quietly build on it.
  const tip = cloneGit(sandbox, worktree, read, opts.deadlineMs, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (tip.stdout !== head) throw new Error(`worktree ${worktree} is at ${tip.stdout || '(no branch)'}, not at the candidate ${head}`);
  // On the branch, not merely with the branch at the head: a detached or switched clone would
  // take the developer's commit off the branch and spend the run on a claim refused as not the tip.
  const ref = cloneGit(sandbox, worktree, read, opts.deadlineMs, 'symbolic-ref', '--quiet', 'HEAD');
  const onto = ref.status === 0 ? ref.stdout : '(detached)';
  if (onto !== `refs/heads/${branch}`) throw new Error(`worktree ${worktree} is on ${onto}, not on ${branch}`);
  const developer = typeof adapter === 'function' ? adapter(worktree) : adapter;
  const { text, ...versions } = developerPrompt(def, job.ticket, { head, findings: verdict.findings });
  const cycleAfter = await execute(
    store,
    cycleId,
    developer,
    { role: def.role, prompt: text, cwd: worktree, read },
    { deadlineMs: opts.deadlineMs, base, versions, accept: (claim) => land(job.repo, worktree, read, branch, cycleId, base, head, sandbox, opts.deadlineMs, claim) },
  );
  return { cycle: cycleAfter, worktree, branch };
}

/**
 * The spec's "commit exists" guard, plus its evidence rule that the diff is non-empty, judged in
 * the repository on the branch as fetched from the clone (`incoming`). The head must be the full
 * SHA at the tip of the cycle's branch: the tip, not any reachable commit, so
 * what is verified and reviewed is what the developer left behind, nothing on top of it. It
 * must descend from the base and differ from it, or `base..head` means nothing to step 6. A fix
 * run must also produce a new SHA. It may keep the previous tree only by adding commits on top of
 * the previous candidate (07-e): reviewers read the commit messages (06-d), so a new message can
 * be the whole fix, but rewriting the commits that failed review is not a fix the reviewer can
 * compare against. The budget bounds a same-tree fix that changes nothing that matters.
 */
function refuse(repo: string, incoming: string, branch: string, base: string, previous: string | undefined, head: string): string | undefined {
  const tip = git(repo, 'rev-parse', '--verify', '--quiet', incoming);
  if (head === base) return `commit ${head} is the base, not a new commit`;
  if (head === previous) return `commit ${head} is the previous candidate: the fix run made no new commit and gave no dispute`;
  if (head !== tip) {
    return isCommit(repo, head) ? `commit ${head} is not the tip of ${branch} (${tip})` : `commit ${cut(head)} is not the full SHA of a commit on ${branch} (tip ${tip})`;
  }
  if (gitStatus(repo, 'merge-base', '--is-ancestor', base, head) !== 0) return `commit ${head} is not descended from the base ${base}`;
  // --quiet answers in the exit code: 0 same, 1 different, anything else an error (a missing object is 128).
  // The flags: otherwise git compares what the owner's diff drivers print, and a textconv driver that
  // renders two versions alike makes them "same". Either flag alone does it on git 2.56; both are kept.
  const diff = gitStatus(repo, 'diff', '--quiet', '--no-ext-diff', '--no-textconv', base, head);
  if (diff === 0) return `commit ${head} has no changes against the base ${base}`;
  if (diff !== 1) return `commit ${head}: git diff ${base} ${head} failed with exit ${diff}`;
  if (previous !== undefined) {
    const same = gitStatus(repo, 'diff', '--quiet', '--no-ext-diff', '--no-textconv', previous, head);
    if (same === 0 && gitStatus(repo, 'merge-base', '--is-ancestor', previous, head) !== 0) {
      return `commit ${head} has the previous candidate's tree but does not descend from ${previous}; rewriting commits is not allowed`;
    }
    if (same !== 0 && same !== 1) return `commit ${head}: git diff ${previous} ${head} failed with exit ${same}`;
  }
  return undefined;
}

/**
 * The mirror every clone of the repository borrows its objects from (11-b2, A-126): bare, owned and
 * written only by the controller, from the owner's repository, which it trusts; sandboxes bind it
 * read-only. It holds only the bases cycles started from, one `refs/bases/<sha>` each, so no
 * private branch or other cycle's `sf/*` reaches a developer (A-121 (d)); a base on a private
 * branch does, for every later cycle on the repository (A-133). Never pruned: a pruned object
 * corrupts every clone that borrows it, so gc stays off.
 */
function mirrorBase(repo: string, mirror: string, base: string): void {
  mkdirSync(dirname(mirror), { recursive: true });
  // Safe on an existing mirror, and settles the config even if an earlier run stopped after init.
  git(dirname(mirror), 'init', '-q', '--bare', mirror);
  git(mirror, 'config', 'gc.auto', '0');
  git(mirror, 'config', 'gc.pruneExpire', 'never');
  // By SHA, for a branch tip or any other commit, with no change to the owner's config (11-b2 probe
  // 1, which v0 passed too). The version is named so an owner config naming another one cannot
  // change what was probed.
  git(mirror, '-c', 'protocol.version=2', 'fetch', '-q', '--no-tags', '--no-write-fetch-head', repo, `${base}:refs/bases/${base}`);
}

/**
 * The clone for a cycle, `--shared` against the mirror: it copies no object, so none is hardlinked
 * to a file the developer's sandbox could write (A-038). The mirror has no `refs/heads/*`, so the
 * clone starts with no ref but the branch made here, and git warns it cloned an empty repository.
 * The owner's ~/.gitconfig is not bound in the sandbox, so the identity a commit needs is copied
 * into the clone's config.
 */
function clone(repo: string, mirror: string, dest: string, branch: string, base: string): void {
  git(dirname(dest), 'clone', '-q', '--shared', '--no-checkout', mirror, dest);
  git(dest, 'checkout', '-q', '-b', branch, base);
  for (const key of ['user.name', 'user.email']) {
    const v = spawnSync('git', ['config', '--get', key], { cwd: repo, encoding: 'utf8' });
    if (v.status === 0) git(dest, 'config', key, v.stdout.trim());
  }
}

/**
 * The claim's guard (07-a, 08-c): fetch the clone's branch into a private ref in the repository,
 * judge the head there, and move `refs/heads/<branch>` only for an accepted head. The repository's
 * git never reads the clone's config: upload-pack, the one process that does, runs in the sandbox
 * with the clone read-only, and the received objects are checked (`fetch.fsckObjects`). The fetch
 * gets the stage deadline: the clone is the developer's, and a FIFO in it holds upload-pack forever.
 */
function land(repo: string, clone: string, read: string[], branch: string, cycleId: string, base: string, previous: string | undefined, sandbox: Sandbox, timeoutMs: number, claim: unknown): string | undefined {
  const head = (claim as { head?: unknown } | null)?.head;
  if (typeof head !== 'string' || !head) return undefined; // not ours to judge; the store rejects it
  // 07-e: a dispute keeps the candidate, so nothing is fetched and no branch moves. On a first run
  // there is no candidate; apply escalates that case as outside a fix run.
  if ((claim as { dispute?: unknown }).dispute !== undefined) {
    return previous === undefined || head === previous ? undefined : `a dispute must name the previous candidate ${previous}, not ${cut(head)}`;
  }
  const incoming = `refs/sf/incoming/${cycleId}`;
  try {
    // git runs this through sh with the clone's path appended; under `none` it is plain `git upload-pack`.
    const [cmd, args] = wrap(sandbox, { cwd: clone, write: [], read: [clone, ...read], network: false }, 'git', ['upload-pack']);
    // Its own deadline too: killing the fetch does not reach upload-pack, which under `none` would
    // stay blocked on a FIFO for good (08-f standard 1). Under bwrap --die-with-parent covers it.
    const uploadPack = ['timeout', '-s', 'KILL', `${timeoutMs / 1000}s`, cmd, ...args];
    const fetchArgs = ['-c', 'fetch.fsckObjects=true', 'fetch', '-q', '--no-tags', '--no-write-fetch-head', `--upload-pack=${uploadPack.map(shellQuote).join(' ')}`];
    const fetched = spawnSync('git', [...fetchArgs, clone, `+refs/heads/${branch}:${incoming}`], { cwd: repo, encoding: 'utf8', ...bounded(timeoutMs) });
    const why = stopped(fetched, timeoutMs);
    if (why) return `fetch of ${branch} from ${clone} ${why}`;
    if (fetched.error || fetched.status !== 0) return `fetch of ${branch} from ${clone} failed: ${(fetched.error?.message ?? fetched.stderr).trim()}`;
    const refused = refuse(repo, incoming, branch, base, previous, head);
    if (refused === undefined) git(repo, 'update-ref', `refs/heads/${branch}`, head);
    return refused;
  } finally {
    spawnSync('git', ['update-ref', '-d', incoming], { cwd: repo, stdio: 'ignore' });
  }
}

// A claimed head that is not a commit is the developer's text, of any length; 64 holds a SHA-256.
const cut = (head: string) => (head.length <= 64 ? head : `${head.slice(0, 64)} [... ${head.length - 64} characters cut]`);

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * git in the clone through the sandbox, the clone read-only: its config, hooks and fsmonitor are
 * the developer's, and so is anything there that could hold git, hence the deadline.
 */
function cloneGit(sandbox: Sandbox, clone: string, read: string[], timeoutMs: number, ...args: string[]): { status: number | null; stdout: string } {
  const [cmd, argv] = wrap(sandbox, { cwd: clone, write: [], read: [clone, ...read], network: false }, 'git', args);
  const r = spawnSync(cmd, argv, { cwd: clone, encoding: 'utf8', ...bounded(timeoutMs) });
  const why = stopped(r, timeoutMs);
  if (why) throw new Error(`git ${args[0]} in ${clone} ${why}`);
  return { status: r.status, stdout: (r.stdout ?? '').trim() };
}

// Exit status for the git subcommands whose answer is their exit code; null if git did not run.
function gitStatus(cwd: string, ...args: string[]): number | null {
  return spawnSync('git', args, { cwd, stdio: 'ignore' }).status;
}

// Full SHA only: an abbreviation would resolve here and name a commit the claim did not.
function isCommit(repo: string, sha: string): boolean {
  if (!/^[0-9a-f]{40}$/.test(sha)) return false;
  try { return git(repo, 'cat-file', '-t', sha) === 'commit'; } catch { return false; }
}
