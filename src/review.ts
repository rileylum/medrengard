// Ticket 06-b: one reviewer run for whichever review stage the cycle is in. Builds the prompt
// from the store (ticket results from the verification event), the 06-a checkout (diff,
// instruction files) and the evidence files, then calls execute. The lifecycle counts the
// verdict; this module never sees a developer transcript because the controller has none.
// Ticket 08-a: the checkout has no .git; git runs in the job's repository, and the checkout is
// compared with the head through verify's private index.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter } from './adapter.ts';
import { checkDeadline, execute } from './controller.ts';
import type { Job } from './developer.ts';
import { git } from './git.ts';
import { cyclePaths } from './layout.ts';
import type { Cycle, Event } from './lifecycle.ts';
import { reviewPrompt, type ReviewParts } from './prompt.ts';
import type { EventStore } from './store.ts';
import { treeDiff } from './verify.ts';

export interface ReviewOptions {
  deadlineMs: number;
  /** Same directory `develop` and `verify` used. Default /var/tmp/software_factory/runs. */
  runsDir?: string;
  /** Repository instruction files to quote, read from the base commit. Default ['AGENTS.md']. */
  instructions?: string[];
}

// Per evidence file, head and tail kept. A prompt is read by a model, not a log viewer; the
// verdict's source is the event's result line, the file is detail.
const EVIDENCE_KEEP = 16 * 1024;
// Head and tail each, so the whole diff is sent up to twice this.
const DIFF_MAX = 128 * 1024;
// Head and tail each. Messages are prose a reviewer reads in full; past this they are a payload.
const COMMITS_KEEP = 16 * 1024;
// Author and message are the developer's text. The message is indented, as `git log` shows it, so
// no line of it starts where a section delimiter does; the nonce is what makes a delimiter real.
const COMMIT_FORMAT = '--format=commit %H%nAuthor: %an <%ae>%n%n%w(0,4,4)%B';

type Verification = Extract<Event, { type: 'verification' }>;
type Verified = Cycle['history'][number] & { event: Verification };
const EVIDENCE_EXTS = ['exit', 'stdout', 'stderr'] as const;

/** One reviewer run for whichever review stage the cycle is in. Returns the replayed Cycle. */
export async function review(store: EventStore, adapter: Adapter, cycleId: string, job: Job, opts: ReviewOptions): Promise<Cycle> {
  checkDeadline(opts.deadlineMs);
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  const def = store.workflow.stages[cycle.stage];
  if (def?.kind !== 'agent' || def.produces !== 'verdict' || !cycle.candidate) throw new Error(`review on a cycle in ${cycle.stage}, expected a review stage`);
  const { role } = def;
  const { head, base } = cycle.candidate;

  // Everything the reviewer sees was produced by verify for this head; anything else is refused
  // before a run starts, so a reviewer never reads a tree the controller did not verify.
  const { checkout, evidence } = cyclePaths(opts.runsDir, cycleId);
  if (!existsSync(checkout)) throw new Error(`no verify checkout at ${checkout}; run verify first`);
  // A check ran the candidate's code here; it may have rewritten a tracked file the reviewer
  // would then Read instead of the commit (06-b adversarial). The comparison is with the head,
  // so a checkout of any other commit fails it too. Untracked leftovers are allowed.
  const dirty = treeDiff(job.repo, checkout, head, opts.deadlineMs);
  if (dirty) throw new Error(`verify checkout ${checkout} is not clean against ${head}:\n${dirty}`);
  // The last verification is the candidate's: apply admits one only in a command stage and only for
  // the candidate SHA, so a mismatch here is a store or lifecycle bug, not a case to pick around.
  const all = cycle.history.filter((h): h is Verified => h.event.type === 'verification');
  const last = all.at(-1);
  if (!last) throw new Error(`cycle ${cycleId} has no verification event`);
  if (last.event.head !== head) throw new Error(`cycle ${cycleId}: last verification is for ${last.event.head}, candidate is ${head}`);
  // Each command stage's last verification of this head (10-c, A-081 Q4): a reviewer shown only the
  // last stage would miss a custom step's result. Keyed by the stage it was recorded in.
  const byStage = new Map<string, Verification>();
  for (const h of all) if (h.event.head === head) byStage.set(h.from, h.event);
  const stages = [...byStage].map(([stage, verification]) => ({ stage, verification, dir: evidence(head, stage) }));
  for (const { verification, dir } of stages) {
    if (!existsSync(dir)) throw new Error(`no verification evidence at ${dir}`);
    for (const c of verification.checks) {
      for (const ext of EVIDENCE_EXTS) {
        const f = join(dir, `${c.name}.${ext}`);
        if (!existsSync(f)) throw new Error(`verification evidence file ${f} is missing`);
      }
    }
  }

  const { text, ...versions } = reviewPrompt(def.roleText, gather(job.ticket, head, base, job.repo, opts.instructions ?? ['AGENTS.md'], stages));
  return execute(store, cycleId, adapter, { role, prompt: text, cwd: checkout }, { deadlineMs: opts.deadlineMs, versions });
}

