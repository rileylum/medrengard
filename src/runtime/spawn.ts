// Ticket 03-a: launch a runtime CLI as a child process, capture what it does, cancel it.
// Ticket 04-d: optional systemd scope so cancel kills by cgroup membership, and a byte cap on
// the output so no result can approach V8's string cap. No retries, no streaming.
import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

// cgroup v2 only: one line, `0::/path`. Read per spawn, not cached, so a controller that is
// moved between cgroups mid-life still computes the right path.
function ownCgroup(): string {
  return `/sys/fs/cgroup${readFileSync('/proc/self/cgroup', 'utf8').trim().split(':')[2]}`;
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

  // `--scope` makes systemd-run exec the command in its own process, so child.pid is the command
  // and the process group is still ours to signal. `--slice-inherit` puts the scope beside this
  // process's own cgroup, which makes its path known before the child even runs: no /proc read,
  // no window where a fast-exiting child escapes the kill.
  const cgroup = opts.scope ? `${dirname(ownCgroup())}/${opts.scope}.scope` : undefined;
  const [command, args] = opts.scope
    ? ['systemd-run', ['--user', '--scope', '-q', '--slice-inherit', `--unit=${opts.scope}`, '--', opts.command, ...opts.args]]
    : [opts.command, opts.args];

  // `detached` puts the child in its own process group so cancel can signal the whole tree:
  // a CLI with tools on spawns grandchildren, and one of them holding our stdout pipe would
  // otherwise keep `close` from firing after the child itself is dead.
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  const signalGroup = (sig: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, sig); } catch { /* group already gone */ }
  };
  // SIGKILL for everything in the scope, whatever its session or group. The group is signalled
  // too, for the moment before systemd-run has joined the scope and for runs without one.
  const killTree = () => {
    signalGroup('SIGKILL');
    if (cgroup) { try { writeFileSync(`${cgroup}/cgroup.kill`, '1'); } catch { /* scope already gone */ } }
  };
  const dropPipes = () => { child.stdout.destroy(); child.stderr.destroy(); };

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

  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    markReady();
    if (status === 'overflow') return;
    outBytes += Buffer.byteLength(chunk);
    if (outBytes > maxOutputBytes) return overflow('stdout');
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    markReady();
    if (status === 'overflow') return;
    errBytes += Buffer.byteLength(chunk);
    if (errBytes > maxOutputBytes) return overflow('stderr');
    stderr += chunk;
  });
  // EPIPE if the child exits before reading its prompt; that is the child's business, not an error here.
  child.stdin.on('error', () => {});
  child.stdin.end(opts.prompt);

  const result = new Promise<RunResult>((resolve) => {
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      settled = true;
      clearTimeout(killTimer);
      markReady();
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
      // grandchild on the pipe) dies with it; the child's own result is what we report.
      // Without one, only after a cancel is a surviving descendant's output unwanted.
      if (cgroup) { killTree(); dropPipes(); }
      else if (status !== 'exited') { signalGroup('SIGKILL'); dropPipes(); }
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
      killTree();
      dropPipes();
      return;
    }
    status = 'cancelled';
    stop();
  };
  return run;
}
