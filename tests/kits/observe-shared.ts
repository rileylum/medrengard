// A scratch repository for the observer kit fixtures: a base, a comment-only change and a code change.
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Event } from '../../src/lifecycle.ts';
import type { ObserverCase } from '../../src/kits/observe.ts';

mkdirSync('/var/tmp/software_factory', { recursive: true });
export const repo = mkdtempSync('/var/tmp/software_factory/sf-observe-repo-');
test.after(() => rmSync(repo, { recursive: true, force: true }));
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: repo, encoding: 'utf8' }).trim();
const commit = (text: string) => { writeFileSync(join(repo, 'a.ts'), text); git('add', '.'); git('commit', '-q', '-m', 'x'); return git('rev-parse', 'HEAD'); };
git('init', '-q', '-b', 'main');
export const base = commit('export const a = 1;\n');
export const comment = commit('// a is one\nexport const a = 1;\n');
git('checkout', '-q', base);
export const code = commit('export const a = 2;\n');

export const toAcceptance = (head: string): Event[] => [
  { type: 'claim', runId: 'dev1', base, runtime: 'fake' },
  { type: 'developer_result', runId: 'dev1', head, artifacts: ['x'] },
  { type: 'verification', head, checks: [{ name: 'ok', result: 'PASS' }] },
  { type: 'verdict', runId: 'std1', head, verdict: 'PASS', findings: [] },
  { type: 'verdict', runId: 'adv1', head, verdict: 'PASS', findings: [] },
];
export const cases: ObserverCase[] = [
  { name: 'a comment-only change is accepted', events: toAcceptance(comment), expect: [{ accept: comment }] },
  { name: 'a code change is left for the owner', events: toAcceptance(code), expect: [] },
];
