// One outcome per run. The real table has a unique index on (cycle_id, run_id) for results,
// verdicts and run_failed, and inserts with OR IGNORE, so a redelivered outcome writes nothing.
import { EventStore } from '/src/store.ts';
import { toStandardReview } from '/tests/scenarios.ts';
import { esc } from '../live.js';

export default function mount(el) {
  el.innerHTML = `
  <p class="small">A cycle waits in STANDARD_REVIEW. Send the reviewer's verdict, then send it again, as a network retry or a restarted controller might.</p>
  <div class="row"><button class="primary v1">verdict sr1 PASS</button><button class="v2">the same verdict again</button><button class="v3">run_failed for sr1</button><button class="reset">reset</button></div>
  <div class="out"></div>`;
  const $ = (s) => el.querySelector(s);
  let store, log;
  const reset = () => {
    store = new EventStore(':memory:');
    store.open('c1', 'todo-01');
    for (const e of toStandardReview) store.append('c1', e);
    log = [];
    store.subscribe((ch) => log.push(ch));
    render();
  };
  const render = () => {
    const c = store.load('c1');
    $('.out').innerHTML = `<p>rows in the table: <b>${store.table.length}</b> · stage <span class="pill stage ${c.stage}">${c.stage}</span> · standard ${c.standard}</p>` +
      `<ol class="small">${log.map((ch) => ch.kind === 'duplicate' ? `<li class="dim">not written: run "sr1" already has an outcome <code>${esc(ch.body)}</code></li>` : `<li>row ${ch.seq} written: <code>${esc(JSON.stringify(ch.event))}</code></li>`).join('')}</ol>`;
  };
  const verdict = { type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS' };
  $('.v1').addEventListener('click', () => { store.append('c1', verdict); render(); });
  $('.v2').addEventListener('click', () => { store.append('c1', verdict); render(); });
  $('.v3').addEventListener('click', () => { store.append('c1', { type: 'run_failed', runId: 'sr1', reason: 'timeout' }); render(); });
  $('.reset').addEventListener('click', reset);
  reset();
}
