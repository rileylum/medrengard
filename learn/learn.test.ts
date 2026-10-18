// The guide (learn/) reads the factory's code live, so a change in src/ can break a page without
// touching it. These tests catch that offline: every live code reference and live function still
// resolves, every link and demo exists, and every browser stand-in still exports what src/ imports
// from the module it replaces. They also pin the server's two rules: nothing outside the
// repository or hidden is served, and .ts is served with its types stripped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { extract, parseRef } from './refs.js';
import { handler, local } from './serve.ts';

const ROOT = resolve(import.meta.dirname, '..');
const LEARN = join(ROOT, 'learn');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const pages = readdirSync(LEARN).filter((f) => f.endsWith('.html'));
const scripts = ['', 'demos', 'shims', 'shims/node'].flatMap((d) => readdirSync(join(LEARN, d)).filter((f) => f.endsWith('.js')).map((f) => join('learn', d, f)));

test('every live code reference names a definition that exists', () => {
  const bad: string[] = [];
  for (const page of pages) {
    for (const [, ref] of read(`learn/${page}`).matchAll(/data-code="([^"]+)"/g)) {
      const { path, names } = parseRef(ref!);
      if (!existsSync(join(ROOT, path))) { bad.push(`${page}: ${path} does not exist`); continue; }
      for (const n of names) { const r = extract(read(path), n); if (r.error) bad.push(`${page}: ${ref} — ${r.error}`); }
    }
  }
  assert.deepEqual(bad, []);
});

test('every function a demo cuts out of src/ is still there', () => {
  const bad: string[] = [];
  for (const s of scripts) {
    for (const [, path, name] of read(s).matchAll(/liveFunction\('([^']+)', '([^']+)'/g)) {
      const r = extract(read(path!), name!);
      if (r.error) bad.push(`${s}: ${path}#${name} — ${r.error}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('every live document, demo, page link and glossary word exists', () => {
  const words = read('learn/words.html');
  const bad: string[] = [];
  for (const page of pages) {
    const html = read(`learn/${page}`);
    for (const [, p] of html.matchAll(/data-md="([^"]+)"/g)) if (!existsSync(join(ROOT, p!))) bad.push(`${page}: data-md ${p}`);
    for (const [, d] of html.matchAll(/data-demo="([^"]+)"/g)) if (!existsSync(join(LEARN, 'demos', `${d}.js`))) bad.push(`${page}: demo ${d}`);
    for (const [, w] of html.matchAll(/class="w" href="words\.html#([^"]+)"/g)) if (!words.includes(`id="${w}"`)) bad.push(`${page}: word ${w}`);
    for (const [, target, id] of html.matchAll(/href="([a-z-]+\.html)(?:#([^"]+))?"/g)) {
      if (!pages.includes(target!)) { bad.push(`${page}: link to ${target}`); continue; }
      if (id && !read(`learn/${target}`).includes(`id="${id}"`)) bad.push(`${page}: link to ${target}#${id}`);
    }
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) if (!html.includes(`id="${id}"`)) bad.push(`${page}: anchor #${id}`);
  }
  assert.deepEqual(bad, []);
});

test('every room is on the map and every slide has a level', async () => {
  const { ROOMS } = await import('./rooms.js');
  const rooms = ROOMS.map((r: { file: string }) => r.file);
  assert.deepEqual(pages.filter((p) => !['index.html', 'words.html'].includes(p)).sort(), [...rooms].sort());
  for (const page of rooms) {
    const slides = [...read(`learn/${page}`).matchAll(/<section class="slide"([^>]*)>/g)].map((m) => m[1]!);
    assert.ok(slides.length > 0, `${page} has no slides`);
    for (const s of slides) assert.match(s, /id="[^"]+" data-lv="[123]"/, `${page}: ${s}`);
  }
});

// Named imports, without the type-only ones: those are erased before the browser sees them. Only
// the import block at the top of a file: shims/world.js holds a fixture repository whose files
// have import lines of their own, inside template strings.
function imports(text: string): { from: string; names: string[] }[] {
  const lines = text.split('\n');
  const end = lines.findIndex((l) => l.trim() && !/^\s*(\/\/|\/\*|\*|import\s)/.test(l));
  text = lines.slice(0, end < 0 ? undefined : end).join('\n');
  return [...text.matchAll(/^import\s+(?!type\s)(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+'([^']+)'/gm)].map((m) => ({
    from: m[3]!,
    names: [...(m[1] ? ['default'] : []), ...(m[2] ?? '').split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('type ')).map((s) => s.split(/\s+as\s+/)[0]!)],
  }));
}
function exported(text: string): Set<string> {
  const names = [...text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/gm)].map((m) => m[1]!);
  for (const [, list] of text.matchAll(/^export\s*\{([^}]*)\}/gm)) names.push(...list!.split(',').map((s) => s.trim().split(/\s+as\s+/).at(-1)!).filter(Boolean));
  if (/^export default /m.test(text)) names.push('default');
  return new Set(names);
}

