// Ticket 04-d: the claude and pi adapters. One module builds an Adapter from a CliSpec; the spec
// is the command, its flags and a parser, and everything else (spawn, scope, byte cap, abort,
// outcome mapping) is shared. Shapes and exit codes are from docs/work/03-a-findings.md.
// Ticket 10-a: an extension runtime is one more CliSpec, `node <module>` speaking JSON.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Adapter, RunOutcome, RunRequest } from '../adapter.ts';
import { checkSandbox, confines, executables, wrap, type Sandbox } from '../sandbox.ts';
import { scopePath, spawnRuntime, type RunResult } from './spawn.ts';

export interface CliSpec {
  name: string;
  command: string;
  args: string[];
  /** What goes to stdin. Default the prompt alone. */
  input?(req: RunRequest): string;
  /** Absolute paths bound read-only inside a sandbox, beside `config`. */
  bind?: string[];
  /** Copied onto the adapter, so every outcome event records it. */
  moduleHash?: string;
  /** Turn a finished child into an outcome. Called only for status `exited`. A throw is a failed run, via the controller. */
  parse(stdout: string, stderr: string, exitCode: number | null): RunOutcome;
  /**
   * What the CLI needs of the owner's home inside a sandbox, relative to it; a path that does not
   * exist is skipped. `read` is bound read-only, `overlay` takes writes that are dropped after the
   * run (docs/work/08-c-findings.md), and `write` paths keep their writes through the overlay (08-g).
   */
  config: { read: string[]; overlay: string[]; write?: string[] };
}

export interface CliAdapterOptions {
  /** `cgroup` (default) runs each child in a systemd user scope named after the run and kills the whole scope on cancel. */
  isolation?: 'cgroup' | 'process-group';
  /** Per stream; over it the run is `failed`. Default 8 MiB. */
  maxOutputBytes?: number;
  /** SIGTERM to kill, default 5000. */
  graceMs?: number;
  /**
   * Whether the sandbox lets the run write its cwd. Default: only for role `developer`. A workflow
   * names its own roles (09-b), so main.ts sets this from what the role produces: a commit writes.
   */
  writes?: boolean;
  /**
   * Run the CLI inside this sandbox (08-c): a developer writes the request's cwd, a reviewer only
   * reads it (08-d); either writes its own /tmp, reads its binary's directory and `spec.config`,
   * and has the network. Without one it runs as the owner, unconfined; main.ts always passes the
   * job's sandbox.
   */
  sandbox?: Sandbox;
}

export function cliAdapter(spec: CliSpec, opts: CliAdapterOptions = {}): Adapter {
  const isolation = opts.isolation ?? 'cgroup';
  if (isolation === 'cgroup') checkScopes();
  const sandbox = opts.sandbox && confines(opts.sandbox) ? opts.sandbox : undefined;
  if (sandbox) checkSandbox(sandbox);
  return {
    name: spec.name,
    ...(spec.moduleHash === undefined ? {} : { moduleHash: spec.moduleHash }),
    async start(req, signal) {
      // systemd mangles characters outside this set (a space becomes \x20), so the scope would be
      // created under a different name than scopePath() computes and cgroup.kill would go nowhere.
      if (isolation === 'cgroup' && !/^[A-Za-z0-9:_.-]{1,200}$/.test(req.runId)) {
        return failed(`run ID ${JSON.stringify(req.runId.slice(0, 40))} is not usable as a systemd unit name`);
      }
      let [command, args] = [spec.command, spec.args];
      let tmp: string | undefined;
      if (sandbox) {
        // By its real path: the PATH entry is often a symlink in a directory that is not bound
        // (~/.local/bin here), and binding that directory would expose every tool in it.
        const found = executables(spec.command, req.cwd)[0];
        if (!found) return failed(`${spec.command} not found on PATH`);
        const bin = realpathSync(found);
        const home = homedir();
        const inHome = (paths: string[]) => paths.map((p) => join(home, p)).filter((p) => existsSync(p));
        // Beside the cwd, so in runsDir on disk: the run's own corner, not the shared RAM /tmp (A-038).
        tmp = join(dirname(req.cwd), `${req.runId}-tmp`);
        mkdirSync(tmp);
        // A reviewer's cwd is the verify checkout: what it reads must stay the commit (08-d).
        const writes = opts.writes ?? req.role === 'developer';
        [command, args] = wrap(sandbox, {
          cwd: req.cwd, write: writes ? [req.cwd] : [], read: [dirname(bin), ...(spec.bind ?? []), ...(writes ? [] : [req.cwd]), ...inHome(spec.config.read)],
          overlay: inHome(spec.config.overlay), writeOver: inHome(spec.config.write ?? []), network: true, home, tmp,
        }, bin, spec.args);
      }
      try {
        const run = spawnRuntime({
          command,
          args,
          prompt: spec.input ? spec.input(req) : req.prompt,
          cwd: req.cwd,
          graceMs: opts.graceMs,
          maxOutputBytes: opts.maxOutputBytes,
          scope: isolation === 'cgroup' ? `sf-${req.runId}` : undefined,
        });
        signal.addEventListener('abort', () => run.cancel(), { once: true });
        const r = await run;
        return outcome(spec, r);
      } finally {
        if (tmp) removeTmp(tmp);
      }
    },
  };
}

