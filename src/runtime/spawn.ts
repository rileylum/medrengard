// Ticket 03-a: launch a runtime CLI as a child process, capture what it does, cancel it.
// Ticket 04-d: optional systemd scope so cancel kills by cgroup membership, and a byte cap on
// the output so no result can approach V8's string cap. No retries, no streaming.
// Ticket 11-e: optional run folder, so a run whose controller died still leaves its output and
// exit code on disk (A-122).
import { spawn } from 'node:child_process';
import { accessSync, closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

export interface SpawnOptions {
  command: string;
  args: string[];
  /** Written to the child's stdin, then stdin is closed. */
  prompt: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** How long SIGTERM gets before SIGKILL on cancel. */
  graceMs?: number;
  /**
   * Unit name for a transient user systemd scope (`systemd-run --user --scope`). With one, the
   * grace-period kill and the kill after the child's exit go to the scope's `cgroup.kill`, so a
   * descendant that left the process group with setsid dies too (03-b finding). Without one only
   * the process group is signalled. Must be a valid unit name; the caller checks that
   * `systemd-run --user` works on this machine.
   */
  scope?: string;
  /**
   * Cap per stream, in bytes. Crossing it kills the tree and resolves `overflow` with the output
   * dropped: the point is that the result can never be large. Default 8 MiB.
   */
  maxOutputBytes?: number;
  /**
   * An absolute run folder to create (11-e). stdin, stdout and stderr become files in it: the
   * output files are passed to the child as descriptors and a wrapper outside any sandbox pipes
   * the prompt from `stdin`, so no pipe joins this process and the run; the wrapper writes `exit`
   * when the command ends. The result is read back from the files. Must not exist.
   */
  dir?: string;
  /**
   * With `scope`: systemd stops the scope this long after it starts (SIGTERM, then SIGKILL after
   * `graceMs`), so a run whose controller died still ends (11-e). The caller's own deadline is
   * the one that records the outcome; this one is the backstop.
   */
  maxRuntimeMs?: number;
}

export interface RunResult {
  /**
   * `exited`: the child ended on its own. `cancelled`: we signalled it. `failed`: it never started.
   * `overflow`: a stream passed `maxOutputBytes`; the tree was killed and `stdout`/`stderr` are empty.
   */
  status: 'exited' | 'cancelled' | 'failed' | 'overflow';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  wallMs: number;
}

export interface Run extends Promise<RunResult> {
  /** Resolves on the first byte of either stream; lets a test cancel only once the child is really running. */
  ready: Promise<void>;
  cancel(): void;
}

const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024;
// How often a run folder's files are checked for a first byte and for the cap. Output written
// between two checks lands on disk before the run is stopped; readRun's cap still holds.
const POLL_MS = 100;

/**
 * Where `systemd-run --user --scope --slice-inherit --unit=<unit>` puts the scope: beside this
 * process's own cgroup. cgroup v2 only (one line, `0::/path`). Read per call, not cached, so a
 * controller moved between cgroups mid-life still computes the right path.
 */
export function scopePath(unit: string): string {
  return `${dirname(`/sys/fs/cgroup${readFileSync('/proc/self/cgroup', 'utf8').trim().split(':')[2]}`)}/${unit}.scope`;
}

/** The files a run folder holds (11-e). */
export const runFiles = (dir: string) => ({ stdin: join(dir, 'stdin'), stdout: join(dir, 'stdout'), stderr: join(dir, 'stderr'), exit: join(dir, 'exit') });

// Runs outside any sandbox, between the scope and the command. The status goes to a temporary
// name and is renamed, so `exit` is absent or whole. `trap :` rather than `trap ''`: an ignored
// signal stays ignored across exec, so the command would inherit deafness to SIGTERM; a handler
// does not, and it lets the wrapper outlive a SIGTERM to the group long enough to write the status.
// The command reads the kept prompt through a pipe from `cat`, never as the file itself: the run
// owns that file (its uid is the owner's even in a sandbox), so with the file as fd 0 it could
// fchmod it and rewrite it through /proc/self/fd/0 (standard 3). The pipe joins the wrapper and
// the command inside the scope, not this process. The status is written on the command's side of
// the pipe, not after the pipeline: a descendant holding the pipe's read end would keep `cat`, and
// so the whole pipeline, from ending until it did (11-e adversarial). That side is a subshell,
// where a trap with a handler is reset, so it sets its own; without it a cancel's SIGTERM kills it
// before it writes `exit`. Once the command has ended, SIGTERM is ignored outright: `mv` is a
// separate process, and a cancel or systemd's stop that killed it mid-way would leave a finished
// command's status unwritten (11-e2, standard 1). Then it SIGKILLs its own process group, the
// wrapper and `cat` included: whatever the command left running there dies with the run, as a
// scope's cgroup.kill does, and the group is surely the wrapper's while it is alive to signal it.
// The live result takes its exit code from `exit` for that reason.
const WRAPPER = 'trap : TERM; e=$1; i=$2; shift 2; cat "$i" | { trap : TERM; "$@"; s=$?; trap "" TERM; echo "$s" > "$e.tmp" && mv "$e.tmp" "$e"; kill -KILL 0; }';

/**
 * At most `max` bytes of a file, and whether it held more. Never reads past the cap, so a run that
 * wrote far past it while nothing watched costs no more memory than one that stopped at it.
 */
function capped(path: string, max: number): { text: string; over: boolean } {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch { return { text: '', over: false }; }
  try {
    const size = fstatSync(fd).size;
    if (size > max) return { text: '', over: true };
    const buf = Buffer.alloc(size);
    let got = 0;
    while (got < size) { const n = readSync(fd, buf, got, size - got, got); if (n === 0) break; got += n; }
    return { text: buf.subarray(0, got).toString('utf8'), over: false };
  } finally {
    closeSync(fd);
  }
}

function readOutput(dir: string, max: number): Pick<RunResult, 'status' | 'stdout' | 'stderr'> {
  const files = runFiles(dir);
  const out = capped(files.stdout, max);
  const err = capped(files.stderr, max);
  if (out.over || err.over) return { status: 'overflow', stdout: '', stderr: `${out.over ? 'stdout' : 'stderr'} exceeded ${max} bytes` };
  return { status: 'exited', stdout: out.text, stderr: err.text };
}

/**
 * What a finished run left in its folder, read as the live run reads it; undefined while `exit`
 * is absent. For a run whose controller died (11-f). `wallMs` is not known here and is 0.
 */
export function readRun(dir: string, maxOutputBytes = DEFAULT_MAX_OUTPUT): RunResult | undefined {
  let exit: string;
  try { exit = readFileSync(runFiles(dir).exit, 'utf8').trim(); } catch { return undefined; }
  const code = /^\d+$/.test(exit) ? Number(exit) : null;
  return { ...readOutput(dir, maxOutputBytes), exitCode: code, signal: null, wallMs: 0 };
}

export function spawnRuntime(opts: SpawnOptions): Run {
  const graceMs = opts.graceMs ?? 5000;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const started = Date.now();
  let stdout = '';
  let stderr = '';
  let outBytes = 0;
  let errBytes = 0;
  let status: RunResult['status'] = 'exited';
  let exited = false;
  let settled = false;
  let killTimer: NodeJS.Timeout | undefined;

  let markReady!: () => void;
  const ready = new Promise<void>((res) => (markReady = res));

  const neverStarted = (why: string): Run => {
    markReady();
    const run = Promise.resolve<RunResult>({
      status: 'failed', exitCode: null, signal: null, stdout: '', stderr: why, wallMs: Date.now() - started,
    }) as Run;
    run.ready = ready;
    run.cancel = () => {};
    return run;
  };

  // spawn('') throws synchronously; every other failure to start is a resolved `failed`, so this
  // one is too.
  if (opts.command === '') return neverStarted('command is empty');
  // Node reports a missing or unreadable cwd as ENOENT/EACCES on the binary, which a controller
  // would read as "runtime not installed". Check it first so the two stay distinguishable.
  try {
    if (!statSync(opts.cwd).isDirectory()) throw new Error('not a directory');
    accessSync(opts.cwd, constants.R_OK | constants.X_OK);
  } catch (err) {
    return neverStarted(`cwd ${opts.cwd}: ${(err as Error).message}`);
  }

  // The descriptors are the child's from here on; this process closes its copies once spawned.
  let stdio: ['pipe', 'pipe', 'pipe'] | number[] = ['pipe', 'pipe', 'pipe'];
  let [command, args] = [opts.command, opts.args];
  if (opts.dir) {
    // The wrapper resolves `exit` against the run's cwd, this process against its own: only an
    // absolute path names one folder for both.
    if (!isAbsolute(opts.dir)) return neverStarted(`run folder ${opts.dir} is not an absolute path`);
    const files = runFiles(opts.dir);
    try {
      mkdirSync(dirname(opts.dir), { recursive: true });
      // Not recursive: a folder that exists belongs to another run, whose files must not be reused.
      mkdirSync(opts.dir);
      // Read-only, as a record: the run never holds it, the wrapper's `cat` does.
      writeFileSync(files.stdin, opts.prompt, { mode: 0o400 });
      stdio = [openSync('/dev/null', 'r'), openSync(files.stdout, 'wx'), openSync(files.stderr, 'wx')];
    } catch (err) {
      return neverStarted(`run folder ${opts.dir}: ${(err as Error).message}`);
    }
    [command, args] = ['sh', ['-c', WRAPPER, 'sh', files.exit, files.stdin, command, ...args]];
  }

  // On systemd 262 `--scope` makes systemd-run fork the command, not exec it: child.pid is
  // systemd-run, which stays in this process's cgroup, and the command is its child in the same
  // process group inside the scope, so the group is still ours to signal and exit codes propagate.
  // `--slice-inherit` puts the scope beside this process's own cgroup, which makes its path known
  // before the child even runs: no /proc read, no window where a fast-exiting child escapes the kill.
  const cgroup = opts.scope ? scopePath(opts.scope) : undefined;
  const limit = opts.maxRuntimeMs === undefined ? [] : ['-p', `RuntimeMaxSec=${opts.maxRuntimeMs}ms`, '-p', `TimeoutStopSec=${graceMs}ms`];
  if (opts.scope) [command, args] = ['systemd-run', ['--user', '--scope', '-q', '--slice-inherit', ...limit, `--unit=${opts.scope}`, '--', command, ...args]];

  // `detached` puts the child in its own process group so cancel can signal the whole tree:
  // a CLI with tools on spawns grandchildren, and one of them holding our stdout pipe would
  // otherwise keep `close` from firing after the child itself is dead.
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio,
    detached: true,
  });
  for (const fd of stdio) if (typeof fd === 'number') closeSync(fd);
  const signalGroup = (sig: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, sig); } catch { /* group already gone */ }
  };
  // SIGKILL for everything in the scope, whatever its session or group; ENOENT means it is
  // already empty and gone.
  const killScope = () => {
    if (cgroup) { try { writeFileSync(`${cgroup}/cgroup.kill`, '1'); } catch { /* scope already gone */ } }
  };
  // The group is signalled too, for the moment before systemd-run has joined the scope and for
  // runs without one.
  const killTree = () => { signalGroup('SIGKILL'); killScope(); };
  const dropPipes = () => { child.stdout?.destroy(); child.stderr?.destroy(); };

  const stop = () => {
    signalGroup('SIGTERM');
    killTimer = setTimeout(killTree, graceMs);
  };
  const overflow = (stream: string) => {
    if (status !== 'exited' || exited) return;
    status = 'overflow';
    stdout = '';
    stderr = `${stream} exceeded ${maxOutputBytes} bytes`;
    stop();
  };

  // A file cannot signal its first byte or its size, so a run folder is polled for both.
  let poll: NodeJS.Timeout | undefined;
  if (opts.dir) {
    const files = runFiles(opts.dir);
    const size = (path: string) => { try { return statSync(path).size; } catch { return 0; } };
    poll = setInterval(() => {
      const out = size(files.stdout);
      const err = size(files.stderr);
      if (out + err > 0) markReady();
      if (out > maxOutputBytes) overflow('stdout');
      else if (err > maxOutputBytes) overflow('stderr');
    }, POLL_MS);
  } else {
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
      markReady();
      if (status === 'overflow') return;
      outBytes += Buffer.byteLength(chunk);
      if (outBytes > maxOutputBytes) return overflow('stdout');
      stdout += chunk;
    });
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
      markReady();
      if (status === 'overflow') return;
      errBytes += Buffer.byteLength(chunk);
      if (errBytes > maxOutputBytes) return overflow('stderr');
      stderr += chunk;
    });
    // EPIPE if the child exits before reading its prompt; that is the child's business, not an error here.
    child.stdin!.on('error', () => {});
    child.stdin!.end(opts.prompt);
  }

  const result = new Promise<RunResult>((resolve) => {
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      settled = true;
      clearTimeout(killTimer);
      clearInterval(poll);
      markReady();
      // The same reader as readRun, so a received run and one read after its controller died agree.
      // An overflow the poll caught keeps its own reason, and a cancel stays a cancel whatever the
      // run wrote after it.
      if (opts.dir && status === 'exited') {
        const read = readRun(opts.dir, maxOutputBytes);
        if (read) ({ status, stdout, stderr, exitCode, signal } = read);
        // No status written: the wrapper itself was killed, and the child's own end is all there is.
        else ({ status, stdout, stderr } = readOutput(opts.dir, maxOutputBytes));
      }
      resolve({ status, exitCode, signal, stdout, stderr, wallMs: Date.now() - started });
    };
    child.on('error', (err) => {
      status = 'failed';
      stderr += String(err);
      finish(null, null);
    });
    child.on('exit', () => {
      exited = true;
      // Under a scope, whatever the child left running (a worker it re-parented with setsid, a
      // grandchild on the pipe) dies with it. The pipes are left to close on their own: `exit`
      // can fire with the child's last write still unread in the pipe, and destroying it here
      // would cut the tail off a result. The group is not signalled: the child is reaped and its
      // pgid may already be someone else's.
      killScope();
      // After a cancel or overflow nothing a surviving descendant writes is wanted.
      if (status !== 'exited') { if (!cgroup) signalGroup('SIGKILL'); dropPipes(); }
    });
    // `close` waits for every stdio pipe, so a normal exit still collects the child's last output.
    child.on('close', (code, signal) => finish(code, signal));
  });

  const run = result as Run;
  run.ready = ready;
  run.cancel = () => {
    // After resolve the pgid may already belong to another process; signal nothing.
    if (settled || status === 'cancelled' || status === 'overflow') return;
    if (exited) {
      // The child is already dead on its own; only a descendant on the pipe can be holding us.
      // The child is reaped, so under a scope its pgid is not ours to signal; cgroup.kill is.
      if (cgroup) killScope(); else signalGroup('SIGKILL');
      dropPipes();
      return;
    }
    status = 'cancelled';
    stop();
  };
  return run;
}
