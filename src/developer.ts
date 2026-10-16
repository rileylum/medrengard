// Ticket 05-a: one developer run from open to outcome. Resolves the base, opens the cycle, makes
// a worktree on the cycle's branch, assembles the prompt, calls execute, and refuses any claim
// whose commit is not the branch tip. Callers learn this one function; the loop is step 7.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter } from './adapter.ts';
import { execute } from './controller.ts';
import type { Cycle } from './lifecycle.ts';
import type { EventStore } from './store.ts';

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
  const runsDir = opts.runsDir ?? DEFAULT_RUNS_DIR;
  const worktree = join(runsDir, cycleId);
  store.open(cycleId, job.workId, job.parentCycleId);
  mkdirSync(runsDir, { recursive: true });
  git(job.repo, 'worktree', 'add', '-q', '-b', branch, worktree, base);
  const cycle = await execute(
    store,
    cycleId,
    typeof adapter === 'function' ? adapter(worktree) : adapter,
    { role: 'developer', prompt: prompt(job.ticket), cwd: worktree },
    { deadlineMs: opts.deadlineMs, base, accept: (claim) => refuse(worktree, branch, base, claim) },
  );
  return { cycle, worktree, branch };
}

/**
 * The spec's "commit exists" guard, plus its evidence rule that the diff is non-empty. The head
 * must be the full SHA at the tip of the cycle's branch: the tip, not any reachable commit, so
 * what is verified and reviewed is what the developer left behind, nothing on top of it.
 */
function refuse(worktree: string, branch: string, base: string, claim: unknown): string | undefined {
  const head = (claim as { head?: unknown } | null)?.head;
  if (typeof head !== 'string' || !head) return undefined; // not ours to judge; the store rejects it
  const tip = git(worktree, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  if (head === base) return `commit ${head} is the base, not a new commit`;
  if (head !== tip) {
    return isCommit(worktree, head) ? `commit ${head} is not the tip of ${branch} (${tip})` : `commit ${head} is not the full SHA of a commit on ${branch} (tip ${tip})`;
  }
  return undefined;
}

// Full SHA only: an abbreviation would resolve here and name a commit the claim did not.
function isCommit(worktree: string, sha: string): boolean {
  if (!/^[0-9a-f]{40}$/.test(sha)) return false;
  try { return git(worktree, 'cat-file', '-t', sha) === 'commit'; } catch { return false; }
}

// Two rules the developer cannot infer from the ticket, then the claim in the exact shape the
// adapters parse (04-d). The fence text is asserted by tests/developer.test.ts.
function prompt(ticket: string): string {
  return [
    'You are the developer for the ticket below. The current directory is a Git worktree on the branch for this work.',
    '',
    ticket.trim(),
    '',
    'Rules:',
    '- Make the change and commit it on the current branch. Do not push, do not switch or create branches, do not amend commits that were already there.',
    '- When done, end your reply with exactly one fenced json block giving the full SHA of your final commit and the paths you changed:',
    '```json',
    '{"head": "<full commit sha>", "artifacts": ["<paths>"]}',
    '```',
  ].join('\n');
}

// Sync Git: accept runs inside receive, which is synchronous. stdio is captured so a failing
// command surfaces as an Error naming the command, never as text on the controller's terminal.
function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.toString().trim();
    throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${stderr || (err as Error).message}`);
  }
}
