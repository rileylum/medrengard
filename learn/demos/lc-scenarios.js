// The scenarios the tests assert (tests/scenarios.ts), played one event at a time through the
// real apply. The expected stage and counters come from the same file the tests read.
import { apply, newCycle } from '/src/lifecycle.ts';
import { scenarios } from '/tests/scenarios.ts';
import { flow, LIFECYCLE } from '../diagram.js';
import { esc } from '../live.js';

export default function mount(el) {
  el.innerHTML = `
  <div class="row"><label>Scenario</label><select class="pick">${scenarios.map((s, i) => `<option value="${i}">${s.name} → ${s.stage} (${s.counters.join(', ')})</option>`).join('')}</select>
    <button class="back">◀ step</button><button class="fwd primary">step ▶</button><button class="all">play all</button><span class="verdict small"></span></div>
  <div class="diagram"></div>
  <ol class="evs small mono"></ol>
  <p class="small muted">Run all of them: <button class="every">check every scenario</button> <span class="every-out small"></span></p>`;
  const $ = (s) => el.querySelector(s);
  const d = flow($('.diagram'), LIFECYCLE);
  let sc, at;
  const replay = () => sc.events.slice(0, at).reduce(apply, newCycle('demo', 'w'));
  const render = () => {
    const c = replay();
    d.reset();
    for (const h of c.history) if (h.from !== h.to) d.travel(h.from, h.to);
    d.current(c.stage);
    $('.evs').innerHTML = sc.events.map((e, i) => {
      const h = c.history[i];
      return `<li class="${i < at ? '' : 'dim'}">${esc(JSON.stringify(e))}${h ? ` <span class="${h.from === h.to ? 'dim' : 'amber-t'}">${h.from === h.to ? `stays ${h.to}` : `${h.from} → ${h.to}`}</span>${h.note ? ` <span class="dim">— ${esc(h.note)}</span>` : ''}` : ''}</li>`;
    }).join('');
    const done = at === sc.events.length;
    const ok = c.stage === sc.stage && c.standard === sc.counters[0] && c.adversarial === sc.counters[1];
    $('.verdict').innerHTML = `now <b>${c.stage}</b> (${c.standard}, ${c.adversarial})` + (done ? (ok ? ' <span class="good-t">✓ as the test expects</span>' : ' <span class="bad-t">✗ differs from the test</span>') : ` <span class="dim">· expected at the end: ${sc.stage} (${sc.counters.join(', ')})</span>`);
  };
  const pick = () => { sc = scenarios[$('.pick').value]; at = 0; render(); };
  $('.pick').addEventListener('change', pick);
  $('.fwd').addEventListener('click', () => { if (at < sc.events.length) { at++; render(); } });
  $('.back').addEventListener('click', () => { if (at > 0) { at--; render(); } });
  $('.all').addEventListener('click', () => { at = sc.events.length; render(); });
  $('.every').addEventListener('click', () => {
    const bad = scenarios.filter((s) => { const c = s.events.reduce(apply, newCycle('x', 'w')); return !(c.stage === s.stage && c.standard === s.counters[0] && c.adversarial === s.counters[1]); });
    $('.every-out').innerHTML = bad.length ? `<span class="bad-t">${bad.map((s) => s.name).join(', ')} differ</span>` : `<span class="good-t">✓ all ${scenarios.length} end where the tests say</span>`;
  });
  $('.pick').value = String(scenarios.findIndex((s) => s.name === 'SC-02'));
  pick();
}
