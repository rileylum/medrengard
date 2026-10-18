// The guide's server: `node learn/serve.ts [port]`, then http://127.0.0.1:8077/learn/.
// It serves the repository read-only so the guide can show the code and the docs as they are now,
// and serves every .ts file with its types stripped so a demo can import the factory's own
// modules. `?raw` returns a .ts file as written, for display. Zero dependencies, like the factory.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg',
};

/** Repository path for a URL path, or undefined for anything outside it or hidden (.git, .env). */
export function local(root: string, urlPath: string): string | undefined {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return undefined; }
  if (decoded.includes('\0')) return undefined;
  if (decoded.split('/').some((s) => s.startsWith('.'))) return undefined;
  const p = resolve(root, '.' + decoded);
  return p === root || p.startsWith(root + sep) ? p : undefined;
}

export function handler(root = ROOT) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (code: number, type: string, body: string | Buffer) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'read-only\n');
    if (url.pathname === '/') { res.writeHead(302, { location: '/learn/' }); return res.end(); }
    // Directory listings for the demos that read docs/work and src live.
    if (url.pathname.startsWith('/_ls/')) {
      const dir = local(root, url.pathname.slice(4));
      try {
        const names = readdirSync(dir!, { withFileTypes: true }).filter((d) => !d.name.startsWith('.'))
          .map((d) => (d.isDirectory() ? d.name + '/' : d.name)).sort();
        return send(200, TYPES['.json']!, JSON.stringify(names));
      } catch { return send(404, 'text/plain', 'not found\n'); }
    }
    let file = local(root, url.pathname);
    try {
      if (file && statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!file || !statSync(file).isFile()) return send(404, 'text/plain', 'not found\n');
    } catch { return send(404, 'text/plain', 'not found\n'); }
    const ext = extname(file);
    if (ext === '.ts') {
      const source = readFileSync(file, 'utf8');
      if (url.searchParams.has('raw')) return send(200, 'text/plain; charset=utf-8', source);
      // strip, not transform: positions stay where they were, so a demo can cut a function out
      // of the served text by the same line numbers it shows from the raw file.
      try { return send(200, TYPES['.js']!, stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: url.pathname })); }
      catch (err) { return send(500, 'text/plain', `cannot strip ${url.pathname}: ${(err as Error).message}\n`); }
    }
    send(200, TYPES[ext] ?? 'text/plain; charset=utf-8', readFileSync(file));
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // stripTypeScriptTypes warns once per process that it is experimental; the guide knows.
  process.removeAllListeners('warning');
  const port = Number(process.argv[2] ?? 8077);
  createServer(handler()).listen(port, '127.0.0.1', () => console.log(`guide: http://127.0.0.1:${port}/learn/`));
}
