// Fake claude and pi for the adapter tests (04-d). argv[2] is the runtime, argv[3] the case.
// Every shape and exit code is copied from docs/work/03-a-findings.md; the reply text is the
// only thing invented, and it carries the claim block the adapter is expected to extract.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const [, , runtime, kase, variant] = process.argv;
const BLOCK = '```json\n{"head":"H1","artifacts":["result.json"]}\n```';
let REPLY = `Done. Committed the change.\n\n${BLOCK}\n`;

// 05-a: stand in for a developer. Commits a file in the cwd and claims a real SHA, or one of the
// wrong ones a claim could name: the base, a SHA that is not the tip, an unknown or abbreviated one.
function commit(prompt: string): string {
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=fake', '-c', 'user.email=fake@example.invalid', ...a], { encoding: 'utf8' }).trim();
  const base = git('rev-parse', 'HEAD');
  if (variant === 'nocommit') return claim(base);
  if (variant === 'empty') { git('commit', '-q', '--allow-empty', '-m', 'fake developer: nothing'); return claim(git('rev-parse', 'HEAD')); }
  if (variant === 'orphan') {
    // An unrestricted developer rewrites the branch to a root commit: the tip, but not descended from the base.
    const branch = git('symbolic-ref', '--short', 'HEAD');
    git('checkout', '-q', '--orphan', 'tmp-orphan');
    git('commit', '-q', '-m', 'fake developer: orphan');
    git('branch', '-f', branch, 'HEAD');
    git('checkout', '-q', branch);
    git('branch', '-D', 'tmp-orphan');
    return claim(git('rev-parse', 'HEAD'));
  }
  writeFileSync('done.txt', prompt.split('\n')[0] + '\n');
  git('add', 'done.txt');
  if (variant === 'config') {
    // 08-c: commit an attribute naming a filter, then define the filter, an fsmonitor and hooks
    // in this repository's config, each writing the marker the ticket names. Anything the
    // controller runs with this repository's config writes it.
    const marker = /^MARKER (.+)$/m.exec(prompt)![1]!;
    // A subshell, so a marker out of reach (in bwrap) does not stop the filter passing content through.
    const run = `sh -c '(echo ran >> ${marker}) 2>/dev/null; cat'`;
    writeFileSync('.gitattributes', '* filter=sf\n');
    git('add', '.gitattributes');
    git('commit', '-q', '-m', 'fake developer: done');
    mkdirSync('.hooks', { recursive: true });
    for (const hook of ['post-checkout', 'reference-transaction', 'pre-auto-gc']) writeFileSync(`.hooks/${hook}`, `#!/bin/sh\n(echo ran >> ${marker}) 2>/dev/null\nexit 0\n`, { mode: 0o755 });
    // An fsmonitor that fails makes git fall back to a full scan, so the developer's own git still works.
    const monitor = `sh -c '(echo ran >> ${marker}) 2>/dev/null; exit 1'`;
    for (const [k, v] of [['filter.sf.smudge', run], ['filter.sf.clean', run], ['core.fsmonitor', monitor], ['core.hooksPath', `${process.cwd()}/.hooks`]]) git('config', k!, v!);
    return claim(git('rev-parse', 'HEAD'));
  }
  git('commit', '-q', '-m', 'fake developer: done');
  if (variant === 'escape') {
    // 08-c, the 05-a pi bash line: an unscoped developer writes wherever it can. ESCAPE names the
    // paths; what happened is left in escape.json in the cwd, untracked, for the test to read.
    const targets = /^ESCAPE (.+)$/m.exec(prompt)![1]!.split(' ');
    const report: Record<string, string> = {};
    for (const t of [...targets, '/tmp/sf-escape-marker']) {
      try { appendFileSync(t, 'escaped\n'); report[t] = 'ok'; } catch (err) { report[t] = (err as NodeJS.ErrnoException).code ?? 'error'; }
    }
    writeFileSync('escape.json', JSON.stringify(report));
  }
  const first = git('rev-parse', 'HEAD');
  if (variant === 'first') { writeFileSync('more.txt', 'more\n'); git('add', 'more.txt'); git('commit', '-q', '-m', 'fake developer: more'); }
  const head = variant === 'base' ? base : variant === 'bogus' ? 'a'.repeat(40) : variant === 'short' ? first.slice(0, 7) : first;
  return claim(head);
}
const claim = (head: string) => `Committed.\n\n\`\`\`json\n${JSON.stringify({ head, artifacts: ['done.txt'] })}\n\`\`\`\n`;

