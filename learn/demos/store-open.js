// One open cycle per work item, and a new cycle names its ESCALATED parent. Try to open cycles
// in the wrong order: the guide's store throws the same messages src/store.ts#open throws.
import { EventStore } from '/src/store.ts';
import { esc } from '../live.js';

export default function mount(el) {
  el.innerHTML = `
  <div class="row"><button class="primary open">open a cycle</button><label>parent</label><select class="parent"><option value="">(none)</option></select>
    <button class="esc">escalate the selected</button><button class="cancel owner">cancel the selected</button><select class="sel"></select><button class="reset">reset</button></div>
  <table class="small"><thead><tr><th>cycle</th><th>parent</th><th>stage</th></tr></thead><tbody></tbody></table>
  <div class="out small"></div>`;
  const $ = (s) => el.querySelector(s);
  let store, n;
  const say = (html) => { $('.out').innerHTML = html; };
  const render = () => {
    const all = store.cycles('todo-01');
    $('.parent').innerHTML = '<option value="">(none)</option>' + all.map((c) => `<option>${c.cycleId}</option>`).join('');
    $('.sel').innerHTML = all.map((c) => `<option>${c.cycleId}</option>`).join('');
    $('.sel').value = all.at(-1)?.cycleId ?? '';
    $('tbody').innerHTML = all.map((c) => `<tr><td class="mono">${c.cycleId}</td><td class="mono">${store.load(c.cycleId).parentCycleId ?? '—'}</td><td><span class="pill ${c.stage}">${c.stage}</span></td></tr>`).join('') || '<tr><td colspan="3" class="dim">no cycles for work todo-01</td></tr>';
  };
  const reset = () => { store = new EventStore(':memory:'); n = 1; say(''); render(); };
  $('.open').addEventListener('click', () => {
    const id = `c${n}`, parent = $('.parent').value || undefined;
    try { store.open(id, 'todo-01', parent); n++; say(`<span class="good-t">opened ${id}</span>`); } catch (err) { say(`<span class="bad-t">open threw:</span> <code>${esc(err.message)}</code>`); }
    render();
  });
  $('.esc').addEventListener('click', () => { const id = $('.sel').value; if (id) { store.append(id, { type: 'reject_dispatch', reason: 'demo' }); say(`${id} escalated (reject_dispatch)`); render(); } });
  $('.cancel').addEventListener('click', () => { const id = $('.sel').value; if (id) { store.append(id, { type: 'cancel' }); say(`${id} cancelled`); render(); } });
  $('.reset').addEventListener('click', reset);
  reset();
}
