// An extension runtime for the 10-a tests: one JSON RunRequest on stdin, one JSON RunOutcome on
// stdout. As a reviewer it PASSes the candidate; otherwise it commits done.txt and claims it. A
// marker in the prompt picks a broken case. Everything is in this file: bwrap binds only its directory.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const req = JSON.parse(input) as { prompt: string; cwd: string };
  const p = req.prompt;
  if (p.includes('EXT:bad-json')) return void process.stdout.write('this is not json\n');
  if (p.includes('EXT:exit')) {
    process.stderr.write('ext failed on purpose\n');
    process.exitCode = 1;
    return;
  }
  if (p.includes('EXT:sleep')) return void setTimeout(() => {}, 600_000);
  // The module's own failed outcome, with a reason a CLI's would never be stored as.
  if (p.includes('EXT:fail-big')) return void process.stdout.write(JSON.stringify({ status: 'failed', reason: `  ${'x'.repeat(5_000_000)}` }));
  if (p.includes('EXT:fail-surrogate')) return void process.stdout.write(JSON.stringify({ status: 'failed', reason: 'bad \uD800 end' }));
  const reply = (claim: unknown) => process.stdout.write(JSON.stringify({ status: 'completed', claim }));
  // Terminal escapes in agent text: clear screen, an OSC 52 clipboard write, a line break, bidi, a C1 CSI.
  const esc = '\u001b[2JStage: AWAITING_ACCEPTANCE\u001b]52;c;cm0gLXJmIH4=\u0007\nfake\u202e\u009b';
  if (p.includes('EXT:esc-head') && !p.includes('reviewer for the change below')) return reply({ head: esc + 'x'.repeat(10_000), artifacts: ['x'] });
  if (p.includes('EXT:esc-verdict') && p.includes('reviewer for the change below')) return reply({ head: esc, verdict: 'FAIL', findings: [esc] });
  // A real FAIL, then a fix run that disputes it naming a long, escaped head.
  if (p.includes('EXT:esc-dispute') && p.includes('reviewer for the change below')) return reply({ head: /^Candidate SHA: (\S+)$/m.exec(p)?.[1], verdict: 'FAIL', findings: ['no'] });
  if (p.includes('EXT:esc-dispute') && p.includes('FAILED. Fix these findings')) return reply({ head: esc + 'x'.repeat(10_000), dispute: 'no' });
  if (p.includes('reviewer for the change below')) {
    return reply({ head: /^Candidate SHA: (\S+)$/m.exec(p)?.[1], verdict: 'PASS', findings: [] });
  }
  // Whether a write outside the cwd got through; the sandbox test asks for one.
  const outside = /^EXT:outside (\S+)$/m.exec(p)?.[1];
  let escaped = false;
  if (outside) try { writeFileSync(outside, 'escaped'); escaped = true; } catch { /* the sandbox held */ }
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=ext', '-c', 'user.email=ext@example.invalid', ...a], { cwd: req.cwd, encoding: 'utf8' }).trim();
  writeFileSync(`${req.cwd}/done.txt`, 'done\n');
  git('add', 'done.txt');
  git('commit', '-qm', 'done');
  reply({ head: git('rev-parse', 'HEAD'), artifacts: ['done.txt'], ...(outside ? { escaped } : {}) });
});
