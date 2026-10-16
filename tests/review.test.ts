// Ticket 06-b: one fresh-context reviewer run per review stage, through execute, with the prompt
// built from the store and the 06-a checkout and evidence. Offline the fixture CLI plays the
// reviewer; live (RUNTIME_SPIKE=1) the real claude and pi do, one standard review each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventStore } from '../src/store.ts';
import { claude, claudeReviewer, cliAdapter, pi, piReviewer, type CliSpec } from '../src/runtime/cli-adapter.ts';
import { execute } from '../src/controller.ts';
import { develop, type Job } from '../src/developer.ts';
import { verify } from '../src/verify.ts';
import { review } from '../src/review.ts';
import { fakeAdapter } from './fake-adapter.ts';

const LIVE = process.env.RUNTIME_SPIKE === '1';
mkdirSync('/var/tmp/software_factory', { recursive: true });
const dir = mkdtempSync('/var/tmp/software_factory/sf-review-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...a], { cwd, encoding: 'utf8' }).trim();

const fixture = join(import.meta.dirname, 'fixtures', 'fake-cli.ts');
const fake = (spec: CliSpec, kase: string, variant = 'ok') =>
  cliAdapter({ ...spec, command: process.execPath, args: [fixture, spec.name, kase, variant] }, { isolation: 'process-group' });
const AGENTS = '# Scratch rules\n\nNever delete README.md.\n';

let n = 0;
/** A scratch repository with AGENTS.md, taken to STANDARD_REVIEW by the fixture developer and a passing check. */
async function reviewable() {
  const root = join(dir, String(n++));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# scratch\n');
  writeFileSync(join(repo, 'AGENTS.md'), AGENTS);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'initial');
  const store = new EventStore(join(root, 'events.sqlite'));
  const runsDir = join(root, 'runs');
  const job: Job = {
    workId: 'w1', ticket: 'TICKET: create done.txt and commit it.', repo,
    checks: [{ name: 'file', command: ['sh', '-c', 'echo "done.txt is there"; test -f done.txt'] }, { name: 'warn', command: ['sh', '-c', 'echo "a warning" >&2'] }],
  };
  const dev = await develop(store, fake(claude, 'commit'), job, { deadlineMs: 20_000, runsDir });
  assert.equal(dev.cycle.stage, 'VERIFYING', dev.cycle.escalation);
  const ver = await verify(store, dev.cycle.cycleId, job, { deadlineMs: 20_000, runsDir, isolation: 'process-group' });
  assert.equal(ver.cycle.stage, 'STANDARD_REVIEW', ver.cycle.escalation);
  return { repo, store, runsDir, job, cycleId: dev.cycle.cycleId, head: ver.cycle.candidate!.head, base: ver.cycle.candidate!.base, checkout: ver.worktree, evidenceDir: ver.evidenceDir };
}
const opts = (runsDir: string) => ({ deadlineMs: 20_000, runsDir });

for (const spec of [claude, pi]) {
  test(`${spec.name} fixture: a standard PASS then an adversarial PASS take the cycle to AWAITING_ACCEPTANCE`, async () => {
    const { store, runsDir, job, cycleId, head } = await reviewable();
    const first = await review(store, fake(spec, 'verdict', 'pass'), cycleId, job, opts(runsDir));
    assert.equal(first.stage, 'ADVERSARIAL_REVIEW', first.escalation);
    assert.deepEqual([first.standard, first.adversarial], [1, 0]);
    // Reviewer runs have no claim event, so the Run list stays the developer's; the verdict's run ID is consumed.
    const verdict = first.history.at(-1)!.event as { type: string; runId: string };
    assert.deepEqual(verdict, { type: 'verdict', runId: verdict.runId, head, verdict: 'PASS', findings: [] });
    assert.ok(first.consumed.includes(verdict.runId));
    const second = await review(store, fake(spec, 'verdict', 'pass'), cycleId, job, opts(runsDir));
    assert.equal(second.stage, 'AWAITING_ACCEPTANCE', second.escalation);
    assert.deepEqual([second.standard, second.adversarial], [1, 1]);
    assert.equal(second.consumed.length, 3);
    assert.deepEqual(store.load(cycleId), second);
    store.close();
  });
}

test('verdict variants: fail returns to DEVELOPING with findings; stale is counted and escalates; no block is run_failed', async () => {
  {
    const { store, runsDir, job, cycleId, head } = await reviewable();
    const c = await review(store, fake(claude, 'verdict', 'fail'), cycleId, job, opts(runsDir));
    assert.equal(c.stage, 'DEVELOPING', c.escalation);
    assert.equal(c.standard, 1);
    assert.deepEqual((c.history.at(-1)!.event as { findings?: string[] }).findings, ['[major] done.txt:1 — fixture finding']);
    assert.equal(c.candidate!.head, head);
    store.close();
  }
  {
    const { store, runsDir, job, cycleId } = await reviewable();
    const c = await review(store, fake(pi, 'verdict', 'stale'), cycleId, job, opts(runsDir));
    assert.equal(c.stage, 'ESCALATED');
    assert.equal(c.standard, 1);
    assert.match(c.escalation ?? '', /stale SHA/);
    store.close();
  }
  {
    const { store, runsDir, job, cycleId } = await reviewable();
    const c = await review(store, fake(claude, 'verdict', 'noblock'), cycleId, job, opts(runsDir));
    assert.equal(c.stage, 'ESCALATED');
    assert.equal(c.standard, 0);
    assert.equal(c.history.at(-1)!.event.type, 'run_failed');
    assert.match(c.escalation ?? '', /no claim block/);
    store.close();
  }
});

