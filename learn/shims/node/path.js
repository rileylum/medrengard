// node:path (posix) for src/ modules running in the browser.
export const sep = '/';
export const delimiter = ':';
export function normalize(p) {
  const abs = p.startsWith('/'), out = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') { if (out.length && out.at(-1) !== '..') out.pop(); else if (!abs) out.push('..'); } else out.push(s);
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
}
export const join = (...ps) => normalize(ps.filter(Boolean).join('/'));
export function resolve(...ps) {
  let r = '';
  for (const p of ps) r = p.startsWith('/') ? p : r + '/' + p;
  return normalize(r.startsWith('/') ? r : '/home/owner/' + r);
}
export const isAbsolute = (p) => p.startsWith('/');
export const dirname = (p) => { const n = normalize(p); const i = n.lastIndexOf('/'); return i <= 0 ? (n.startsWith('/') ? '/' : '.') : n.slice(0, i); };
export const basename = (p, ext) => { const b = normalize(p).split('/').at(-1); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; };
export const relative = (from, to) => {
  const a = resolve(from).split('/').filter(Boolean), b = resolve(to).split('/').filter(Boolean);
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
};
export default { sep, delimiter, normalize, join, resolve, isAbsolute, dirname, basename, extname, relative, posix: undefined };
