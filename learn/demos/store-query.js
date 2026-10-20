// The query console: a recorded runs directory, two work items written into the guide's store
// stand-in in the order a real day would interleave them, read back the way
// `node src/main.ts events` reads them (learn/lines.js follows src/stream.ts). With --follow on,
// the rest of the day arrives a row at a time and only the new lines print.
import { EventStore } from '/src/store.ts';
import { esc, highlight } from '../live.js';
import { lines } from '../lines.js';

const sha = (c) => c.repeat(40);
const B = sha('b'), H1 = sha('1'), H2 = sha('2'), H3 = sha('3');
const versions = { runtime: 'claude', contractHash: sha('c').slice(0, 64), roleTextHash: sha('d').slice(0, 64) };

// [cycle, work, parent, event]; a null event opens the cycle.
const DAY = [
  ['c-01', 'todo-01', undefined, null],
  ['c-01', 'todo-01', undefined, { type: 'claim', runId: 'dev-1', base: B, runtime: 'claude' }],
  ['c-02', 'todo-02', undefined, null],
  ['c-02', 'todo-02', undefined, { type: 'claim', runId: 'dev-2', base: B, runtime: 'pi' }],
  ['c-01', 'todo-01', undefined, { type: 'developer_result', runId: 'dev-1', head: H1, artifacts: ['src/todo.js'], ...versions }],
  ['c-01', 'todo-01', undefined, { type: 'verification', head: H1, checks: [{ name: 'test', result: 'PASS' }] }],
  ['c-02', 'todo-02', undefined, { type: 'run_failed', runId: 'dev-2', reason: 'timeout', runtime: 'pi' }],
  ['c-01', 'todo-01', undefined, { type: 'verdict', runId: 'std-1', head: H1, verdict: 'PASS', findings: [], ...versions }],
  ['c-03', 'todo-02', 'c-02', null],
  ['c-03', 'todo-02', 'c-02', { type: 'claim', runId: 'dev-3', base: B, runtime: 'claude' }],
  ['c-01', 'todo-01', undefined, { type: 'verdict', runId: 'adv-1', head: H1, verdict: 'PASS', findings: [], ...versions, runtime: 'pi' }],
  ['c-03', 'todo-02', 'c-02', { type: 'developer_result', runId: 'dev-3', head: H2, artifacts: ['README.md'], ...versions }],
  ['c-01', 'todo-01', undefined, { type: 'accept', head: H1, source: 'owner' }],
  ['c-03', 'todo-02', 'c-02', { type: 'verification', head: H2, checks: [{ name: 'test', result: 'PASS' }] }],
  ['c-03', 'todo-02', 'c-02', { type: 'verdict', runId: 'std-3', head: H2, verdict: 'PASS', findings: [], ...versions }],
  ['c-03', 'todo-02', 'c-02', { type: 'verdict', runId: 'adv-3', head: H2, verdict: 'PASS', findings: [], ...versions }],
  ['c-03', 'todo-02', 'c-02', { type: 'accept', head: H2, source: 'comment-only' }],
  ['c-04', 'todo-03', undefined, null],
  ['c-04', 'todo-03', undefined, { type: 'claim', runId: 'dev-4', base: B, runtime: 'claude' }],
  ['c-04', 'todo-03', undefined, { type: 'developer_result', runId: 'dev-4', head: H3, artifacts: ['bin/todo.js'], ...versions }],
  ['c-04', 'todo-03', undefined, { type: 'cancel', source: 'nightly-sweep' }],
];
// The rows written before you look; the rest arrive while --follow runs.
const WRITTEN = 12;

export default function mount(el) {
  el.innerHTML = `
    <div class="row"><code>$ node src/main.ts events</code>
      <select class="target"><option value="">runs/ (every work)</option><option>todo-01</option><option>todo-02</option><option>todo-03</option></select>
      <label><code>--after</code></label><input class="after" type="number" min="0" value="0" style="width:60px">
      <label><input type="checkbox" class="follow"> <code>--follow</code></label>
      <button class="primary go">run</button><button class="next" disabled>the factory writes the next row</button></div>
    <p class="small dim">Picking a work item stands for passing its job file; <code>runs/</code> stands for passing the runs directory.</p>
    <pre class="term wrap small" style="max-height:330px"></pre>
    <div class="one small"></div>`;
  const $ = (s) => el.querySelector(s);
  let store, written, last, following;
  const reset = () => {
    store = new EventStore('/var/tmp/software_factory/runs/events.sqlite');
    written = 0;
    while (written < WRITTEN) write();
  };
  function write() {
    const [cycleId, workId, parent, event] = DAY[written++];
    if (event) store.append(cycleId, event); else store.open(cycleId, workId, parent, B);
  }
  const target = () => $('.target').value || undefined;
  const label = () => (target() ? `${target()}.json` : 'runs/') + ($('.after').value !== '0' ? ` --after ${$('.after').value}` : '') + ($('.follow').checked ? ' --follow' : '');
  const print = (ls) => {
    for (const l of ls) {
      const row = document.createElement('div');
      row.className = 'line';
      row.style.cursor = 'pointer';
      row.textContent = JSON.stringify(l);
      row.addEventListener('click', () => {
        $('.one').innerHTML = `<p>seq <b>${l.seq}</b> · cycle <code>${esc(l.cycleId)}</code> of <code>${esc(l.workId)}</code> · <b>${esc(l.event.type)}</b> moved it ${l.from === l.stage ? `nowhere: it stayed in <b>${esc(l.stage)}</b>` : `from <b>${esc(l.from)}</b> to <b>${esc(l.stage)}</b>`}${l.escalation ? ` · escalation: ${esc(l.escalation)}` : ''}</p><pre class="small">${highlight(JSON.stringify(l, null, 2))}</pre>`;
      });
      $('.term').append(row);
      last = l.seq;
    }
  };
  $('.go').addEventListener('click', () => {
    reset();
    $('.term').textContent = `$ node src/main.ts events ${label()}\n`;
    $('.one').innerHTML = '';
    last = Number($('.after').value) || 0;
    print(lines(store.table, { workId: target(), after: last }));
    following = $('.follow').checked;
    $('.next').disabled = !following || written >= DAY.length;
    if (!following) $('.term').append('(exit 0)');
  });
  $('.next').addEventListener('click', () => {
    write();
    // What one poll returns: the lines written since the last, for this work only.
    print(lines(store.table, { workId: target(), after: last }));
    if (written >= DAY.length) { $('.next').disabled = true; $('.term').append('(the day is over; --follow keeps polling every 500 ms until you stop it)'); }
  });
  $('.go').click();
}