/**
 * The PID namespace died with the run, so nothing writes in its /tmp any more. The run may have
 * locked what it wrote or left a chain past PATH_MAX, which Node's path-based walk cannot reach
 * (08-c adversarial); coreutils walk relative to each directory and follow no symlink. Neither
 * throws: a leftover sits on disk in runsDir, and the run's outcome stands.
 */
function removeTmp(tmp: string): void {
  spawnSync('chmod', ['-R', 'u+rwX', '--', tmp]);
  const rm = spawnSync('rm', ['-rf', '--', tmp], { encoding: 'utf8' });
  // A trace for the owner, so a growing runsDir has a reason.
  if (rm.status !== 0) console.error(`could not remove ${tmp}: ${rm.error?.message ?? rm.stderr.trim()}`);
}

// Fail at construction, not on the first run: a machine without a user systemd is a setup
// problem, and a silent fallback would hide the 03-b escape on exactly that machine. The probe
// runs a throwaway scope exactly as spawnRuntime will and checks, from inside it, that the path
// spawnRuntime computes is the scope's real cgroup and that its cgroup.kill is writable.
export function checkScopes(): void {
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
  // Read-only is enough for a -p run; writable, every run leaves project and plugin state behind.
  config: { read: ['.claude', '.claude.json'], overlay: [] },
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
  // pi takes a lock file beside settings.json before it reads its key, so read-only fails. OpenAI
  // rotates refresh tokens, so a refresh pi wrote only into the overlay spends the stored token
  // and loses its replacement: auth.json stays writable (08-g, A-068). Removing it logs pi out
  // after the next refresh.
  config: { read: [], overlay: ['.pi'], write: ['.pi/agent/auth.json'] },
  parse(stdout, stderr, exitCode) {
    const events = stdout.split('\n').map(parseJson).filter((e) => e !== undefined);
    const session = events.find((e) => e.type === 'session');
    const sessionId = typeof session?.id === 'string' ? session.id : undefined;
    // Errors are plain text on stderr and the stream just stops; a session line proves nothing.
    if (!events.some((e) => e.type === 'agent_end')) {
      return failed(`pi: ${firstLine(stderr) || `run ended without agent_end (exit ${exitCode})`}`);
    }
    const turn = events.filter((e) => e.type === 'turn_end').at(-1);
    // An error turn (a failed login refresh, say) still ends with agent_end and exit 0 (04-f).
    if (turn?.message?.stopReason === 'error') {
      const why = typeof turn.message.errorMessage === 'string' ? firstLine(turn.message.errorMessage) : '';
      return failed(`pi: ${why || 'run ended with stopReason error'}`);
    }
    const content: any[] = Array.isArray(turn?.message?.content) ? turn.message.content : [];
    const text = content.filter((c) => c?.type === 'text').map((c) => String(c.text ?? '')).join('');
    return claimFrom(text, sessionId);
  },
};

/**
 * A runtime the owner adds as one TypeScript file (A-074, Q7): the whole RunRequest as JSON on
 * stdin, one RunOutcome as JSON on stdout, under the controller's own node. The controller's
 * normalise turns any other shape into a failed run. Only the module's directory is bound, so a
 * module that imports from above it fails inside bwrap: it must be bundled into one file. Reads
 * the module now, so a missing file is refused before any run.
 */
