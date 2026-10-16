// Ticket 04-d: the claude and pi adapters. One module builds an Adapter from a CliSpec; the spec
// is the command, its flags and a parser, and everything else (spawn, scope, byte cap, abort,
// outcome mapping) is shared. Shapes and exit codes are from docs/work/03-a-findings.md.
import { spawnSync } from 'node:child_process';
import type { Adapter, RunOutcome } from '../adapter.ts';
import { scopePath, spawnRuntime, type RunResult } from './spawn.ts';

export interface CliSpec {
  name: 'claude' | 'pi';
  command: string;
  args: string[];
  /** Turn a finished child into an outcome. Called only for status `exited`. A throw is a failed run, via the controller. */
  parse(stdout: string, stderr: string, exitCode: number | null): RunOutcome;
}

export interface CliAdapterOptions {
  /** `cgroup` (default) runs each child in a systemd user scope named after the run and kills the whole scope on cancel. */
  isolation?: 'cgroup' | 'process-group';
  /** Per stream; over it the run is `failed`. Default 8 MiB. */
  maxOutputBytes?: number;
  /** SIGTERM to kill, default 5000. */
  graceMs?: number;
}

export function cliAdapter(spec: CliSpec, opts: CliAdapterOptions = {}): Adapter {
  const isolation = opts.isolation ?? 'cgroup';
  if (isolation === 'cgroup') checkScopes();
  return {
    name: spec.name,
    async start(req, signal) {
      // systemd mangles characters outside this set (a space becomes \x20), so the scope would be
      // created under a different name than scopePath() computes and cgroup.kill would go nowhere.
      if (isolation === 'cgroup' && !/^[A-Za-z0-9:_.-]{1,200}$/.test(req.runId)) {
        return failed(`run ID ${JSON.stringify(req.runId.slice(0, 40))} is not usable as a systemd unit name`);
      }
      const run = spawnRuntime({
        command: spec.command,
        args: spec.args,
        prompt: req.prompt,
        cwd: req.cwd,
        graceMs: opts.graceMs,
        maxOutputBytes: opts.maxOutputBytes,
        scope: isolation === 'cgroup' ? `sf-${req.runId}` : undefined,
      });
      signal.addEventListener('abort', () => run.cancel(), { once: true });
      const r = await run;
      return outcome(spec, r);
    },
  };
}

// Fail at construction, not on the first run: a machine without a user systemd is a setup
// problem, and a silent fallback would hide the 03-b escape on exactly that machine. The probe
// runs a throwaway scope exactly as spawnRuntime will and checks, from inside it, that the path
// spawnRuntime computes is the scope's real cgroup and that its cgroup.kill is writable.
function checkScopes(): void {
  const unit = `sf-probe-${process.pid}-${Date.now()}`;
  const expected = scopePath(unit);
  const probe = spawnSync('systemd-run', ['--user', '--scope', '-q', '--slice-inherit', `--unit=${unit}`, '--', 'sh', '-c',
    'd=/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup); echo "$d"; test -w "$d/cgroup.kill"'], { timeout: 5000 });
  // A user manager that does not answer on D-Bus would otherwise hang construction.
  const why = probe.signal ? `probe timed out after 5 s (${probe.signal})` : probe.error?.message
    ?? (probe.status !== 0 ? probe.stderr.toString().trim() || `exit ${probe.status}; cgroup.kill not writable`
    : probe.stdout.toString().trim() !== expected ? `scope landed at ${probe.stdout.toString().trim()}, expected ${expected}`
    : undefined);
  if (why !== undefined) {
    throw new Error(`cgroup isolation needs systemd-run --user --scope (${why}); pass isolation: 'process-group' to accept the process-group limit`);
  }
}

function outcome(spec: CliSpec, r: RunResult): RunOutcome {
  if (r.status === 'cancelled') return { status: 'cancelled' };
  if (r.status === 'failed' || r.status === 'overflow') return failed(r.stderr);
  return spec.parse(r.stdout, r.stderr, r.exitCode);
}

// A reason is a sentence for the escalation, not a transcript; cut so it can never be the size
// problem. The cut can land inside a surrogate pair; toWellFormed keeps the store's strings valid.
const failed = (reason: string): RunOutcome => ({ status: 'failed', reason: reason.trim().slice(0, 1024).toWellFormed() || 'failed with no reason' });
const firstLine = (s: string) => s.trim().split('\n')[0] ?? '';

/**
 * The claim is the last fenced ```json block in the reply, or the whole reply if that is a JSON
 * object. The fields are not checked here; the store classifies the claim.
 */
