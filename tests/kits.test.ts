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

test('runtimeKit fails a completed outcome whose claim is undefined, which the controller reads as no claim', () => {
  const r = kit('no-claim.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /not a RunOutcome/);
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

// Ticket 10-c: the command-stage kit.
test('commandKit passes against the fixture check, with every case run', () => {
  const r = kit('command-good.kit.ts');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# pass 5$/m);
  assert.match(r.stdout, /# fail 0$/m);
});

for (const [file, kase] of [
  ['command-lenient.kit.ts', 'lenient: the failing change gives FAIL'],
  ['command-strict.kit.ts', 'strict: the passing change gives PASS'],
  ['command-forge.kit.ts', 'forge: the command writes nothing outside outputDir and the checkout'],
  ['command-forge-stage.kit.ts', 'forge-stage: the command writes nothing outside outputDir and the checkout'],
  ['command-net.kit.ts', 'net: with network unset, a connection from the stage fails'],
]) {
  test(`commandKit fails ${file.slice(8, -7)}: ${kase.slice(kase.indexOf(':') + 2)}`, () => {
    const r = kit(file);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^not ok \\d+ - ${kase}$`, 'm'), r.stdout);
    assert.match(r.stdout, /# fail 1$/m, r.stdout);
  });
}

// Ticket 10-e: a grant stage must report the head it acted on.
test('commandKit passes a grant stage that writes the head, with the network case skipped', () => {
  const r = kit('command-grant.kit.ts');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok \d+ - grant: the stage writes the request's head to outputDir\/head/m);
  assert.match(r.stdout, /# pass 5$/m);
  assert.match(r.stdout, /# skipped 1$/m);
});

test('commandKit fails a grant stage that does not write the head: the head case, and the passing change with it', () => {
  const r = kit('command-nohead.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^not ok \d+ - nohead: the stage writes the request's head to outputDir\/head$/m, r.stdout);
  assert.match(r.stdout, /^not ok \d+ - nohead: the passing change gives PASS$/m, r.stdout);
  assert.match(r.stdout, /no head file in outputDir/, r.stdout);
  assert.match(r.stdout, /# fail 2$/m, r.stdout);
});

// Ticket 10-d: the observer kit.

test('observerKit passes the comment-only example on a comment-only change and on a code change', () => {
  const r = kit('observe-good.kit.ts');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok \d+ - comments: a comment-only change is accepted$/m);
  assert.match(r.stdout, /^ok \d+ - comments: a code change is left for the owner$/m);
  assert.match(r.stdout, /# fail 0/);
});

test('observerKit fails an observer that throws on an unknown event', () => {
  const r = kit('observe-throws.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /not ok \d+ - throws: an event of an unknown type, with unknown fields, makes the observer neither throw nor act/);
  assert.match(r.stdout, /unknown event/);
  assert.match(r.stdout, /# fail 1$/m);
});

test('observerKit fails an observer that acts on an unknown event', () => {
  const r = kit('observe-acts.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /not ok \d+ - acts: an event of an unknown type, with unknown fields, makes the observer neither throw nor act/);
  assert.match(r.stdout, /# fail 1$/m);
});

test('observerKit fails an observer that throws when a command is refused', () => {
  const r = kit('observe-unguarded.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /not ok \d+ - unguarded: a refused command does not make the observer throw/);
  assert.match(r.stdout, /# fail 1$/m);
});

test('observerKit fails an observer whose actions differ from a case\'s expected ones', () => {
  const r = kit('observe-eager.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok \d+ - eager: a comment-only change is accepted$/m);
  assert.match(r.stdout, /not ok \d+ - eager: a code change is left for the owner/);
  assert.match(r.stdout, /# fail 1$/m);
});

test('observerKit fails an observer that acts or throws on an unknown event only once the cycle has a head (10-d adversarial)', () => {
  const r = kit('observe-late.kit.ts');
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /not ok \d+ - late-acts: an event of an unknown type, with unknown fields, makes the observer neither throw nor act/);
  assert.match(r.stdout, /not ok \d+ - late-throws: an event of an unknown type, with unknown fields, makes the observer neither throw nor act/);
  assert.match(r.stdout, /unknown event after a head/);
  assert.match(r.stdout, /# fail 2$/m);
});
