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
  // The developer case reaches the fixture's commit path and the reviewer case its verdict path.
  assert.deepEqual(r.stdout.match(/^\s*# outcome .*$/gm)?.map((l) => l.trim()).sort(), [
    '# outcome completed, claim keys head, artifacts',
    '# outcome completed, claim keys head, verdict, findings',
  ], r.stdout);
});

test('runtimeKit passes a completed outcome whose sessionId or claim field is undefined, which the controller accepts', () => {
  const r = kit('no-session.kit.ts');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# fail 0/);
});

test('runtimeKit passes a claim with a null prototype, which the controller accepts', () => {
  const r = kit('null-proto.kit.ts');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# fail 0/);
});

test('runtimeKit fails an adapter that rejects for the reviewer role the controller sends', () => {
  const r = kit('reviewer-role.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /not ok \d+ - reviewer-role: a standard_reviewer request/);
});

test('runtimeKit fails an adapter whose name is empty', () => {
  const r = kit('nameless.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /not ok \d+ - nameless: the adapter has a non-empty name/);
  assert.match(r.stdout, /# fail 1$/m);
});

test('runtimeKit fails an adapter that does not settle after an abort', () => {
  const r = kit('deaf.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /not ok \d+ - deaf: an aborted run settles within/);
  assert.match(r.stdout, /start did not settle within 10000 ms of the abort/);
  assert.match(r.stdout, /# fail 1$/m);
});

test('runtimeKit fails against an extension that prints JSON outside the RunOutcome union', () => {
  const r = kit('weird.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# fail [1-9]/);
  assert.match(r.stdout, /RunOutcome/);
});
