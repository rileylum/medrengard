import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readlinkSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** Owner-supplied sandbox configuration for an agent. */
export interface Sandbox {
  /** Only `bwrap` confines candidate execution. */
  backend: string;
  /** Absolute paths bound read-only for everything this job spawns, e.g. a toolchain outside /usr. */
  read?: string[];
  /** Share the host network; off by default. */
  network?: boolean;
  /** Names of variables copied from the controller's environment; each must be set at setup. */
  env?: string[];
}

/** Built by the stage that spawns. Paths are absolute. */
export interface Policy {
  cwd: string;
  /** Bound read-write. */
  write: string[];
  /** Bound read-only, on top of the system directories and Sandbox.read. */
  read: string[];
}

// The system directories every command needs: binaries, libraries, the dynamic loader and /etc.
// Not $HOME, /var, /run or /srv: those hold the owner's files and sockets. On merged-/usr distros
// /bin, /sbin, /lib and /lib64 are symlinks and are recreated as symlinks.
const SYSTEM = ['/usr', '/etc', '/opt', '/bin', '/sbin', '/lib', '/lib64'];

// The sandbox sets these itself; the owner cannot override them.
const RESERVED = ['PATH', 'HOME', 'LANG'];

/** Build bubblewrap arguments with declared mounts, and no network unless declared. */
function wrap(sandbox: Sandbox, policy: Policy, command: string, args: string[]): [string, string[]] {
  return ['bwrap', [
    // Parent death ends bwrap; --unshare-all includes the PID namespace, so its
    // descendants die with the namespace init even after starting a new session.
    '--die-with-parent', '--unshare-all', ...(sandbox.network ? ['--share-net'] : []),
    // A new session: the command cannot push input into the controller's terminal (TIOCSTI).
    '--new-session',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    ...SYSTEM.flatMap(systemBind),
    ...binds([...(sandbox.read ?? []), ...policy.read], policy.write),
    // bwrap's own root is a tmpfs; read-only, so nothing outside the binds takes writes (or RAM).
    '--remount-ro', '/',
    '--chdir', policy.cwd, '--', command, ...args,
  ]];
}

// A later mount over a path hides the earlier one, so roots go parent first and each nested root
// keeps its own mode either way round: a read root inside a write root stays read-only, a write
// root inside a read root stays writable (standard review 1). For the same path, read-only wins.
function binds(read: string[], write: string[]): string[] {
  const depth = (p: string) => resolve(p).split('/').filter(Boolean).length;
  return [...write.map((p) => ({ p, flag: '--bind', ro: 0 })), ...read.map((p) => ({ p, flag: '--ro-bind', ro: 1 }))]
    .sort((a, b) => depth(a.p) - depth(b.p) || a.ro - b.ro)
    .flatMap(({ p, flag }) => [flag, p, p]);
}

// The controller's environment may hold tokens: bwrap and the command get a path, a home, a locale and
// the declared names. Values go through the environment, not argv, which any local user can read.
function environment(sandbox: Sandbox): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin', HOME: '/tmp' };
  if (process.env.LANG) env.LANG = process.env.LANG;
  for (const name of sandbox.env ?? []) env[name] = process.env[name];
  return env;
}

function systemBind(path: string): string[] {
  let st;
  try { st = lstatSync(path); } catch { return []; }
  if (st.isSymbolicLink()) return ['--symlink', readlinkSync(path), path];
  return ['--ro-bind', path, path];
}

/** Validate agent definitions and probe the platform once, before work can spend budget. */
export function checkSandbox(...sandboxes: Sandbox[]): void {
  for (const sandbox of sandboxes) {
    if (sandbox?.backend !== 'bwrap') throw new Error('sandbox backend must be bwrap');
    for (const p of sandbox.read ?? []) {
      if (typeof p !== 'string' || !isAbsolute(p)) throw new Error(`sandbox read path ${JSON.stringify(p)} is not absolute`);
      if (!existsSync(p)) throw new Error(`sandbox read path ${p} does not exist`);
    }
    for (const name of sandbox.env ?? []) {
      if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`sandbox env ${JSON.stringify(name)} is not a variable name`);
      if (RESERVED.includes(name)) throw new Error(`sandbox env ${name} is set by the sandbox`);
      if (process.env[name] === undefined) throw new Error(`sandbox env ${name} is not set in the controller environment`);
    }
  }
  const probe = spawnSync('bwrap', ['--die-with-parent', '--unshare-all', ...SYSTEM.flatMap(systemBind), '--', 'true'], { timeout: 5000 });
  const why = probe.signal ? `probe timed out after 5 s (${probe.signal})` : probe.error?.message
    ?? (probe.status !== 0 ? probe.stderr.toString().trim() || `exit ${probe.status}` : undefined);
  if (why !== undefined) {
    throw new Error(`sandbox bwrap cannot start (${why}); install bubblewrap and allow unprivileged user namespaces`);
  }
}

/** The bounded output and termination of a command executed in a sandbox. */
export interface RunResult {
  status: 'exited' | 'cancelled' | 'failed' | 'overflow';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  wallMs: number;
}

/** Execute a confined command, ending its namespace on cancellation or output overflow. */
export function execute(sandbox: Sandbox, policy: Policy, argv: string[], signal: AbortSignal, input = ''): Promise<RunResult> {
  const [command, args] = wrap(sandbox, policy, argv[0], argv.slice(1));
  const child = spawn(command, args, { cwd: policy.cwd, env: environment(sandbox), stdio: ['pipe', 'pipe', 'pipe'] });
  const started = Date.now();
  let status: RunResult['status'] = 'exited';
  const output = { stdout: '', stderr: '' };
  // lazy: each stream is capped at 8 MiB; stream artifacts when a workflow needs larger output.
  const maxOutputBytes = 8 * 1024 * 1024;
  const cancel = () => {
    if (status !== 'exited' || child.exitCode !== null || child.signalCode !== null) return;
    status = 'cancelled';
    // Killing bwrap ends its PID namespace, including descendants that called setsid.
    child.kill('SIGKILL');
  };
  for (const stream of ['stdout', 'stderr'] as const) {
    let bytes = 0;
    child[stream].setEncoding('utf8').on('data', (chunk: string) => {
      if (status === 'overflow') return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxOutputBytes) {
        status = 'overflow';
        output.stdout = '';
        output.stderr = `${stream} exceeded ${maxOutputBytes} bytes`;
        child.kill('SIGKILL');
      } else output[stream] += chunk;
    });
  }
  // Early exit may close stdin before the request has been consumed.
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  return new Promise(resolve => {
    const finish = (exitCode: number | null, exitSignal: NodeJS.Signals | null) => {
      signal.removeEventListener('abort', cancel);
      resolve({ status, exitCode, signal: exitSignal, ...output, wallMs: Date.now() - started });
    };
    child.on('error', error => { status = 'failed'; output.stderr += String(error); finish(null, null); });
    // close drains both streams after bubblewrap and its namespace have ended.
    child.on('close', finish);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
