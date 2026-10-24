// A stage builds a Policy; `wrap` turns its command into sandbox argv for the process supervisor.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readlinkSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** Owner-supplied sandbox configuration for an agent. */
export interface Sandbox {
  /** Only `bwrap` confines candidate execution. */
  backend: string;
  /** Absolute paths bound read-only for everything this job spawns, e.g. a toolchain outside /usr. */
  read?: string[];
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

/** Whether the sandbox names the supported confining backend. */
export function confines(sandbox: Sandbox): boolean {
  return sandbox?.backend === 'bwrap';
}

/** Wrap a command in bubblewrap with declared mounts and no network. */
export function wrap(sandbox: Sandbox, policy: Policy, command: string, args: string[]): [string, string[]] {
  if (!confines(sandbox)) throw new Error('sandbox backend must be bwrap');
  const lang = process.env.LANG;
  return ['bwrap', [
    // Parent death ends bwrap; --unshare-all includes the PID namespace, so its
    // descendants die with the namespace init even after starting a new session.
    '--die-with-parent', '--unshare-all',
    // A new session: the command cannot push input into the controller's terminal (TIOCSTI).
    '--new-session',
    // The controller's environment may hold tokens; the command gets a path, a home and a locale.
    '--clearenv',
    '--setenv', 'PATH', process.env.PATH ?? '/usr/bin', '--setenv', 'HOME', '/tmp', ...(lang ? ['--setenv', 'LANG', lang] : []),
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

function systemBind(path: string): string[] {
  let st;
  try { st = lstatSync(path); } catch { return []; }
  if (st.isSymbolicLink()) return ['--symlink', readlinkSync(path), path];
  return ['--ro-bind', path, path];
}

/**
 * Fail at setup, not on the first check: a machine without unprivileged user namespaces, or a
 * mistyped read path, is a setup problem, and running anyway would either run unconfined or
 * fail every check with bwrap's own error as if the candidate had failed it.
 */
export function checkSandbox(sandbox: Sandbox): void {
  if (!confines(sandbox)) throw new Error('sandbox backend must be bwrap');
  for (const p of sandbox.read ?? []) {
    if (typeof p !== 'string' || !isAbsolute(p)) throw new Error(`sandbox read path ${JSON.stringify(p)} is not absolute`);
    if (!existsSync(p)) throw new Error(`sandbox read path ${p} does not exist`);
  }
  const probe = spawnSync('bwrap', ['--die-with-parent', '--unshare-all', ...SYSTEM.flatMap(systemBind), '--', 'true'], { timeout: 5000 });
  const why = probe.signal ? `probe timed out after 5 s (${probe.signal})` : probe.error?.message
    ?? (probe.status !== 0 ? probe.stderr.toString().trim() || `exit ${probe.status}` : undefined);
  if (why !== undefined) {
    throw new Error(`sandbox bwrap cannot start (${why}); install bubblewrap and allow unprivileged user namespaces`);
  }
}
