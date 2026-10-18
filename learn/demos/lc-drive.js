// Drive the real apply (src/lifecycle.ts) by hand: build events with buttons, or type raw JSON,
// and watch the cycle move. Raw JSON goes through isEvent first, as the store does: apply would
// escalate on anything it cannot classify, and the store refuses to write it at all.
import { apply, isEvent, newCycle, openChild } from '/src/lifecycle.ts';
import { flow, LIFECYCLE } from '../diagram.js';
import { esc, highlight } from '../live.js';

export default function mount(el) {
  el.innerHTML = `
  <div class="diagram"></div>
  <div class="row"><span class="pill stage cur"></span><span class="small">standard <b class="std"></b>/2 · adversarial <b class="adv"></b>/1 · candidate <code class="cand"></code></span>
    <span style="flex:1"></span><button class="child owner" title="openChild: only from ESCALATED">Open child cycle</button><button class="restart">New cycle</button></div>
  <div class="cols">
    <div>
      <div class="row"><label>runId</label><input class="runId" size="6" value="dev1"><label>head</label><input class="head" size="5" value="H1"><label>base</label><input class="base" size="5" value="B1"></div>
      <div class="row"><label>verdict</label><select class="verdict"><option>PASS</option><option>FAIL</option></select>
        <label>findings</label><input class="findings" size="14" placeholder="one, two">
        <label>checks</label><select class="checks"><option value="PASS">tests PASS</option><option value="FAIL">tests FAIL</option><option value="MISSING">tests MISSING</option><option value="">no checks</option></select></div>
      <div class="row ev"></div>
      <p class="small dim">Each button builds one event from the fields above. Tip: a verdict whose head is not the candidate is a stale verdict.</p>
      <label>Raw JSON event</label>
      <textarea class="raw" rows="3">{"type": "verdict", "runId": "sr9", "head": "H1"}</textarea>
      <div class="row"><button class="send-raw">isEvent, then apply</button><span class="raw-out small"></span></div>
    </div>
    <div>
      <h3>History <span class="dim small">(cycle.history)</span></h3>
      <ol class="hist small"></ol>
      <details><summary class="small">The Cycle value</summary><pre class="json wrap small"></pre></details>
    </div>
  </div>`;
  const $ = (s) => el.querySelector(s);
  const d = flow($('.diagram'), LIFECYCLE);
  let cycle, n = 1;
  const v = (s) => $(s).value.trim();
  const BUILD = {
    claim: () => ({ type: 'claim', runId: v('.runId'), base: v('.base'), runtime: 'fake' }),
    developer_result: () => ({ type: 'developer_result', runId: v('.runId'), head: v('.head') || undefined, artifacts: ['src/todo.js'] }),
    verification: () => ({ type: 'verification', head: v('.head'), checks: v('.checks') ? [{ name: 'tests', result: v('.checks') }] : [] }),
    verdict: () => ({ type: 'verdict', runId: v('.runId'), head: v('.head'), verdict: v('.verdict'), findings: v('.findings') ? v('.findings').split(',').map((s) => s.trim()) : undefined }),
    head_changed: () => ({ type: 'head_changed', head: v('.head') }),
    base_changed: () => ({ type: 'base_changed', base: v('.base') }),
    accept: () => ({ type: 'accept', head: v('.head') }),
    request_changes: () => ({ type: 'request_changes' }),
    cancel: () => ({ type: 'cancel' }),
    run_failed: () => ({ type: 'run_failed', runId: v('.runId'), reason: 'timeout' }),
    reject_dispatch: () => ({ type: 'reject_dispatch', reason: 'forbidden runtime' }),
  };
  // Suggest the next run ID and head so the happy path is a few clicks.
  const suggest = () => {
    const s = cycle.stage;
    if (s === 'QUEUED' || (s === 'DEVELOPING' && !cycle.runs.some((r) => r.role === 'developer' && !cycle.consumed.includes(r.runId)))) $('.runId').value = `dev${cycle.runs.filter((r) => r.role === 'developer').length + 1}`;
    if (s === 'STANDARD_REVIEW') $('.runId').value = `sr${cycle.standard + 1}`;
    if (s === 'ADVERSARIAL_REVIEW') $('.runId').value = 'ar1';
    if (s === 'DEVELOPING' && cycle.candidate?.head && cycle.runs.some((r) => r.role === 'developer' && !cycle.consumed.includes(r.runId))) $('.head').value = `H${cycle.runs.filter((r) => r.role === 'developer').length}`;
  };
  const render = () => {
    $('.cur').textContent = cycle.stage;
    $('.cur').className = `pill stage cur ${cycle.stage}`;
    $('.std').textContent = cycle.standard; $('.adv').textContent = cycle.adversarial;
    $('.cand').textContent = cycle.candidate ? `${cycle.candidate.head || '—'} on ${cycle.candidate.base}` : '—';
    $('.hist').innerHTML = cycle.history.map((h) => `<li><b>${h.event.type}</b> <span class="mono">${h.from === h.to ? `<span class="dim">${h.to}</span>` : `${h.from} → <b>${h.to}</b>`}</span>${h.note ? ` <span class="dim">— ${esc(h.note)}</span>` : ''}</li>`).join('') || '<li class="dim">nothing yet</li>';
    $('.json').innerHTML = highlight(JSON.stringify(cycle, null, 2));
    $('.child').disabled = cycle.stage !== 'ESCALATED';
    d.current(cycle.stage);
    suggest();
  };
  const step = (e) => {
    const before = cycle.stage;
    cycle = apply(cycle, e);
    if (before !== cycle.stage) d.travel(before, cycle.stage);
    render();
  };
  for (const type of Object.keys(BUILD)) {
    const b = document.createElement('button');
    b.textContent = type;
    if (['accept', 'request_changes', 'cancel'].includes(type)) b.className = 'owner';
    b.addEventListener('click', () => step(BUILD[type]()));
    $('.ev').append(b);
  }
  $('.send-raw').addEventListener('click', () => {
    let parsed;
    try { parsed = JSON.parse($('.raw').value); } catch (err) { $('.raw-out').innerHTML = `<span class="bad-t">not JSON: ${esc(err.message)}</span>`; return; }
    if (!isEvent(parsed)) { $('.raw-out').innerHTML = '<span class="bad-t">isEvent: false. The store refuses to write this; nothing changes.</span>'; return; }
    $('.raw-out').innerHTML = '<span class="good-t">isEvent: true. Applied.</span>';
    step(parsed);
  });
  const restart = () => { cycle = newCycle(`c${n++}`, 'todo-01'); d.reset(); $('.runId').value = 'dev1'; $('.head').value = 'H1'; render(); };
  $('.restart').addEventListener('click', restart);
  $('.child').addEventListener('click', () => { const parent = cycle; cycle = openChild(parent, `c${n++}`); d.travel('ESCALATED', 'QUEUED'); setTimeout(() => { d.reset(); render(); }, 900); render(); });
  restart();
}
