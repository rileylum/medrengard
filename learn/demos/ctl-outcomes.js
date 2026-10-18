// Outcome lab: the real execute and receive from src/controller.ts, with the guide's in-memory
// EventStore (shims/store.js) and an adapter whose behaviour the reader picks. Whatever the
// adapter does, the controller must end up with exactly one well-formed event.
import { execute, receive } from '/src/controller.ts';
import { EventStore } from '/src/store.ts';
import { esc } from '../live.js';

const BASE = 'b'.repeat(40), HEAD = 'a1'.repeat(20), OLD = 'c3'.repeat(20);

const CLAIMS = {
  developer: JSON.stringify({ head: HEAD, artifacts: ['src/todo.js', 'test/todo.test.js'] }, null, 1),
  standard_reviewer: JSON.stringify({ head: HEAD, verdict: 'FAIL', findings: ['src/todo.js:9 — off by one'] }, null, 1),
};

// Each behaviour builds the adapter's start(). `claim` is the parsed textarea, or the text when it is not JSON.
const BEHAVIOURS = {
  completed: { label: 'completes with the claim below', start: (claim) => async () => ({ status: 'completed', claim }) },
  failed: { label: 'fails: the CLI said "API Error: 529"', start: () => async () => ({ status: 'failed', reason: 'claude: API Error: 529 overloaded' }) },
  emptyReason: { label: 'fails with an empty reason', start: () => async () => ({ status: 'failed', reason: '' }) },
  cancelled: { label: 'says it was cancelled', start: () => async () => ({ status: 'cancelled' }) },
  throws: { label: 'throws inside start(), synchronously', start: () => () => { throw new Error('spawn ENOENT'); } },
  bigint: { label: 'returns a claim holding a BigInt', start: () => async () => ({ status: 'completed', claim: { head: HEAD, artifacts: ['x'], tokens: 10n } }) },
  getter: { label: 'returns an object whose status getter throws', start: () => async () => ({ get status() { throw new Error('gotcha'); } }) },
  unknown: { label: 'returns an unknown status: "done"', start: () => async () => ({ status: 'done', claim: {} }) },
  hangs: { label: 'never settles (deadline 1.5 s)', start: () => () => new Promise(() => {}) },
  refused: { label: 'completes, but an accept guard refuses the claim (the developer stage has one)', start: (claim) => async () => ({ status: 'completed', claim }), accept: true },
};

export default function mount(el) {
  el.innerHTML = `
    <div class="row"><label>Role</label><select class="role"><option value="developer">developer</option><option value="standard_reviewer">standard reviewer</option></select>
      <label>The adapter</label><select class="beh">${Object.entries(BEHAVIOURS).map(([k, b]) => `<option value="${k}">${esc(b.label)}</option>`).join('')}</select></div>
    <label>Claim <span class="dim">(parsed JSON from the runtime's reply; edit it, break it)</span></label>
    <textarea class="claim" rows="5"></textarea>
    <div class="row"><button class="primary go">Run execute()</button><button class="again" disabled>Redeliver the same outcome (receive again)</button></div>
    <div class="result"></div>`;
  const $ = (s) => el.querySelector(s);
  const role = $('.role'), beh = $('.beh'), claim = $('.claim');
  claim.value = CLAIMS.developer;
  role.addEventListener('change', () => { claim.value = CLAIMS[role.value]; });
  let last;

  function table(store, cycleId) {
    const c = store.load(cycleId);
    const rows = c.history.map((h, i) => `<tr><td>${i + 1}</td><td><b>${h.event.type}</b>${h.event.reason ? `<div class="small">reason: <span class="bad-t">${esc(h.event.reason)}</span></div>` : ''}</td><td class="mono small">${h.from} → <b>${h.to}</b></td><td class="small">${esc(h.note ?? '')}</td></tr>`).join('');
    return `<table class="small"><thead><tr><th>#</th><th>event</th><th>stage</th><th>note</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="small">Stage now: <span class="pill ${c.stage}">${c.stage}</span> · counters: standard ${c.standard}, adversarial ${c.adversarial}</p>`;
  }

  $('.go').addEventListener('click', async () => {
    const b = BEHAVIOURS[beh.value];
    let parsed;
    try { parsed = JSON.parse(claim.value); } catch { parsed = claim.value; }
    const store = new EventStore();
    const cycleId = 'demo-' + Math.random().toString(36).slice(2, 7);
    store.open(cycleId, 'work-1');
    if (role.value !== 'developer') {
      // Walk the cycle to STANDARD_REVIEW so a reviewer run is allowed.
      store.append(cycleId, { type: 'claim', runId: 'dev1', base: BASE, runtime: 'fake' });
      store.append(cycleId, { type: 'developer_result', runId: 'dev1', head: HEAD, artifacts: ['src/todo.js'] });
      store.append(cycleId, { type: 'verification', head: HEAD, checks: [{ name: 'test', result: 'PASS' }] });
    }
    const adapter = { name: 'fake', start: b.start(parsed) };
    const accept = b.accept ? (c) => `commit ${String(c?.head).slice(0, 7)} is not the tip of sf/${cycleId} (${OLD.slice(0, 7)})` : undefined;
    $('.result').innerHTML = '<p class="small muted">running…</p>';
    const t0 = performance.now();
    try {
      await execute(store, cycleId, adapter, { role: role.value, prompt: '(prompt)', cwd: '/var/tmp/x' }, { deadlineMs: 1500, base: BASE, accept });
      const ms = Math.round(performance.now() - t0);
      last = { store, cycleId, role: role.value };
      $('.result').innerHTML = `<p class="small dim">settled in ${ms} ms</p>` + table(store, cycleId);
      $('.again').disabled = false;
    } catch (err) {
      $('.result').innerHTML = `<p class="err">execute threw: ${esc(err.message)}</p>`;
    }
  });

  $('.again').addEventListener('click', async () => {
    const { store, cycleId, role: r } = last;
    // The run ID of the run whose outcome was recorded: the last event naming one.
    const e = [...store.load(cycleId).history].reverse().find((h) => h.event.runId && h.event.type !== 'claim')?.event;
    if (!e) return;
    const runId = e.runId, before = store.table.length;
    // The same outcome again, rebuilt from the event it became.
    const outcome = e.type === 'run_failed' ? { status: 'failed', reason: e.reason } : { status: 'completed', claim: e };
    try { receive(store, cycleId, runId, r, outcome); } catch (err) { $('.result').insertAdjacentHTML('beforeend', `<p class="err">receive threw: ${esc(err.message)}</p>`); return; }
    $('.result').innerHTML = `<p class="small">Redelivered an outcome for run <code>${esc(String(runId).slice(0, 8))}</code>: ${store.table.length === before ? '<b class="good-t">nothing written</b>. One run, one outcome.' : '<b class="bad-t">a row was written</b>.'}</p>` + table(store, cycleId);
  });
}
