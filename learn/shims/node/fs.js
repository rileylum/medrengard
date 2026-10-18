// node:fs for src/ modules running in the browser: a small made-up machine in memory. Arch-style
// merged /usr (/bin, /lib are symlinks), the owner's runtime CLIs under ~/.local, and the runs
// directory. Demos add to it with `vfs.file`, `vfs.dir` and `vfs.link`.
const nodes = new Map();
const norm = (p) => '/' + String(p).split('/').filter((s) => s && s !== '.').join('/');
const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/';

export const vfs = {
  nodes,
  dir(p, mode = 0o755) { p = norm(p); if (p !== '/') vfs.dir(parent(p)); if (!nodes.has(p)) nodes.set(p, { type: 'dir', mode }); return vfs; },
  file(p, content = '', mode = 0o644) { p = norm(p); vfs.dir(parent(p)); nodes.set(p, { type: 'file', content, mode }); return vfs; },
  link(p, target) { p = norm(p); vfs.dir(parent(p)); nodes.set(p, { type: 'symlink', target, mode: 0o777 }); return vfs; },
  remove(p) { p = norm(p); for (const k of [...nodes.keys()]) if (k === p || k.startsWith(p + '/')) nodes.delete(k); },
};

vfs.dir('/usr/bin').dir('/usr/lib').dir('/etc').dir('/opt').dir('/run/systemd/resolve').dir('/tmp')
  .link('/bin', 'usr/bin').link('/sbin', 'usr/bin').link('/lib', 'usr/lib').link('/lib64', 'usr/lib')
  .file('/usr/bin/git', '', 0o755).file('/usr/bin/node', '', 0o755).file('/usr/bin/npm', '', 0o755).file('/usr/bin/bwrap', '', 0o755)
  .file('/usr/bin/sh', '', 0o755).file('/usr/bin/true', '', 0o755)
  .file('/home/owner/.local/share/claude/versions/2.1.0', '', 0o755).link('/home/owner/.local/bin/claude', '/home/owner/.local/share/claude/versions/2.1.0')
  .file('/home/owner/.local/share/pi/bin/pi', '', 0o755).link('/home/owner/.local/bin/pi', '/home/owner/.local/share/pi/bin/pi')
  .dir('/home/owner/.claude').file('/home/owner/.claude.json', '{}').dir('/home/owner/.pi/agent')
  .dir('/home/owner/projects/todo-cli').dir('/var/tmp/software_factory/runs');

const enoent = (p, op) => Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), { code: 'ENOENT' });

// Follows symlinks in every component; returns the real path, or undefined if a component is missing.
function real(p, depth = 0) {
  if (depth > 40) return undefined;
  const parts = norm(p).split('/').filter(Boolean);
  let cur = '';
  for (let i = 0; i < parts.length; i++) {
    const next = cur + '/' + parts[i];
    const n = nodes.get(next);
    if (!n) return undefined;
    if (n.type === 'symlink') {
      const t = n.target.startsWith('/') ? n.target : (cur || '') + '/' + n.target;
      const r = real(t + (i + 1 < parts.length ? '/' + parts.slice(i + 1).join('/') : ''), depth + 1);
      return r;
    }
    cur = next;
  }
  return cur || '/';
}

const stats = (n) => ({
  mode: (n.type === 'dir' ? 0o40000 : n.type === 'symlink' ? 0o120000 : 0o100000) | n.mode,
  size: n.content?.length ?? 0,
  isDirectory: () => n.type === 'dir', isFile: () => n.type === 'file', isSymbolicLink: () => n.type === 'symlink',
});

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
export const existsSync = (p) => real(p) !== undefined;
export function lstatSync(p) { const n = nodes.get(norm(p)); if (!n) throw enoent(p, 'lstat'); return stats(n); }
export function statSync(p) { const r = real(p); if (!r) throw enoent(p, 'stat'); return stats(nodes.get(r) ?? { type: 'dir', mode: 0o755 }); }
export function readlinkSync(p) { const n = nodes.get(norm(p)); if (n?.type !== 'symlink') throw enoent(p, 'readlink'); return n.target; }
export function realpathSync(p) { const r = real(p); if (!r) throw enoent(p, 'realpath'); return r; }
export function accessSync(p, mode = 0) {
  const r = real(p); if (!r) throw enoent(p, 'access');
  const n = nodes.get(r);
  if (mode & 1 && !(n.mode & 0o111)) throw Object.assign(new Error(`EACCES: permission denied, access '${p}'`), { code: 'EACCES' });
}
export function readFileSync(p, enc) { const r = real(p); const n = r && nodes.get(r); if (!n || n.type !== 'file') throw enoent(p, 'open'); return enc ? n.content : n.content; }
export function writeFileSync(p, content) { vfs.file(p, String(content)); }
export function mkdirSync(p) { vfs.dir(p); }
export function rmSync(p) { vfs.remove(p); }
export function chmodSync(p, mode) { const n = nodes.get(norm(p)); if (n) n.mode = mode & 0o7777; }
export function readdirSync(p) {
  const d = norm(p), pre = d === '/' ? '/' : d + '/';
  return [...nodes.keys()].filter((k) => k.startsWith(pre) && k !== d && !k.slice(pre.length).includes('/')).map((k) => k.slice(pre.length));
}
export default { constants, existsSync, lstatSync, statSync, readlinkSync, realpathSync, accessSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, readdirSync };
