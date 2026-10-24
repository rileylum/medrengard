import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';

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
/** Launch a command with bounded output and process-group cancellation. */
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

  // `detached` puts the child in its own process group so cancel can signal the whole tree:
  // a CLI with tools on spawns grandchildren, and one of them holding our stdout pipe would
  // otherwise keep `close` from firing after the child itself is dead.
  const child = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  const signalGroup = (sig: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, sig); } catch { /* group already gone */ }
  };
  const killTree = () => signalGroup('SIGKILL');
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
      // After a cancel or overflow nothing a surviving descendant writes is wanted.
      if (status !== 'exited') { signalGroup('SIGKILL'); dropPipes(); }
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
      signalGroup('SIGKILL');
      dropPipes();
      return;
    }
    status = 'cancelled';
    stop();
  };
  return run;
}