test('the prompt carries the role, ticket, SHAs, instructions from the commit, event results, diff, evidence and the output rule; cwd is the checkout', async () => {
  const { store, runsDir, job, cycleId, head, base, checkout, evidenceDir } = await reviewable();
  // A big evidence file is attached cut, never whole.
  writeFileSync(join(evidenceDir, 'warn.stdout'), 'A'.repeat(40_000) + 'MIDDLE' + 'Z'.repeat(40_000));
  // The result line comes from the verification event, not the file a later check could rewrite.
  writeFileSync(join(evidenceDir, 'file.exit'), 'exit 1\n');
  const adapter = fakeAdapter({ outcome: { status: 'completed', claim: { head, verdict: 'PASS' } } });
  const c = await review(store, adapter, cycleId, job, { ...opts(runsDir), instructions: ['AGENTS.md', 'MISSING.md'] });
  assert.equal(c.stage, 'ADVERSARIAL_REVIEW', c.escalation);
  const [req] = adapter.requests;
  assert.equal(req!.cwd, checkout);
  assert.equal(req!.role, 'standard_reviewer');
  const p = req!.prompt;
  assert.match(p, /standard reviewer/i);
  assert.match(p, /TICKET: create done\.txt and commit it\./);
  assert.match(p, new RegExp(`^Candidate SHA: ${head}$`, 'm'));
  assert.match(p, new RegExp(`^Base SHA: ${base}$`, 'm'));
  assert.ok(p.includes(AGENTS.trim()), 'AGENTS.md content from the commit');
  assert.match(p, /MISSING\.md: not present/);
  assert.match(p, /file: PASS/);
  assert.match(p, /warn: PASS/);
  assert.match(p, /\+\+\+ b\/done\.txt/);
  assert.match(p, /done\.txt is there/);
  assert.match(p, /a warning/);
  assert.match(p, /---- EVIDENCE warn\.exit ----\nexit 0/);
  assert.match(p, /---- EVIDENCE file\.exit ----\nexit 1/);
  assert.match(p, /```json\n\{"head": "<candidate sha>", "verdict": "PASS" \| "FAIL", "findings": \["<file:line — finding>"\]\}\n```/);
  assert.ok(!p.includes('MIDDLE'), 'the middle of a big evidence file is cut');
  assert.match(p, /characters cut/);
  assert.ok(p.includes('A'.repeat(1000)) && p.includes('Z'.repeat(1000)), 'head and tail kept');
  // Adversarial role once the cycle has moved on.
  const adv = fakeAdapter({ outcome: { status: 'completed', claim: { head, verdict: 'PASS' } } });
  await review(store, adv, cycleId, job, opts(runsDir));
  assert.equal(adv.requests[0]!.role, 'adversarial_reviewer');
  assert.match(adv.requests[0]!.prompt, /adversarial reviewer/i);
  store.close();
});

test('review throws and appends nothing outside a review stage, without the checkout at the head, or without evidence', async () => {
  const { repo, store, runsDir, job, cycleId, head, base, checkout, evidenceDir } = await reviewable();
  const before = store.events(cycleId).length;
  const adapter = fakeAdapter('hang', 'hang', 'hang', 'hang', 'hang');
  // Checkout moved off the head.
  git(checkout, 'checkout', '-q', '--detach', base);
  await assert.rejects(review(store, adapter, cycleId, job, opts(runsDir)), /not at the candidate/);
  // Checkout gone.
  git(repo, 'worktree', 'remove', '--force', checkout);
  await assert.rejects(review(store, adapter, cycleId, job, opts(runsDir)), /checkout/);
  // Checkout back at the head, evidence gone.
  git(repo, 'worktree', 'add', '-q', '--detach', checkout, head);
  rmSync(join(evidenceDir, 'file.stdout'));
  await assert.rejects(review(store, adapter, cycleId, job, opts(runsDir)), /file\.stdout is missing/);
  rmSync(evidenceDir, { recursive: true });
  await assert.rejects(review(store, adapter, cycleId, job, opts(runsDir)), /evidence/);
  assert.equal(adapter.requests.length, 0);
  assert.equal(store.events(cycleId).length, before);
  store.close();
  // Wrong stage and unknown cycle.
  const other = await reviewable();
  await assert.rejects(review(other.store, adapter, 'no-such-cycle', other.job, opts(other.runsDir)), /not open/);
  other.store.append(other.cycleId, { type: 'cancel' });
  await assert.rejects(review(other.store, adapter, other.cycleId, other.job, opts(other.runsDir)), /CANCELLED/);
  other.store.close();
  // The realistic misuse: review before verify.
  const early = await (async () => {
    const root = join(dir, String(n++));
    const repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'README.md'), '# scratch\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'initial');
    const store = new EventStore(join(root, 'events.sqlite'));
    const job: Job = { workId: 'w1', ticket: 'x', repo, checks: [] };
    const dev = await develop(store, fake(claude, 'commit'), job, { deadlineMs: 20_000, runsDir: join(root, 'runs') });
    return { store, job, cycleId: dev.cycle.cycleId, runsDir: join(root, 'runs') };
  })();
  await assert.rejects(review(early.store, adapter, early.cycleId, early.job, opts(early.runsDir)), /VERIFYING/);
  assert.equal(adapter.requests.length, 0);
  early.store.close();
});

