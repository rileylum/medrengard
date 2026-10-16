// Fake claude and pi for the adapter tests (04-d). argv[2] is the runtime, argv[3] the case.
// Every shape and exit code is copied from docs/work/03-a-findings.md; the reply text is the
// only thing invented, and it carries the claim block the adapter is expected to extract.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [, , runtime, kase, variant] = process.argv;
const BLOCK = '```json\n{"head":"H1","artifacts":["result.json"]}\n```';
let REPLY = `Done. Committed the change.\n\n${BLOCK}\n`;

// 05-a: stand in for a developer. Commits a file in the cwd and claims a real SHA, or one of the
// wrong ones a claim could name: the base, a SHA that is not the tip, an unknown or abbreviated one.
function commit(prompt: string): string {
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=fake', '-c', 'user.email=fake@example.invalid', ...a], { encoding: 'utf8' }).trim();
  const base = git('rev-parse', 'HEAD');
  if (variant === 'nocommit') return claim(base);
  writeFileSync('done.txt', prompt.split('\n')[0] + '\n');
  git('add', 'done.txt');
  git('commit', '-q', '-m', 'fake developer: done');
  const first = git('rev-parse', 'HEAD');
  if (variant === 'first') { writeFileSync('more.txt', 'more\n'); git('add', 'more.txt'); git('commit', '-q', '-m', 'fake developer: more'); }
  const head = variant === 'base' ? base : variant === 'bogus' ? 'a'.repeat(40) : variant === 'short' ? first.slice(0, 7) : first;
  return claim(head);
}
const claim = (head: string) => `Committed.\n\n\`\`\`json\n${JSON.stringify({ head, artifacts: ['done.txt'] })}\n\`\`\`\n`;

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (prompt += c));
process.stdin.on('end', () => {
  if (kase === 'commit') REPLY = commit(prompt);
  runtime === 'claude' ? claude() : pi();
});

const out = (s: string) => process.stdout.write(s);
const err = (s: string) => process.stderr.write(s);

function claude() {
  const base = { type: 'result', subtype: 'success', session_id: 'c0ffee00-0000-4000-8000-000000000001', num_turns: 1, duration_ms: 1234 };
  switch (kase) {
    case 'ping':
    case 'commit':
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
    case 'partial':
      // What a SIGTERM leaves behind: the session line and deltas, no agent_end, exit 143.
      line(session); line({ type: 'agent_start' });
      line({ type: 'message_update', message: { role: 'assistant', content: [{ type: 'text', text: 'Do' }] } });
      process.exitCode = 143;
      break;
  }
}
