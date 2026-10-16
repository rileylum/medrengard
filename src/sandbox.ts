// Ticket 08-a: the sandbox seam (A-035). A stage builds a Policy for what it spawns; `wrap` turns
// the command into the argv that runs it inside the owner's chosen backend. spawnRuntime is not
// involved: the wrapped argv goes into the systemd scope like any other command. Docker, a VM or
// a cloud runner would be further cases of `wrap` and `checkSandbox`.
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, existsSync, lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

/** Owner-supplied with the job. `none` runs candidate code as the owner, unconfined: scratch repositories only (A-029). */
export interface Sandbox {
  backend: 'bwrap' | 'none';
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
  network: boolean;
  /** Mounted as a temporary overlay: writes succeed inside and are dropped. pi must write its config directory but must not keep the writes (08-c-findings.md). */
  overlay?: string[];
  /** HOME inside. Default /tmp; a runtime finds its config under the owner's real home. */
  home?: string;
  /** Host directory bound at /tmp. Default a tmpfs, which is RAM on this machine until the command exits. */
  tmp?: string;
}

// The system directories every command needs: binaries, libraries, the dynamic loader and /etc.
// Not $HOME, /var, /run or /srv: those hold the owner's files and sockets. On merged-/usr distros
// /bin, /sbin, /lib and /lib64 are symlinks and are recreated as symlinks.
const SYSTEM = ['/usr', '/etc', '/opt', '/bin', '/sbin', '/lib', '/lib64'];
const BACKENDS = ['bwrap', 'none'];
const RESOLVE = '/run/systemd/resolve';

export function wrap(sandbox: Sandbox, policy: Policy, command: string, args: string[]): [string, string[]] {
  if (sandbox.backend === 'none') return [command, args];
  if (sandbox.backend !== 'bwrap') throw new Error(`sandbox backend ${JSON.stringify(sandbox.backend)} is not bwrap or none`);
  const lang = process.env.LANG;
  return ['bwrap', [
    // --die-with-parent: the scope's cgroup.kill already ends everything, but in process-group
    // isolation a killed bwrap must still take the sandbox with it. --unshare-all includes the
    // PID namespace, so a background child dies when the command's init does.
    '--die-with-parent', '--unshare-all', ...(policy.network ? ['--share-net'] : []),
    // A new session: the command cannot push input into the controller's terminal (TIOCSTI).
    '--new-session',
    // The controller's environment may hold tokens; the command gets a path, a home and a locale.
    '--clearenv', '--setenv', 'PATH', process.env.PATH ?? '/usr/bin', '--setenv', 'HOME', policy.home ?? '/tmp', ...(lang ? ['--setenv', 'LANG', lang] : []),
    '--proc', '/proc', '--dev', '/dev', ...(policy.tmp ? ['--bind', policy.tmp, '/tmp'] : ['--tmpfs', '/tmp']),
    ...SYSTEM.flatMap(systemBind),
    // /etc/resolv.conf is a symlink into /run/systemd/resolve under systemd-resolved: no DNS without it.
    ...(policy.network && existsSync(RESOLVE) ? ['--ro-bind', RESOLVE, RESOLVE] : []),
    ...binds([...(sandbox.read ?? []), ...policy.read], policy.write),
    ...(policy.overlay ?? []).flatMap((p) => ['--overlay-src', p, '--tmp-overlay', p]),
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
 * Whether `path` (absolute) can be executed from inside the sandbox: the path itself and what it
 * resolves to both sit under a bound root. A check whose binary is only outside is MISSING, not a
 * FAIL from bwrap's "execvp: No such file", and the owner learns which directory to declare.
 */
export function reachable(sandbox: Sandbox, policy: Policy, path: string): boolean {
  if (sandbox.backend === 'none') return true;
  const roots = [...SYSTEM, ...(sandbox.read ?? []), ...policy.read, ...policy.write].flatMap((r) => {
    try { return [r, realpathSync(r)]; } catch { return [r]; }
  });
  const under = (p: string) => roots.some((r) => p === r || p.startsWith(r.endsWith('/') ? r : `${r}/`));
  let real: string;
  try { real = realpathSync(path); } catch { return false; }
  return under(path) && under(real);
}

/**
 * Fail at setup, not on the first check: a machine without unprivileged user namespaces, or a
 * mistyped read path, is a setup problem, and running anyway would either run unconfined or
 * fail every check with bwrap's own error as if the candidate had failed it.
 */
export function checkSandbox(sandbox: Sandbox): void {
  if (!BACKENDS.includes(sandbox?.backend)) throw new Error(`sandbox backend ${JSON.stringify(sandbox?.backend)} is not bwrap or none`);
  if (sandbox.backend === 'none') return;
  for (const p of sandbox.read ?? []) {
    if (typeof p !== 'string' || !isAbsolute(p)) throw new Error(`sandbox read path ${JSON.stringify(p)} is not absolute`);
    if (!existsSync(p)) throw new Error(`sandbox read path ${p} does not exist`);
  }
  const probe = spawnSync('bwrap', ['--die-with-parent', '--unshare-all', ...SYSTEM.flatMap(systemBind), '--', 'true'], { timeout: 5000 });
  const why = probe.signal ? `probe timed out after 5 s (${probe.signal})` : probe.error?.message
    ?? (probe.status !== 0 ? probe.stderr.toString().trim() || `exit ${probe.status}` : undefined);
  if (why !== undefined) {
    throw new Error(`sandbox bwrap cannot start (${why}); install bubblewrap and allow unprivileged user namespaces, or set the sandbox backend to "none" for scratch repositories only`);
  }
}

// The shell's rule: a name with a slash is a path (relative to the checkout), anything else is looked up on PATH.
export function executables(command: string, cwd: string): string[] {
  if (command === '') return [];
  const candidates = command.includes('/') || isAbsolute(command)
    ? [resolve(cwd, command)]
    : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, command));
  return candidates.filter((p) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } });
}

const SLASH = Buffer.from('/');

/**
 * Owner read, write and search back on every directory and file under `path`, symlinks not
 * followed. A check may lock what it rewrote; git then skips the path with a warning and exit 0
 * (08-a adversarial). Only the owner bits change, never the executable bit git compares.
 */
export function restoreAccess(path: string | Buffer): void {
  // lstat: a symlink is neither a directory nor short of its 0777 bits, so it is never followed.
  const st = lstatSync(path);
  const want = st.isDirectory() ? 0o700 : 0o600;
  if ((st.mode & want) !== want) chmodSync(path, (st.mode & 0o7777) | want);
  // Names as bytes: one that is not valid UTF-8 does not survive a string, and the path built
  // from it names nothing (08-d adversarial).
  if (st.isDirectory()) for (const entry of readdirSync(path, { encoding: 'buffer' })) restoreAccess(Buffer.concat([Buffer.from(path), SLASH, entry]));
}
