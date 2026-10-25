// Documentation stays true to the tree: links resolve, named files exist, and names linked to the
// entry point are exported from it. Historical records describe deleted code and are exempt from
// the file-name check, not from the link check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const DOCS = ['README.md', ...readdirSync(join(root, 'docs'), { recursive: true, encoding: 'utf8' }).filter(n => n.endsWith('.md')).map(n => join('docs', n))];
const HISTORICAL = /^docs\/(decisions\.md|research\/|refactor\/|architecture\/|work\/\d+-)/;
const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const PATH = /`([\w.-]+(?:\/[\w.-]+)+\/?)`/g;
// Branch names (AGENTS.md) look like paths without an extension.
const BRANCH = /^(feat|docs)\/[\w-]+$/;
const ENTRY = join(root, 'src/index.ts');

// Fenced blocks hold shell and TypeScript examples, not references.
const prose = (file: string) => readFileSync(join(root, file), 'utf8').replace(/^```[\s\S]*?^```/gm, '');
const target = (file: string, href: string) => resolve(root, dirname(file), decodeURI(href.split('#')[0]));
const local = (href: string) => !/^[a-z][a-z+.-]*:/i.test(href) && !href.startsWith('#');

test('every relative link in the README and docs/ resolves', () => {
  const missing = DOCS.flatMap(file => [...prose(file).matchAll(LINK)]
    .filter(([, , href]) => local(href) && !existsSync(target(file, href)))
    .map(([, , href]) => `${file} -> ${href}`));
  assert.deepEqual(missing, []);
});

// GitHub's heading ids: lower case, punctuation dropped, spaces to hyphens, repeats numbered.
function anchors(file: string): Set<string> {
  const seen = new Map<string, number>();
  return new Set([...prose(file).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)].map(([, heading]) => {
    const id = heading.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(id) ?? 0; seen.set(id, n + 1);
    return n ? `${id}-${n}` : id;
  }));
}

test('every heading link in the README and docs/ names a heading that exists', () => {
  const missing = DOCS.flatMap(file => [...prose(file).matchAll(LINK)]
    .map(([, , href]) => href)
    .filter(href => local(href) || href.startsWith('#'))
    .filter(href => href.includes('#'))
    .map(href => ({ href, doc: href.startsWith('#') ? join(root, file) : target(file, href) }))
    .filter(({ href, doc }) => doc.endsWith('.md') && existsSync(doc) && !anchors(doc.slice(root.length + 1)).has(decodeURIComponent(href.split('#')[1])))
    .map(({ href }) => `${file} -> ${href}`));
  assert.deepEqual(missing, []);
});

test('every repository path named in a current doc exists', () => {
  const missing = DOCS.filter(file => !HISTORICAL.test(file)).flatMap(file => [...prose(file).matchAll(PATH)]
    .filter(([, path]) => !BRANCH.test(path) && !existsSync(join(root, path)) && !existsSync(target(file, path)))
    .map(([, path]) => `${file} -> ${path}`));
  assert.deepEqual(missing, []);
});

test('a name linked to src/index.ts is exported from it', () => {
  const source = readFileSync(ENTRY, 'utf8');
  const exported = new Set([
    ...[...source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap(([, names]) => names.split(',').map(n => n.trim().split(/\s+as\s+/).pop()!)),
    ...[...source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|interface|type)\s+(\w+)/g)].map(([, name]) => name),
  ]);
  const unexported = DOCS.flatMap(file => [...prose(file).matchAll(LINK)]
    .filter(([, text, href]) => /^`[\w.]+`$/.test(text) && local(href) && target(file, href) === ENTRY)
    .map(([, text]) => `${file} -> ${text.slice(1, -1)}`)
    .filter(entry => !exported.has(entry.split(' -> ')[1].split('.')[0])));
  assert.deepEqual(unexported, []);
});
