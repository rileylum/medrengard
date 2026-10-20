// One panel for three ways to try to break the log. Each tab mounts its own demo, which runs the
// guide's store stand-in with the real isEvent and apply.
import bytes from './store-bytes.js';
import dedup from './store-dedup.js';
import open from './store-open.js';
import { esc } from '../live.js';

const TABS = [
  ['Send an outcome twice', dedup, 'A run has one outcome. The table has a unique index on <code>(cycle_id, run_id)</code> for results, verdicts, disputes and <code>run_failed</code>, and the insert uses <code>OR IGNORE</code>. The second outcome writes nothing, even when two processes race: the database decides, not the code.'],
  ['Open in the wrong order', open, 'A work item has at most one cycle that can still move. An ESCALATED cycle cannot move, but it waits for you: a new cycle for the same work must name it as its parent. Cancelling it frees the work instead.'],
  ['Hand it an object that lies', bytes, 'Before a row is written, <code>append</code> turns the event into JSON, parses it back, and checks <em>that</em> with <code>isEvent</code>. A JavaScript object can look valid and serialise to something else, and the row and every replay read the JSON. An unreadable row would make the whole cycle unloadable, so it is refused before writing.'],
];

export default function mount(el) {
  el.innerHTML = `<div class="row tabs">${TABS.map(([t], i) => `<button data-i="${i}">${esc(t)}</button>`).join('')}</div><p class="small why"></p><div class="panel"></div>`;
  const show = (i) => {
    for (const b of el.querySelectorAll('.tabs button')) b.classList.toggle('primary', b.dataset.i === String(i));
    el.querySelector('.why').innerHTML = TABS[i][2];
    const panel = document.createElement('div');
    el.querySelector('.panel').replaceWith(panel);
    panel.className = 'panel';
    TABS[i][1](panel);
  };
  el.querySelector('.tabs').addEventListener('click', (e) => e.target.dataset.i && show(Number(e.target.dataset.i)));
  show(0);
}
