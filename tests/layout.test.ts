// Ticket 11-b: every cycle path is named once, in src/layout.ts. recover (11-f) finds a cycle's
// clone, checkout and evidence from its ID alone, so these paths are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { cyclePaths, DEFAULT_RUNS_DIR, runsRoot, storeFile } from '../src/layout.ts';

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