// What the reviewer is shown, gathered from Git and the evidence files; the wording around it is
// src/prompt.ts's.
function gather(ticket: string, head: string, base: string, repo: string, instructions: string[], stages: { stage: string; verification: Verification; dir: string }[]): ReviewParts {
  // --text: a committed .gitattributes with `-diff` would otherwise turn every file into
  // "Binary files differ" (06-b adversarial); the cut bounds any real binary. The rest: the owner's
  // diff.external, textconv or color.diff would otherwise replace the patch, as in verify.
  const diff = quoteGit(repo, 'diff', '--text', '--no-ext-diff', '--no-textconv', '--no-color', base, head);
  return {
    head,
    base,
    ticket,
    // From the base: the candidate must not write the rules it is judged by. Its edit is in the
    // diff, and `changed` tells the reviewer so. ls-tree answers absence with empty output and
    // exit 0; any failure is not absence and surfaces. Its line holds the blob ID, so equal lines
    // mean the same file.
    instructions: instructions.map((path) => {
      const atBase = git(repo, 'ls-tree', base, '--', path);
      const text = atBase ? quoteGit(repo, 'show', `${base}:${path}`) : `${path}: not present in the base commit`;
      return { path, text, changed: atBase !== git(repo, 'ls-tree', head, '--', path) };
    }),
    checks: stages.flatMap(({ stage, verification }) => verification.checks.map((c) => ({ ...c, name: `${stage}/${c.name}` }))),
    paths: quoteGit(repo, 'diff', '--name-status', base, head),
    commits: cut(quoteGit(repo, 'log', '--reverse', COMMIT_FORMAT, `${base}..${head}`), COMMITS_KEEP),
    diff: cut(diff, DIFF_MAX),
    evidence: stages.flatMap(({ stage, verification, dir }) => verification.checks.flatMap((c) =>
      EVIDENCE_EXTS.map((ext) => ({ name: `${stage}/${c.name}.${ext}`, text: cut(readFileSync(join(dir, `${c.name}.${ext}`), 'utf8'), EVIDENCE_KEEP) })))),
  };
}

// Output past the helper's 64 MiB buffer is quoted as a placeholder, not thrown: a candidate the
// controller verified must always reach a reviewer, and the reviewer can see why it has no text.
function quoteGit(cwd: string, ...args: string[]): string {
  try {
    return git(cwd, ...args);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOBUFS') return `(git ${args[0]} output exceeds 64 MiB and is not quoted)`;
    throw err;
  }
}

// Head and tail, the cut marked in the text so the reviewer knows it is not seeing a whole file.
// Counts are characters: the text is already decoded, and the reviewer reads it as text.
function cut(text: string, keep: number): string {
  if (text.length <= 2 * keep) return text;
  return `${text.slice(0, keep)}\n[... ${text.length - 2 * keep} characters cut ...]\n${text.slice(-keep)}`;
}
