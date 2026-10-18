// Time travel over the event log. A scenario from tests/scenarios.ts is appended to the guide's
// EventStore (the rules of src/store.ts over an array); the slider replays rows 0..n through the
// real apply, which is all src/store.ts#load does.
import { apply, newCycle } from '/src/lifecycle.ts';
import { scenarios } from '/tests/scenarios.ts';
import { EventStore } from '/src/store.ts';
import { esc } from '../live.js';

export default function mount(el) {
  el.innerHTML = `
  <div class="row"><label>Scenario</label><select class="pick">${scenarios.map((s, i) => `<option value="${i}">${s.name}</option>`).join('')}</select>
    <label>replay rows 0 to</label><input class="seq" type="range" min="0" value="0" style="width:220px"><b class="n mono"></b></div>
  <div class="row"><span class="pill stage cur"></span><span class="small">standard <b class="std"></b> · adversarial <b class="adv"></b> · candidate <code class="cand"></code></span></div>
  <div style="overflow:auto"><table class="small rows"><thead><tr><th>cycle_id</th><th>seq</th><th>type</th><th>run_id</th><th>body</th></tr></thead><tbody></tbody></table></div>`;
  const $ = (s) => el.querySelector(s);
  let rows = [];
  const pick = () => {
    const sc = scenarios[$('.pick').value];
    const store = new EventStore(':memory:');
    store.open('c1', 'todo-01');
    // Duplicates are not written, so a scenario with a redelivered verdict has fewer rows than events.
    for (const e of sc.events) store.append('c1', e);
    rows = store.table;
    $('.seq').max = rows.length - 1;
    $('.seq').value = rows.length - 1;
    show();
  };
  const show = () => {
    const n = Number($('.seq').value);
    $('.n').textContent = n;
    const [first, ...rest] = rows.slice(0, n + 1).map((r) => JSON.parse(r.body));
    const c = rest.reduce(apply, newCycle('c1', first.workId));
    $('.cur').textContent = c.stage; $('.cur').className = `pill stage cur ${c.stage}`;
    $('.std').textContent = c.standard; $('.adv').textContent = c.adversarial;
    $('.cand').textContent = c.candidate ? `${c.candidate.head || '—'} on ${c.candidate.base}` : '—';
    $('.rows tbody').innerHTML = rows.map((r, i) => `<tr style="opacity:${i <= n ? 1 : 0.3}"><td>${r.cycle_id}</td><td>${r.seq}</td><td><b>${r.type}</b></td><td class="mono">${esc(r.run_id ?? 'NULL')}</td><td class="mono small">${esc(r.body)}</td></tr>`).join('');
  };
  $('.pick').addEventListener('change', pick);
  $('.seq').addEventListener('input', show);
  $('.pick').value = String(scenarios.findIndex((s) => s.name === 'SC-02'));
  pick();
}
