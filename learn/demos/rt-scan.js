// The claim scanner: a model's reply, wrapped as the runtime's stdout, read by the real
// claude.parse or pi.parse from src/runtime/cli-adapter.ts.
import { claude, pi } from '/src/runtime/cli-adapter.ts';
import { esc, highlight } from '../live.js';

const H = 'a1b2c3d'.padEnd(40, '0');
const fence = (o) => '```json\n' + JSON.stringify(o) + '\n```';
const PRESETS = {
  good: { label: 'A good reply', text: `I added the flag and a test.\n\n${fence({ head: H, artifacts: ['src/todo.js'] })}` },
  none: { label: 'No claim block', text: 'Done! Everything passes on my machine.' },
  two: { label: 'Two blocks: the last wins', text: `First I planned:\n${fence({ head: 'plan', artifacts: [] })}\nThen I did it:\n${fence({ head: H, artifacts: ['src/todo.js'] })}` },
  unclosed: { label: 'A closed block, then an unclosed fence', text: `${fence({ head: H, artifacts: ['src/todo.js'] })}\n\nAlso, an example:\n\`\`\`json\n{"oops": \n\n\n` },
  bad: { label: 'Invalid JSON in the block', text: "Here you go:\n```json\n{head: 'a1b2c3d', artifacts: [src/todo.js]}\n```" },
  bare: { label: 'The whole reply is JSON', text: JSON.stringify({ head: H, artifacts: ['src/todo.js'] }) },
  error: { label: 'claude: is_error with api_error_status', text: 'API Error: 529 {"type":"overloaded_error"}', error: true },
  noEnd: { label: 'pi: the stream stops before agent_end', text: '(no answer)', noEnd: true },
};

function stdout(runtime, p) {
  if (runtime === 'claude') {
    const o = p.error ? { type: 'result', subtype: 'success', is_error: true, result: p.text, api_error_status: 529, session_id: 's-1' }
      : { type: 'result', subtype: 'success', is_error: false, result: p.text, session_id: 's-1' };
    return { out: JSON.stringify(o), err: '', exit: p.error ? 1 : 0 };
  }
  const lines = [{ type: 'session', id: 's-1' }, { type: 'agent_start' }];
  if (!p.noEnd) lines.push({ type: 'turn_end', message: { role: 'assistant', content: [{ type: 'text', text: p.text }] } }, { type: 'agent_end' });
  return { out: lines.map((l) => JSON.stringify(l)).join('\n'), err: p.noEnd ? 'Error: No API key found for the selected model.' : '', exit: p.noEnd ? 1 : 0 };
}

export default function mount(el) {
  el.innerHTML = `
    <div class="row"><label>Runtime</label><select class="rt"><option>claude</option><option>pi</option></select>
      <label>Preset</label><select class="preset">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select></div>
    <div class="cols"><div><label>The model's reply</label><textarea class="text" rows="9"></textarea>
      <details><summary class="small">What the CLI printed on stdout</summary><pre class="raw small wrap"></pre></details></div>
      <div><label>parse(stdout, stderr, exit) returns <span class="tag real">real</span></label><pre class="outcome small wrap"></pre><p class="small verdict"></p></div></div>`;
  const $ = (s) => el.querySelector(s);
  let flags = {};
  const run = () => {
    const rt = $('.rt').value;
    const s = stdout(rt, { ...flags, text: $('.text').value });
    $('.raw').textContent = s.out + (s.err ? `\n--- stderr ---\n${s.err}` : '');
    const o = (rt === 'claude' ? claude : pi).parse(s.out, s.err, s.exit);
    $('.outcome').innerHTML = highlight(JSON.stringify(o, null, 2));
    $('.verdict').innerHTML = o.status === 'completed'
      ? 'A claim. The controller now classifies it: <code>isEvent</code> on the event built from it.'
      : `<span class="bad-t">A failed run.</span> The controller records <code>run_failed</code> with this reason.`;
  };
  const preset = () => { const p = PRESETS[$('.preset').value]; flags = { error: p.error, noEnd: p.noEnd }; $('.text').value = p.text; if (p.error) $('.rt').value = 'claude'; if (p.noEnd) $('.rt').value = 'pi'; run(); };
  $('.preset').addEventListener('change', preset);
  $('.rt').addEventListener('change', run);
  $('.text').addEventListener('input', run);
  preset();
}