test('every stand-in exports what the code that runs in the browser imports from it', () => {
  const boot = read('learn/boot.js');
  const map = new Map<string, string>();
  for (const [, from, , to] of boot.matchAll(/'([^']+)': (s \+ )?'([^']+)'/g)) map.set(from!, `learn/shims/${to}`);
  assert.ok(map.size >= 10, 'boot.js import map not found');
  // Every module the guide loads in a page, following the import map, from the demos outward.
  const seen = new Set<string>(), bad: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const { from, names } of imports(read(file))) {
      const target = from.startsWith('node:') || from.startsWith('/') ? from : '/' + join(file, '..', from);
      const mapped = map.get(target);
      const path = mapped ?? target.slice(1);
      if (!mapped && from.startsWith('node:')) { bad.push(`${file}: ${from} has no stand-in`); continue; }
      if (!existsSync(join(ROOT, path))) { bad.push(`${file}: ${from} → ${path} missing`); continue; }
      const has = exported(read(path));
      for (const n of names) if (!has.has(n)) bad.push(`${file} imports ${n} from ${from}; ${path} does not export it`);
      visit(path);
    }
  };
  for (const s of scripts.filter((s) => s.includes('/demos/') || s.includes('/shims/'))) visit(s);
  assert.ok(seen.has('src/run.ts') && seen.has('src/controller.ts') && seen.has('src/lifecycle.ts'), 'the simulator no longer loads src/');
  assert.deepEqual(bad, []);
});

test('the server serves the repository read-only, types stripped, and nothing hidden or outside', async () => {
  assert.equal(local(ROOT, '/../etc/passwd'), undefined);
  assert.equal(local(ROOT, '/.git/config'), undefined);
  assert.equal(local(ROOT, '/src/%2e%2e/%2e%2e/etc/passwd'), undefined);
  assert.equal(local(ROOT, '/learn/%00'), undefined);
  const server = createServer(handler(ROOT)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const js = await fetch(`${base}/src/lifecycle.ts`);
    assert.match(js.headers.get('content-type')!, /javascript/);
    const body = await js.text();
    assert.doesNotMatch(body, /export type Stage/);
    const line = (t: string) => t.split('\n').findIndex((l) => l.startsWith('export function apply('));
    assert.equal(line(body), line(read('src/lifecycle.ts')), 'stripping keeps every line where it was');
    assert.equal(await (await fetch(`${base}/src/lifecycle.ts?raw`)).text(), read('src/lifecycle.ts'));
    assert.equal((await fetch(`${base}/.git/HEAD`)).status, 404);
    assert.equal((await fetch(`${base}/learn/`, { redirect: 'manual' })).status, 200);
    assert.equal((await fetch(`${base}/learn/`, { method: 'POST' })).status, 405);
    assert.deepEqual(await (await fetch(`${base}/_ls/docs/work`)).json(), readdirSync(join(ROOT, 'docs/work')).sort());
  } finally {
    server.close();
  }
});
