// Ticket 11-b: every cycle path is named once, in src/layout.ts. recover (11-f) finds a cycle's
// clone, checkout and evidence from its ID alone, so these paths are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cyclePaths, DEFAULT_RUNS_DIR, mirrorPath, runsRoot, storeFile } from '../src/layout.ts';

const id = '0b6f1c9e-0000-4000-8000-000000000000';
const head = 'a'.repeat(40);

test('the default runs folder is on disk, not the RAM /tmp', () => {
  assert.equal(DEFAULT_RUNS_DIR, '/var/tmp/software_factory/runs');
  assert.equal(runsRoot(undefined), DEFAULT_RUNS_DIR);
});

test('runsRoot is absolute: a relative runsDir resolves against the working directory', () => {
  assert.equal(runsRoot('runs'), resolve('runs'));
  assert.equal(runsRoot('/x/runs/'), '/x/runs');
});

test('the store file sits at the top of the runs folder, resolved no further than it is given', () => {
  assert.equal(storeFile('/x/runs'), '/x/runs/events.sqlite');
  // main.ts names the store in its messages by the runsDir the owner wrote.
  assert.equal(storeFile('runs'), 'runs/events.sqlite');
});

for (const [given, root] of [[undefined, DEFAULT_RUNS_DIR], ['/x/runs', '/x/runs'], ['runs', resolve('runs')]] as const) {
  test(`cyclePaths under ${given ?? 'the default'}`, () => {
    const p = cyclePaths(given, id);
    assert.equal(p.clone, join(root, id));
    assert.equal(p.branch, `sf/${id}`);
    assert.equal(p.checkout, join(root, `${id}-verify`));
    assert.equal(p.evidence(head, 'VERIFYING'), join(root, 'evidence', head, 'VERIFYING'));
  });
}

// Ticket 11-b2: one mirror per repository, keyed by its real path (A-133).
test('mirrorPath: one bare mirror per repository under mirrors/, the same through a symlink, another for another repository', (t) => {
  mkdirSync('/var/tmp/software_factory', { recursive: true });
  const dir = mkdtempSync('/var/tmp/software_factory/sf-layout-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const r of ['a', 'b']) mkdirSync(join(dir, r));
  symlinkSync(join(dir, 'a'), join(dir, 'link'));
  const a = mirrorPath('/x/runs', join(dir, 'a'));
  assert.match(a, /^\/x\/runs\/mirrors\/[0-9a-f]{16}\.git$/);
  assert.equal(mirrorPath('/x/runs', join(dir, 'link')), a);
  assert.equal(mirrorPath('/x/runs', join(dir, 'a') + '/'), a);
  assert.notEqual(mirrorPath('/x/runs', join(dir, 'b')), a);
  assert.equal(mirrorPath(undefined, join(dir, 'a')), join(DEFAULT_RUNS_DIR, a.slice('/x/runs/'.length)));
});
