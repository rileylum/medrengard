// Ticket 03-a: launch a runtime CLI as a child process, capture what it does, cancel it.
// A throwaway probe helper. Not an adapter interface (that is 04-a); no retries, no streaming.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';

export interface SpawnOptions {
  command: string;
  args: string[];
  /** Written to the child's stdin, then stdin is closed. */
  prompt: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** How long SIGTERM gets before SIGKILL on cancel. */
  graceMs?: number;
}

export interface RunResult {
  /** `exited`: the child ended on its own. `cancelled`: we signalled it. `failed`: it never started. */
  status: 'exited' | 'cancelled' | 'failed';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  wallMs: number;
}

export interface Run extends Promise<RunResult> {
  /** Resolves on the first stdout byte; lets a test cancel only once the child is really running. */
  ready: Promise<void>;
  cancel(): void;
}

export function spawnRuntime(opts: SpawnOptions): Run {
  const graceMs = opts.graceMs ?? 5000;
  const started = Date.now();
  let stdout = '';
  let stderr = '';
  let cancelled = false;
  let exited = false;
  let killTimer: NodeJS.Timeout | undefined;

  let markReady!: () => void;
  const ready = new Promise<void>((res) => (markReady = res));

  // Node reports a missing cwd as ENOENT on the binary, which a controller would read as
  // "runtime not installed". Check it first so the two stay distinguishable.
  try {
    if (!statSync(opts.cwd).isDirectory()) throw new Error('not a directory');
  } catch (err) {
    markReady();
    const run = Promise.resolve<RunResult>({
      status: 'failed', exitCode: null, signal: null, stdout: '',
      stderr: `cwd ${opts.cwd}: ${(err as Error).message}`, wallMs: Date.now() - started,
    }) as Run;
    run.ready = ready;
    run.cancel = () => {};
    return run;
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
  const dropPipes = () => { child.stdout.destroy(); child.stderr.destroy(); };

  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
    markReady();
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  // EPIPE if the child exits before reading its prompt; that is the child's business, not an error here.
  child.stdin.on('error', () => {});
  child.stdin.end(opts.prompt);

  const result = new Promise<RunResult>((resolve) => {
    const finish = (status: RunResult['status'], exitCode: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(killTimer);
      markReady();
      resolve({ status, exitCode, signal, stdout, stderr, wallMs: Date.now() - started });
    };
    child.on('error', (err) => {
      stderr += String(err);
      finish('failed', null, null);
    });
    child.on('exit', () => {
      exited = true;
      // After a cancel nothing a surviving descendant writes is wanted; stop waiting for the pipes.
      if (cancelled) { signalGroup('SIGKILL'); dropPipes(); }
    });
    // `close` waits for every stdio pipe, so a normal exit still collects the child's last output.
    child.on('close', (code, signal) => finish(cancelled ? 'cancelled' : 'exited', code, signal));
  });

  const run = result as Run;
  run.ready = ready;
  run.cancel = () => {
    if (cancelled) return;
    if (exited) {
      // The child is already dead on its own; only a descendant on the pipe can be holding us.
      signalGroup('SIGKILL');
      dropPipes();
      return;
    }
    cancelled = true;
    signalGroup('SIGTERM');
    killTimer = setTimeout(() => signalGroup('SIGKILL'), graceMs);
  };
  return run;
}
