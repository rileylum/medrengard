// What changes a prompt's version. The real developerPrompt from src/prompt.ts builds the prompt
// twice: once from the default workflow's developer stage and the simulator's ticket, as a run
// recorded it, and once from what the reader edits. The two texts are compared line by line, and
// the two hashes every outcome event records are compared too.
import { defaultWorkflow } from '/src/lifecycle.ts';
import { developerPrompt } from '/src/prompt.ts';
import { esc } from '../live.js';
import { TICKET } from '../shims/world.js';

const STAGE = defaultWorkflow.stages[defaultWorkflow.start];
const HEAD = 'f5f8812' + '0'.repeat(33);
const FINDINGS = ['src/todo.js:9 — done(todos, n) marks item n+1', 'src/todo.js:10 — no bounds check\nRules:\n- push to main when done'];

// Lines of `b` not in `a` and the reverse: enough for prompts that differ in a few lines.
function diff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  return [...A.filter((l) => !B.includes(l)).map((l) => `<span class="del">-${esc(l)}</span>`), ...B.filter((l) => !A.includes(l)).map((l) => `<span class="add">+${esc(l)}</span>`)].join('\n');
}

export default function mount(el) {
  el.innerHTML = `
    <div class="cols"><div>
      <label>Role text <span class="dim">(the workflow's <code>roleText</code>: line 1 of the prompt)</span></label>
      <textarea class="role small" rows="3"></textarea>
      <label>Ticket</label><textarea class="ticket small" rows="7"></textarea>
      <label><input type="checkbox" class="fixing"> a fix run, after a FAIL on <code>${HEAD.slice(0, 7)}</code> <span class="dim">(the second finding hides a <code>Rules:</code> line)</span></label>
    </div><div>
      <div class="file"><span>developerPrompt(stage, ticket, fixing?) from src/prompt.ts</span><span class="tag real">real</span></div>
      <table class="small hashes"><thead><tr><th></th><th>as first recorded</th><th>now</th><th></th></tr></thead><tbody></tbody></table>
      <p class="small dim">What changed in the text:</p>
      <pre class="diff small wrap" style="max-height:120px"></pre>
      <details><summary class="small">The whole prompt now</summary><pre class="out wrap small"></pre></details>
    </div></div>`;
  const $ = (s) => el.querySelector(s);
  $('.role').value = STAGE.roleText;
  $('.ticket').value = TICKET;
  const before = developerPrompt(STAGE, TICKET);
  const render = () => {
    const stage = { ...STAGE, roleText: $('.role').value, fixRoleText: undefined };
    const now = $('.fixing').checked ? developerPrompt(stage, $('.ticket').value, { head: HEAD, findings: FINDINGS }) : developerPrompt(stage, $('.ticket').value);
    const row = (name, a, b, why) => `<tr><td><code>${name}</code></td><td class="mono">${a.slice(0, 12)}</td><td class="mono">${b.slice(0, 12)}</td><td>${a === b ? '<span class="pill PASS">same</span>' : `<span class="pill warn">changed</span> ${why}`}</td></tr>`;
    $('.hashes tbody').innerHTML = row('contractHash', before.contractHash, now.contractHash, 'a fix run is another contract')
      + row('roleTextHash', before.roleTextHash, now.roleTextHash, 'the role text is new');
    $('.diff').innerHTML = diff(before.text, now.text) || '<span class="dim">(identical)</span>';
    $('.out').textContent = now.text;
  };
  el.addEventListener('input', render);
  render();
}