// 06-b: stand in for a reviewer. The candidate SHA is read from the prompt line review() writes;
// variants give a verdict for it, a FAIL with findings, a verdict for some other SHA, or no block.
function verdict(prompt: string): string {
  const head = /^Candidate SHA: ([0-9a-f]{40})$/m.exec(prompt)?.[1] ?? 'no-sha-in-prompt';
  if (variant === 'noblock') return 'I reviewed it and it looks fine.\n';
  const v = variant === 'fail'
    ? { head, verdict: 'FAIL', findings: ['[major] done.txt:1 — fixture finding'] }
    : { head: variant === 'stale' ? 'a'.repeat(40) : head, verdict: 'PASS', findings: [] };
  return `Reviewed.\n\n\`\`\`json\n${JSON.stringify(v)}\n\`\`\`\n`;
}

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (prompt += c));
process.stdin.on('end', () => {
  if (kase === 'commit') REPLY = commit(prompt);
  if (kase === 'verdict') REPLY = verdict(prompt);
  runtime === 'claude' ? claude() : pi();
});

const out = (s: string) => process.stdout.write(s);
const err = (s: string) => process.stderr.write(s);

function claude() {
  const base = { type: 'result', subtype: 'success', session_id: 'c0ffee00-0000-4000-8000-000000000001', num_turns: 1, duration_ms: 1234 };
  switch (kase) {
    case 'ping':
    case 'commit':
    case 'verdict':
      out(JSON.stringify({ ...base, is_error: false, terminal_reason: 'completed', api_error_status: null, result: REPLY }) + '\n');
      break;
    case 'echo-prompt':
      // Reply is the prompt itself, so a test can hand the fixture any reply text.
      out(JSON.stringify({ ...base, is_error: false, result: prompt }) + '\n');
      break;
    case 'bad-model':
      out(JSON.stringify({ ...base, is_error: true, terminal_reason: 'api_error', api_error_status: 404, result: 'The model no-such-model-xyz does not exist or you do not have access to it.' }) + '\n');
      err('[claude-code:unrecognized_model] {"model":"no-such-model-xyz"}\n');
      process.exitCode = 1;
      break;
    case 'no-auth':
      out(JSON.stringify({ ...base, is_error: true, api_error_status: null, result: 'Not logged in · Please run /login' }) + '\n');
      process.exitCode = 1;
      break;
    case 'empty':
      // The four-of-ten case: nothing on stdout, exit 0.
      break;
    case 'garbage':
      out('Segmentation fault (core dumped)\n');
      process.exitCode = 139;
      break;
  }
}

function pi() {
  const line = (o: unknown) => out(JSON.stringify(o) + '\n');
  const session = { type: 'session', id: '019a0000-0000-7000-8000-000000000002', version: '1.1.0', timestamp: 1, cwd: process.cwd() };
  const turnEnd = (text: string) => ({ type: 'turn_end', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  switch (kase) {
    case 'ping':
    case 'commit':
    case 'verdict':
    case 'echo-prompt': {
      line(session); line({ type: 'agent_start' }); line({ type: 'turn_start' });
      line({ type: 'message_start', message: { role: 'system', content: [{ type: 'text', text: 'system prompt' }] } });
      line({ type: 'message_update', message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] } });
      line({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: kase === 'echo-prompt' ? prompt : REPLY }] } });
      line(turnEnd(kase === 'echo-prompt' ? prompt : REPLY));
      line({ type: 'agent_end' }); line({ type: 'agent_settled' });
      break;
    }
    case 'bad-model':
      err('Error: Model "no-such-model-xyz" not found. Use --list-models to see available models.\n');
      process.exitCode = 1;
      break;
    case 'no-auth':
      line(session);
      err('No API key found for the selected model.\n');
      process.exitCode = 1;
      break;
    case 'error-turn':
    case 'error-turn-bare': {
      // 04-f: the last turn of the owner-run `pi -p --mode json` after its OAuth refresh failed (2026-10-19), exit 0.
      const message = 'OAuth refresh failed for openai: OpenAI OAuth token request failed (400): {\n  "error": "invalid_grant"\n}';
      line(session); line({ type: 'agent_start' }); line({ type: 'turn_start' });
      line({ type: 'turn_end', message: { role: 'assistant', content: [], stopReason: 'error', ...(kase === 'error-turn' ? { errorMessage: message } : {}) } });
      line({ type: 'agent_end' });
      break;
    }
    case 'partial':
      // What a SIGTERM leaves behind: the session line and deltas, no agent_end, exit 143.
      line(session); line({ type: 'agent_start' });
      line({ type: 'message_update', message: { role: 'assistant', content: [{ type: 'text', text: 'Do' }] } });
      process.exitCode = 143;
      break;
  }
}