test('after a standard FAIL and a fix run, the prompt carries the verification for the new head, not the old one', async () => {
  const { store, runsDir, job, cycleId, head, base } = await reviewable();
  const failed = await review(store, fake(claude, 'verdict', 'fail'), cycleId, job, opts(runsDir));
  assert.equal(failed.stage, 'DEVELOPING');
  // The fix run: the fixture commits again in the cycle's worktree (a different first line, so a different done.txt).
  const worktree = join(runsDir, cycleId);
  const fixed = await execute(store, cycleId, fake(claude, 'commit'), { role: 'developer', prompt: 'Fix: change done.txt and commit it.', cwd: worktree }, { deadlineMs: 20_000, base });
  assert.equal(fixed.stage, 'VERIFYING', fixed.escalation);
  const head2 = fixed.candidate!.head;
  assert.notEqual(head2, head);
  const job2: Job = { ...job, checks: [{ name: 'second', command: ['sh', '-c', 'test -f done.txt'] }] };
  const ver = await verify(store, cycleId, job2, { deadlineMs: 20_000, runsDir, isolation: 'process-group' });
  assert.equal(ver.cycle.stage, 'STANDARD_REVIEW', ver.cycle.escalation);
  const adapter = fakeAdapter({ outcome: { status: 'completed', claim: { head: head2, verdict: 'PASS' } } });
  const c = await review(store, adapter, cycleId, job2, opts(runsDir));
  assert.equal(c.stage, 'ADVERSARIAL_REVIEW', c.escalation);
  assert.equal(c.standard, 2);
  const p = adapter.requests[0]!.prompt;
  assert.match(p, new RegExp(`^Candidate SHA: ${head2}$`, 'm'));
  assert.match(p, /second: PASS/);
  assert.ok(!/^file: PASS$/m.test(p), 'the first verification is not quoted');
  assert.ok(!/^warn: PASS$/m.test(p));
  store.close();
});

test('reviewer specs are read-only: claude gets Read, Glob, Grep under project settings; pi gets read, grep, find, ls', () => {
  assert.equal(claudeReviewer.name, 'claude');
  const i = claudeReviewer.args.indexOf('--allowedTools');
  assert.ok(i > 0);
  assert.deepEqual(claudeReviewer.args.slice(i + 1), ['Read', 'Glob', 'Grep']);
  assert.ok(!claudeReviewer.args.some((a) => /^(Bash|Edit|Write)/.test(a)));
  assert.ok(!claudeReviewer.args.includes('--tools'));
  assert.ok(!claudeReviewer.args.includes('--dangerously-skip-permissions'));
  // --restricted: no user, project or local settings file (a committed .claude/settings.json cannot add hooks), file tools confined to the cwd.
  assert.ok(claudeReviewer.args.includes('--restricted'));
  assert.ok(!claudeReviewer.args.includes('--setting-sources'));
  assert.equal(claudeReviewer.parse, claude.parse);
  assert.equal(piReviewer.name, 'pi');
  assert.ok(!piReviewer.args.includes('--no-tools'));
  assert.deepEqual(piReviewer.args.slice(piReviewer.args.indexOf('--tools'), piReviewer.args.indexOf('--tools') + 2), ['--tools', 'read,grep,find,ls']);
  assert.equal(piReviewer.parse, pi.parse);
});

// Two paid runs, read-only tools; a 120 s deadline each. The developer is the fixture: the point is the reviewer.
for (const [name, spec] of [['claude', claudeReviewer], ['pi', piReviewer]] as const) {
  test(`live ${name}: a real standard review records a verdict for the candidate SHA`, { timeout: 150_000 }, async (t) => {
    if (!LIVE) return void t.skip('RUNTIME_SPIKE is not set');
    const { store, runsDir, job, cycleId, head } = await reviewable();
    const c = await review(store, cliAdapter(spec), cycleId, job, { deadlineMs: 120_000, runsDir });
    assert.notEqual(c.stage, 'ESCALATED', c.escalation);
    assert.ok(['ADVERSARIAL_REVIEW', 'DEVELOPING'].includes(c.stage), c.stage);
    const e = c.history.at(-1)!.event as { type: string; head?: string };
    assert.equal(e.type, 'verdict');
    assert.equal(e.head, head);
    assert.equal(c.standard, 1);
    store.close();
  });
}
