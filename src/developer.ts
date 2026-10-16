// Ticket 05-a: one developer run from open to outcome. Resolves the base, opens the cycle, makes
// a worktree on the cycle's branch, assembles the prompt, calls execute, and refuses any claim
// whose commit is not the branch tip. Ticket 07-a adds the fix run: the same developer on the
// same worktree after a standard FAIL, prompted with the findings, under the same head guard.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Adapter } from './adapter.ts';
import { checkDeadline, execute } from './controller.ts';
import { git } from './git.ts';
import type { Cycle, Event } from './lifecycle.ts';
import type { EventStore } from './store.ts';
import type { Check } from './verify.ts';

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
}

/**
 * Either a ready adapter or one built once the worktree path is known: claude's allow list is
 * scoped to the worktree (claudeDeveloper), pi's is not (piDeveloper).
 */
export type DeveloperAdapter = Adapter | ((worktree: string) => Adapter);

export interface Developed {
  cycle: Cycle;
  /** `<runsDir>/<cycleId>`, checked out on `branch`. Kept for the owner and the fix run; nothing here deletes it. */
  worktree: string;
  branch: string;
}

const DEFAULT_RUNS_DIR = '/var/tmp/software_factory/runs';

/** Open a cycle for the job, run the developer once, return the replayed Cycle and where its branch lives. */
export async function develop(store: EventStore, adapter: DeveloperAdapter, job: Job, opts: DevelopOptions): Promise<Developed> {
  // Resolve before open: a ref that does not exist must not leave an empty cycle behind.
  const base = git(job.repo, 'rev-parse', '--verify', '--end-of-options', `${job.base ?? 'HEAD'}^{commit}`);
  const cycleId = randomUUID();
  const branch = `sf/${cycleId}`;
  // Absolute: git -C repo would resolve a relative path against the repository, mkdir against cwd.
  const runsDir = resolve(opts.runsDir ?? DEFAULT_RUNS_DIR);
  const worktree = join(runsDir, cycleId);
  // Everything that can throw without Git or the store goes before open, so a setup failure
  // (no user systemd for cliAdapter, a bad deadline) leaves nothing to clean up.
  checkDeadline(opts.deadlineMs);
  const developer = typeof adapter === 'function' ? adapter(worktree) : adapter;
  store.open(cycleId, job.workId, job.parentCycleId);
  try {
    mkdirSync(runsDir, { recursive: true });
    git(job.repo, 'worktree', 'add', '-q', '-b', branch, worktree, base);
    const cycle = await execute(
      store,
      cycleId,
      developer,
      { role: 'developer', prompt: prompt(job.ticket), cwd: worktree },
      { deadlineMs: opts.deadlineMs, base, accept: (claim) => refuse(worktree, branch, base, undefined, claim) },
    );
    return { cycle, worktree, branch };
  } catch (err) {
    // An open cycle with no outcome would hold the one-open-cycle guard against this work until
    // the owner cancelled it by hand; a failure that never produced a run outcome is ours to close.
    try { store.append(cycleId, { type: 'cancel' }); } catch { /* the store is the error; the original wins */ }
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
  // DEVELOPING with a head is only ever the stage after a standard FAIL; DEVELOPING without one
  // is the first run, which develop owns.
  if (cycle.stage !== 'DEVELOPING' || !cycle.candidate?.head) throw new Error(`fix on a cycle in ${cycle.stage}${cycle.candidate?.head ? '' : ' with no candidate'}, expected DEVELOPING after a standard FAIL`);
  if (cycle.runs.some((r) => r.role === 'developer' && !cycle.consumed.includes(r.runId))) throw new Error(`cycle ${cycleId} has a developer run still active`);
  const { head, base } = cycle.candidate;
  const verdict = cycle.history.map((h) => h.event).filter((e): e is Verdict => e.type === 'verdict').at(-1);
  if (!verdict || verdict.verdict !== 'FAIL' || verdict.head !== head) throw new Error(`cycle ${cycleId}: last verdict is not a FAIL for the candidate ${head}`);

  const runsDir = resolve(opts.runsDir ?? DEFAULT_RUNS_DIR);
  const worktree = join(runsDir, cycleId);
  const branch = `sf/${cycleId}`;
  if (!existsSync(join(worktree, '.git'))) throw new Error(`no worktree at ${worktree}; the cycle's branch has nowhere to be fixed`);
  // The tip must be the candidate: anything else is a head change outside a fix run, which the
  // spec gives to the owner, not to a run that would quietly build on it.
  const tip = git(worktree, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (tip !== head) throw new Error(`worktree ${worktree} is at ${tip}, not at the candidate ${head}`);
  const developer = typeof adapter === 'function' ? adapter(worktree) : adapter;
  const cycleAfter = await execute(
    store,
    cycleId,
    developer,
    { role: 'developer', prompt: prompt(job.ticket, { head, findings: verdict.findings ?? [] }), cwd: worktree },
    { deadlineMs: opts.deadlineMs, base, accept: (claim) => refuse(worktree, branch, base, head, claim) },
  );
  return { cycle: cycleAfter, worktree, branch };
}

/**
 * The spec's "commit exists" guard, plus its evidence rule that the diff is non-empty. The head
 * must be the full SHA at the tip of the cycle's branch: the tip, not any reachable commit, so
 * what is verified and reviewed is what the developer left behind, nothing on top of it. It
 * must descend from the base and differ from it, or `base..head` means nothing to step 6. A fix
 * run must also produce a new SHA: the previous candidate is the one that failed review.
 */
function refuse(worktree: string, branch: string, base: string, previous: string | undefined, claim: unknown): string | undefined {
  const head = (claim as { head?: unknown } | null)?.head;
  if (typeof head !== 'string' || !head) return undefined; // not ours to judge; the store rejects it
  const tip = git(worktree, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (head === base) return `commit ${head} is the base, not a new commit`;
  if (head === previous) return `commit ${head} is the previous candidate, not a new commit`;
  if (head !== tip) {
    return isCommit(worktree, head) ? `commit ${head} is not the tip of ${branch} (${tip})` : `commit ${head} is not the full SHA of a commit on ${branch} (tip ${tip})`;
  }
  if (gitStatus(worktree, 'merge-base', '--is-ancestor', base, head) !== 0) return `commit ${head} is not descended from the base ${base}`;
  // --quiet answers in the exit code: 0 same, 1 different, anything else an error (a missing object is 128).
  const diff = gitStatus(worktree, 'diff', '--quiet', base, head);
  if (diff === 0) return `commit ${head} has no changes against the base ${base}`;
  if (diff !== 1) return `commit ${head}: git diff ${base} ${head} failed with exit ${diff}`;
  return undefined;
}

// Exit status for the git subcommands whose answer is their exit code; null if git did not run.
function gitStatus(cwd: string, ...args: string[]): number | null {
  return spawnSync('git', args, { cwd, stdio: 'ignore' }).status;
}

// Full SHA only: an abbreviation would resolve here and name a commit the claim did not.
function isCommit(worktree: string, sha: string): boolean {
  if (!/^[0-9a-f]{40}$/.test(sha)) return false;
  try { return git(worktree, 'cat-file', '-t', sha) === 'commit'; } catch { return false; }
}

// Two rules the developer cannot infer from the ticket, then the claim in the exact shape the
// adapters parse (04-d). The fence text is asserted by tests/developer.test.ts. A fix run gets
// the findings after the ticket; its first line differs from the first run's, which the fixture
// developer relies on to produce a different commit.
function prompt(ticket: string, fixing?: { head: string; findings: string[] }): string {
  return [
    fixing
      ? 'You are the developer fixing review findings on the ticket below. The current directory is a Git worktree on the branch for this work, at your earlier commit.'
      : 'You are the developer for the ticket below. The current directory is a Git worktree on the branch for this work.',
    '',
    ticket.trim(),
    ...(fixing ? ['', `A review of your commit ${fixing.head} FAILED. Fix these findings, then commit:`, ...(fixing.findings.length ? fixing.findings.map((f) => `- ${f}`) : ['- (the reviewer listed no findings)'])] : []),
    '',
    'Rules:',
    '- Make the change and commit it on the current branch. Do not push, do not switch or create branches, do not amend commits that were already there.',
    '- When done, end your reply with exactly one fenced json block giving the full SHA of your final commit and the paths you changed:',
    '```json',
    '{"head": "<full commit sha>", "artifacts": ["<paths>"]}',
    '```',
  ].join('\n');
}
