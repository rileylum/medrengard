// docs/decisions.md's approval history, read live, newest first, with a filter. Each entry
// quotes the owner's reply; the factory's rule is that an approval is never invented.
import { esc, markdown, source } from '../live.js';

export default async function mount(el) {
  const text = await source('docs/decisions.md');
  const entries = text.split(/^### /m).slice(1).map((e) => {
    const [head, ...body] = e.split('\n');
    const [id, date, title] = head.split(' — ');
    return { id, date, title, body: body.join('\n').trim() };
  });
  el.innerHTML = `<div class="row"><input class="q" placeholder="filter: sandbox, merge, A-03…" style="width:280px"><span class="small dim n"></span></div><div class="list"></div>`;
  const render = () => {
    const q = el.querySelector('.q').value.toLowerCase();
    const shown = entries.filter((e) => !q || `${e.id} ${e.title} ${e.body}`.toLowerCase().includes(q));
    el.querySelector('.n').textContent = `${shown.length} of ${entries.length} decisions`;
    el.querySelector('.list').innerHTML = shown.map((e) => `<details class="dec"><summary><b class="mono amber-t">${esc(e.id)}</b> <span class="dim small">${esc(e.date ?? '')}</span> ${esc(e.title ?? '')}</summary><div class="md small">${markdown(e.body)}</div></details>`).join('');
  };
  el.querySelector('.q').addEventListener('input', render);
  render();
}
