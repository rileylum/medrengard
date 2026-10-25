// Shipped code outside the core (workflows, extensions, CLI, scripts) uses only the public API;
// tests are exempt because sandbox tests exercise the core from inside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SHIPPED = ['workflows', 'extensions', 'cli', 'scripts'];
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

test('shipped code outside src/ imports the core only through src/index.ts', () => {
  const violations: string[] = [];
  for (const dir of SHIPPED.map(d => join(root, d)).filter(existsSync)) {
    for (const name of readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(n => /\.[cm]?ts$/.test(n))) {
      const file = join(dir, name);
      for (const [, specifier] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        if (!specifier.startsWith('.')) continue;
        const target = relative(root, resolve(dirname(file), specifier));
        if (target.startsWith('src/') && target !== 'src/index.ts') violations.push(`${relative(root, file)} imports ${target}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
