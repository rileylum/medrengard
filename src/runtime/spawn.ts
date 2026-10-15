// Ticket 03-a: launch a runtime CLI as a child process, capture what it does, cancel it.
// A throwaway probe helper. Not an adapter interface (that is 04-a); no retries, no streaming.
import { spawn } from 'node:child_process';

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
  let killTimer: NodeJS.Timeout | undefined;

  const child = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let markReady!: () => void;
  const ready = new Promise<void>((res) => (markReady = res));

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
    child.on('close', (code, signal) => finish(cancelled ? 'cancelled' : 'exited', code, signal));
  });

  const run = result as Run;
  run.ready = ready;
  run.cancel = () => {
    if (cancelled || child.exitCode !== null) return;
    cancelled = true;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), graceMs);
  };
  return run;
}