function claimFrom(text: string, sessionId?: string): RunOutcome {
  const raw = lastFencedJson(text) ?? (text.trim().startsWith('{') ? text.trim() : undefined);
  if (raw === undefined) return failed('no claim block in reply');
  try {
    return { status: 'completed', claim: JSON.parse(raw), sessionId };
  } catch (err) {
    return failed(`claim block is not JSON: ${String(err)}`);
  }
}

// Loosely typed on purpose: the shapes are the CLIs' and every read below tolerates a missing path.
// Two indexOf calls, not a regex: a lazy pattern with overlapping whitespace quantifiers
// backtracks for seconds on an unclosed fence followed by blank lines, and this runs on the
// controller's event loop where it would hold every cycle past its deadline (04-d adversarial).
// The whole scan is one pass from the end, so the reply length is the only cost.
function lastFencedJson(text: string): string | undefined {
  const OPEN = '```json';
  let from = text.length;
  for (;;) {
    const open = text.lastIndexOf(OPEN, from);
    if (open < 0) return undefined;
    const start = open + OPEN.length;
    const close = text.indexOf('```', start);
    if (close >= 0) return text.slice(start, close);
    // An unclosed fence; an earlier one may still be closed.
    from = open - 1;
    if (from < 0) return undefined;
  }
}

const parseJson = (s: string): Record<string, any> | undefined => {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? v : undefined;
  } catch {
    return undefined;
  }
};

export const claude: CliSpec = {
  name: 'claude',
  command: 'claude',
  args: ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence'],
  parse(stdout, stderr, exitCode) {
    const result = parseJson(stdout);
    if (!result) return failed(`claude stdout is not a JSON result (exit ${exitCode}): ${firstLine(stderr) || firstLine(stdout) || 'empty'}`);
    const sessionId = typeof result.session_id === 'string' ? result.session_id : undefined;
    // Errors come with exit 1 and a JSON body whose subtype is still "success"; is_error is the flag.
    if (result.is_error) {
      const status = result.api_error_status == null ? '' : ` (api_error_status ${result.api_error_status})`;
      return failed(`claude: ${typeof result.result === 'string' ? result.result : 'error with no message'}${status}`);
    }
    return claimFrom(typeof result.result === 'string' ? result.result : '', sessionId);
  },
};

export const pi: CliSpec = {
  name: 'pi',
  command: 'pi',
  args: ['-p', '--mode', 'json', '--no-tools', '--no-session'],
  parse(stdout, stderr, exitCode) {
    const events = stdout.split('\n').map(parseJson).filter((e) => e !== undefined);
    const session = events.find((e) => e.type === 'session');
    const sessionId = typeof session?.id === 'string' ? session.id : undefined;
    // Errors are plain text on stderr and the stream just stops; a session line proves nothing.
    if (!events.some((e) => e.type === 'agent_end')) {
      return failed(`pi: ${firstLine(stderr) || `run ended without agent_end (exit ${exitCode})`}`);
    }
    const turn = events.filter((e) => e.type === 'turn_end').at(-1);
    const content: any[] = Array.isArray(turn?.message?.content) ? turn.message.content : [];
    const text = content.filter((c) => c?.type === 'text').map((c) => String(c.text ?? '')).join('');
    return claimFrom(text, sessionId);
  },
};

/**
 * Developer runs need tools on (05-a). Claude's allow list is scoped to the worktree: Edit and
 * Write by path, Bash to the git subcommands a commit needs. Under -p nothing can prompt, so a
 * tool outside the list is denied and the run ends on a missing commit or claim. A function of
 * the worktree because the path rules are absolute; develop() calls it once the worktree exists.
 */
export function claudeDeveloper(worktree: string): CliSpec {
  // A single leading slash in a path rule is relative to the project; `//` is the filesystem root.
  // Probed 2026-10-16: `Write(/var/tmp/.../**)` denied every write, `Write(//var/tmp/.../**)` allows them.
  const allowed = ['Read', 'Glob', 'Grep', `Edit(/${worktree}/**)`, `Write(/${worktree}/**)`,
    ...['add', 'commit', 'status', 'diff', 'log', 'rev-parse'].map((sub) => `Bash(git ${sub}:*)`)];
  return { ...claude, args: ['-p', '--output-format', 'json', '--no-session-persistence', '--allowedTools', ...allowed] };
}

/** pi has no path or command scoping: bash is unrestricted inside the scope. The worktree, the scratch repository and the cgroup kill are the containment. */
export const piDeveloper: CliSpec = { ...pi, args: ['-p', '--mode', 'json', '--no-session', '--tools', 'read,edit,write,bash'] };