export function extensionSpec(name: string, module: string): CliSpec {
  const moduleHash = createHash('sha256').update(readFileSync(module)).digest('hex');
  return {
    name,
    command: process.execPath,
    args: [module],
    input: (req) => JSON.stringify(req),
    bind: [dirname(module)],
    moduleHash,
    config: { read: [], overlay: [] },
    parse(stdout, stderr, exitCode) {
      if (exitCode !== 0) return failed(`${name} exited ${exitCode}: ${firstLine(stderr) || firstLine(stdout) || 'no output'}`);
      try {
        const o = JSON.parse(stdout) as RunOutcome;
        // The module's own reason is bounded as a CLI's is; any other shape is left to normalise.
        return o?.status === 'failed' && typeof o.reason === 'string' ? failed(o.reason) : o;
      } catch (err) {
        return failed(`${name} stdout is not JSON: ${String(err)}`);
      }
    },
  };
}

/**
 * Developer runs need tools on (05-a). Claude's allow list is scoped to the worktree: Edit and
 * Write by path, Bash to the git subcommands a commit needs. Under -p nothing can prompt, so a
 * tool outside the list is denied and the run ends on a missing commit or claim. A function of
 * the clone because the path rules are absolute. `--restricted` loads no settings file at all:
 * the owner's user and local allow rules would join this grant (05-a adversarial), and a
 * `.claude/settings.json` committed in the repository or written by the developer could add
 * allow rules and hooks (05-b adversarial). `--strict-mcp-config`: a `.mcp.json` in the clone
 * is the repository's, not the owner's.
 */
export function claudeDeveloper(worktree: string): CliSpec {
  // A single leading slash in a path rule is relative to the project; `//` is the filesystem root.
  // Probed 2026-10-16: `Write(/var/tmp/.../**)` denied every write, `Write(//var/tmp/.../**)` allows them.
  // No `git log` or `git diff`: both take --output=<path> and write anywhere (05-a adversarial).
  const allowed = ['Read', 'Glob', 'Grep', `Edit(/${worktree}/**)`, `Write(/${worktree}/**)`,
    ...['add', 'commit', 'status', 'rev-parse'].map((sub) => `Bash(git ${sub}:*)`)];
  // --restricted also removes Bash unless --tools names it (live run 2026-10-16: the developer
  // wrote the file and could not commit); the allow list still scopes Bash to the git subcommands.
  return { ...claude, args: ['-p', '--output-format', 'json', '--no-session-persistence', '--restricted', '--strict-mcp-config', '--tools', 'Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', '--allowedTools', ...allowed] };
}

/**
 * pi has no path or command scoping: bash is unrestricted inside the scope, and the sandbox is the
 * containment (08-c). --no-approve: project-local .pi files in the clone are the repository's.
 */
export const piDeveloper: CliSpec = { ...pi, args: ['-p', '--mode', 'json', '--no-session', '--no-approve', '--tools', 'read,edit,write,bash'] };

/**
 * Reviewers read; they never run anything (06-b, A-030). The controller already ran the checks,
 * and a reviewer with a shell would run candidate code again as the owner, outside any scope.
 * `--restricted` loads no user, project or local settings file and confines the file tools to
 * the cwd: without it a `.claude/settings.json` committed in the candidate adds hooks that run
 * at session start as the owner (probed 2026-10-16: the hook ran under `--setting-sources
 * project`, not under `--restricted`), and Read could reach the developer's worktree next door.
 */
export const claudeReviewer: CliSpec = {
  ...claude,
  // --strict-mcp-config: a project .mcp.json in the checkout is the candidate's; --restricted alone would load it (06-c).
  args: ['-p', '--output-format', 'json', '--no-session-persistence', '--restricted', '--strict-mcp-config', '--allowedTools', 'Read', 'Glob', 'Grep'],
};

/**
 * pi's read-only tools; no bash. --no-approve: project-local .pi files (extensions, skills, settings) are the candidate's and must not load, whatever trust the owner saved for a parent directory (06-c).
 * --no-context-files: the candidate's AGENTS.md and CLAUDE.md reach the reviewer only quoted in the prompt (06-c, 08-d).
 */
export const piReviewer: CliSpec = { ...pi, args: ['-p', '--mode', 'json', '--no-session', '--no-approve', '--no-context-files', '--tools', 'read,grep,find,ls'] };
