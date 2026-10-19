// Ticket 10-a: the runtime contract kit, run as a user would, from a test file of its own.
// The kit files are named *.kit.ts so `npm test` does not pick them up as tests itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Without NODE_TEST_CONTEXT: the outer runner sets it, and a child that sees it skips its files.
const { NODE_TEST_CONTEXT: _, ...env } = process.env;
const kit = (file: string) => spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(import.meta.dirname, 'kits', file)], { encoding: 'utf8', timeout: 60_000, env });

test('runtimeKit passes against the fixture extension runtime', () => {
  const r = kit('good.kit.ts');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# pass [1-9]/);
  assert.match(r.stdout, /# fail 0/);
  // The developer and reviewer cases reach the completed path, not only a failed outcome.
  assert.equal(r.stdout.match(/^\s*# outcome completed$/gm)?.length, 2, r.stdout);
});

test('runtimeKit passes a completed outcome whose sessionId is undefined, which the controller accepts', () => {
  const r = kit('no-session.kit.ts');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# fail 0/);
});

test('runtimeKit fails against an extension that prints JSON outside the RunOutcome union', () => {
  const r = kit('weird.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# fail [1-9]/);
  assert.match(r.stdout, /RunOutcome/);
});
