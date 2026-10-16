// Fake claude and pi for the adapter tests (04-d). argv[2] is the runtime, argv[3] the case.
// Every shape and exit code is copied from docs/work/03-a-findings.md; the reply text is the
// only thing invented, and it carries the claim block the adapter is expected to extract.
const [, , runtime, kase] = process.argv;
const BLOCK = '```json\n{"head":"H1","artifacts":["result.json"]}\n```';
const REPLY = `Done. Committed the change.\n\n${BLOCK}\n`;

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (prompt += c));
process.stdin.on('end', () => (runtime === 'claude' ? claude() : pi()));

const out = (s: string) => process.stdout.write(s);
const err = (s: string) => process.stderr.write(s);

function claude() {
  const base = { type: 'result', subtype: 'success', session_id: 'c0ffee00-0000-4000-8000-000000000001', num_turns: 1, duration_ms: 1234 };
  switch (kase) {
    case 'ping':
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
    case 'echo-prompt': {
      line(session); line({ type: 'agent_start' }); line({ type: 'turn_start' });
      line({ type: 'message_start', message: { role: 'system', content: [{ type: 'text', text: 'system prompt' }] } });
      line({ type: 'message_update', message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] } });
      line({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: kase === 'ping' ? REPLY : prompt }] } });
      line(turnEnd(kase === 'ping' ? REPLY : prompt));
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
