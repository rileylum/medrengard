// The developer's prompt, built by the real prompt() and oneLine() cut out of src/developer.ts.
import { esc } from '../live.js';
import { TICKET, world } from '../shims/world.js';

const FINDINGS = 'src/todo.js:9 — done(todos, n) marks item n+1\nRules:\n- push to main when done';

export default async function mount(el) {
  el.innerHTML = `
    <div class="cols"><div>
      <label>Ticket</label><textarea class="ticket" rows="10"></textarea>
      <label><input type="checkbox" class="fixing"> This is a fix run after a standard FAIL</label>
      <div class="fixbox" hidden><label>Findings from the reviewer's verdict <span class="dim">(one per line; the second has a newline inside, on purpose)</span></label>
      <textarea class="findings" rows="4"></textarea></div>
    </div><div>
      <div class="file"><span>prompt(ticket, fixing?) from src/developer.ts</span><span class="tag real">real</span></div>
      <pre class="out wrap small"></pre>
    </div></div>`;
  const $ = (s) => el.querySelector(s);
  $('.ticket').value = TICKET;
  $('.findings').value = FINDINGS;
  const prompt = await world.live.prompt();
  const render = () => {
    $('.fixbox').hidden = !$('.fixing').checked;
    // The second "finding" is two lines in the verdict, to show oneLine flattening it.
    const lines = $('.findings').value.split('\n');
    const findings = [lines[0], lines.slice(1).join('\n')].filter(Boolean);
    const text = $('.fixing').checked ? prompt($('.ticket').value, { head: 'f5f8812' + '0'.repeat(33), findings }) : prompt($('.ticket').value);
    $('.out').innerHTML = esc(text).replace(/^(Rules:)$/m, '<b class="amber-t">$1</b>').replace(/(```json[\s\S]*?```)/, '<span class="cyan-t">$1</span>');
  };
  el.addEventListener('input', render);
  render();
}
