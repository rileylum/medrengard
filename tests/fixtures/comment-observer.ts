// The owner's use case for an observer that accepts (A-074 Q6a): accept a change whose every
// changed line is blank or a comment. An example only: `#` and `//` are the whole test of a comment.
import { execFileSync } from 'node:child_process';
import type { Observer } from '../../src/kits/observe.ts';

export function commentOnly(repo: string): Observer {
  const seen = new Map<string, { base?: string; head?: string }>();
  return async (line, owner) => {
    const e = line.event as { type?: unknown; base?: unknown; head?: unknown } | null;
    if (typeof e !== 'object' || e === null) return;
    const c = seen.get(line.cycleId) ?? {};
    seen.set(line.cycleId, c);
    if (e.type === 'claim' && typeof e.base === 'string') c.base = e.base;
    if (e.type === 'developer_result' && typeof e.head === 'string') c.head = e.head;
    if (line.stage !== 'AWAITING_ACCEPTANCE' || line.from === line.stage || !c.base || !c.head) return;
    const diff = execFileSync('git', ['-C', repo, 'diff', '--unified=0', `${c.base}..${c.head}`], { encoding: 'utf8' });
    const changed = diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).map((l) => l.slice(1).trim());
    if (!changed.every((l) => l === '' || l.startsWith('//') || l.startsWith('#'))) return;
    // A refused accept (the head moved, or the owner got there first) is not this observer's to fix.
    await owner.accept(c.head).catch((err: Error) => process.stderr.write(`comment observer: ${err.message}\n`));
  };
}
