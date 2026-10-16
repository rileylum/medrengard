// Ticket 06-b: one reviewer run for whichever review stage the cycle is in. Builds the prompt
// from the store (ticket results from the verification event), the 06-a checkout (diff,
// instruction files) and the evidence files, then calls execute. The lifecycle counts the
// verdict; this module never sees a developer transcript because the controller has none.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Adapter } from './adapter.ts';
import { checkDeadline, execute } from './controller.ts';
import type { Job } from './developer.ts';
import { git } from './git.ts';
import type { Cycle, Event, Role } from './lifecycle.ts';
import type { EventStore } from './store.ts';

export interface ReviewOptions {
  deadlineMs: number;
  /** Same directory `develop` and `verify` used. Default /var/tmp/software_factory/runs. */
  runsDir?: string;
  /** Repository instruction files to quote, read from the candidate commit. Default ['AGENTS.md']. */
  instructions?: string[];
}

const DEFAULT_RUNS_DIR = '/var/tmp/software_factory/runs';
// Per evidence file, head and tail kept. A prompt is read by a model, not a log viewer; the
// verdict's source is the event's result line, the file is detail.
const EVIDENCE_KEEP = 16 * 1024;
const DIFF_MAX = 256 * 1024;

const ROLE_FOR_STAGE: Partial<Record<Cycle['stage'], Role>> = { STANDARD_REVIEW: 'standard_reviewer', ADVERSARIAL_REVIEW: 'adversarial_reviewer' };
type Verification = Extract<Event, { type: 'verification' }>;

/** One reviewer run for whichever review stage the cycle is in. Returns the replayed Cycle. */
export async function review(store: EventStore, adapter: Adapter, cycleId: string, job: Job, opts: ReviewOptions): Promise<Cycle> {
  checkDeadline(opts.deadlineMs);
  const cycle = store.load(cycleId);
  if (!cycle) throw new Error(`cycle ${cycleId} not open`);
  const role = ROLE_FOR_STAGE[cycle.stage];
  if (!role || !cycle.candidate) throw new Error(`review on a cycle in ${cycle.stage}, expected STANDARD_REVIEW or ADVERSARIAL_REVIEW`);
  const { head, base } = cycle.candidate;

  // Everything the reviewer sees was produced by verify for this head; anything else is refused
  // before a run starts, so a reviewer never reads a tree the controller did not verify.
  const runsDir = resolve(opts.runsDir ?? DEFAULT_RUNS_DIR);
  const checkout = join(runsDir, `${cycleId}-verify`);
  const evidenceDir = join(runsDir, 'evidence', head);
  if (!existsSync(join(checkout, '.git'))) throw new Error(`no verify checkout at ${checkout}; run verify first`);
  const at = git(checkout, 'rev-parse', 'HEAD');
  if (at !== head) throw new Error(`verify checkout ${checkout} is at ${at}, not at the candidate ${head}`);
  if (!existsSync(evidenceDir)) throw new Error(`no verification evidence at ${evidenceDir}`);
  const verification = cycle.history.map((h) => h.event).filter((e): e is Verification => e.type === 'verification' && e.head === head).at(-1);
  if (!verification) throw new Error(`cycle ${cycleId} has no verification event for ${head}`);

  const prompt = buildPrompt(role, job.ticket, head, base, checkout, opts.instructions ?? ['AGENTS.md'], verification, evidenceDir);
  return execute(store, cycleId, adapter, { role, prompt, cwd: checkout }, { deadlineMs: opts.deadlineMs });
}

function buildPrompt(role: Role, ticket: string, head: string, base: string, checkout: string, instructions: string[], verification: Verification, evidenceDir: string): string {
  const adversarial = role === 'adversarial_reviewer';
  const diff = git(checkout, 'diff', base, head);
  const parts = [
    adversarial
      ? 'You are the adversarial reviewer for the change below. Your job is to break it: find inputs, sequences or states under which it does not do what the ticket says, and report what you can show. The current directory is a read-only checkout of the candidate commit.'
      : 'You are the standard reviewer for the change below. Judge the diff against the ticket, the repository instructions and the verification evidence. The current directory is a read-only checkout of the candidate commit.',
    '',
    'Rules:',
    '- Do not change anything. Read what you need.',
    '- PASS only if every ticket requirement is met by the diff and shown by the evidence. FAIL needs at least one finding that names a file and line.',
    '- When done, end your reply with exactly one fenced json block naming the candidate SHA you reviewed:',
    '```json',
    '{"head": "<candidate sha>", "verdict": "PASS" | "FAIL", "findings": ["<file:line — finding>"]}',
    '```',
    '',
    `Candidate SHA: ${head}`,
    `Base SHA: ${base}`,
    '',
    '---- TICKET ----',
    ticket.trim(),
  ];
  for (const path of instructions) {
    parts.push('', `---- INSTRUCTIONS ${path} ----`);
    try { parts.push(git(checkout, 'show', `${head}:${path}`)); } catch { parts.push(`${path}: not present in the candidate commit`); }
  }
  parts.push('', '---- VERIFICATION (run by the controller on the candidate SHA) ----');
  parts.push(...(verification.checks.length ? verification.checks.map((c) => `${c.name}: ${c.result}`) : ['no checks declared']));
  parts.push('', `---- DIFF ${base}..${head} ----`, cut(diff, DIFF_MAX));
  for (const c of verification.checks) {
    for (const ext of ['exit', 'stdout', 'stderr']) {
      parts.push('', `---- EVIDENCE ${c.name}.${ext} ----`, cut(read(join(evidenceDir, `${c.name}.${ext}`)), EVIDENCE_KEEP));
    }
  }
  return parts.join('\n');
}

const read = (path: string): string => { try { return readFileSync(path, 'utf8'); } catch { return '(file missing)'; } };

// Head and tail, the cut marked in the text so the reviewer knows it is not seeing a whole file.
function cut(text: string, keep: number): string {
  if (text.length <= 2 * keep) return text;
  return `${text.slice(0, keep)}\n[... ${text.length - 2 * keep} bytes cut ...]\n${text.slice(-keep)}`;
}
