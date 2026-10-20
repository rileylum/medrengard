// Every path through a workflow's review budget, all at once. Each row is one way the verdicts
// can fall, played through the real apply from src/lifecycle.ts: a commit stage gets a new head,
// a command stage a passing verification, a review stage each verdict in turn, until the cycle
// waits for the owner or stops. Below, the events that look like reviews but are counted
// differently, played the same way under the default workflow.
import { apply, defaultWorkflow, newCycle } from '/src/lifecycle.ts';
import { esc } from '../live.js';
import { WORKFLOWS } from '../shims/world.js';

const BASE = 'b'.repeat(40);
const head = (n) => String(n).repeat(40);

/** Each sequence of verdicts the workflow allows, with the events it took and where it ended. */
function paths(w) {
  const out = [];
  const walk = (cycle, events, verdicts, heads, runs) => {
    // A new cycle is QUEUED; its first claim enters the start stage.
    const def = w.stages[cycle.stage === 'QUEUED' ? w.start : cycle.stage];
    const step = (e) => { const c = apply(cycle, e, w); return [c, [...events, e]]; };
    if (!def || def.kind === 'human') return out.push({ cycle, events, verdicts });
    if (def.kind === 'command') return walk(...step({ type: 'verification', head: head(heads), checks: [{ name: 'test', result: 'PASS' }] }), verdicts, heads, runs);
    if (def.produces === 'commit') {
      const runId = `dev${runs + 1}`;
      const [c1, e1] = step({ type: 'claim', runId, base: BASE, runtime: 'claude' });
      const c2 = apply(c1, { type: 'developer_result', runId, head: head(heads + 1), artifacts: ['src/todo.js'] }, w);
      return walk(c2, [...e1, c2.history.at(-1).event], verdicts, heads + 1, runs + 1);
    }
    for (const verdict of ['PASS', 'FAIL']) {
      const [c, e] = step({ type: 'verdict', runId: `${def.role}-${verdicts.length + 1}`, head: head(heads), verdict, ...(verdict === 'FAIL' ? { findings: ['src/todo.js:9 — a finding'] } : {}) });
      walk(c, e, [...verdicts, [cycle.stage, verdict]], heads, runs);
    }
  };
  walk(newCycle('c1', 'todo-01'), [], [], 0, 0);
  return out;
}

// The events that land in a review stage but are not a fresh verdict on the candidate.
const ODD = [
  ['A verdict for the previous SHA, after a fix run', [['STANDARD_REVIEW', 'FAIL']], (h) => ({ type: 'verdict', runId: 'late', head: h.previous, verdict: 'PASS' })],
  ['A reviewer that crashes or times out', [], () => ({ type: 'run_failed', runId: 'std-crash', reason: 'timeout' })],
  ['The same verdict delivered twice', [['STANDARD_REVIEW', 'PASS', 'again']], () => null],
];

export default function mount(el) {
  el.innerHTML = `
    <div class="row"><label>Workflow</label><select class="wf">${['default', 'light'].map((k) => `<option value="${k}">${esc(WORKFLOWS[k].label)}</option>`).join('')}</select></div>
    <table class="small paths"><thead><tr><th>the verdicts, in order</th><th>ends at</th><th>budget used</th><th>why it stopped</th></tr></thead><tbody></tbody></table>
    <h3>Counted differently <span class="dim small">(default workflow)</span></h3>
    <table class="small odd"><thead><tr><th>what happens</th><th>ends at</th><th>budget used</th><th>apply's note</th></tr></thead><tbody></tbody></table>
    <p class="small dim">Click a row for its events.</p>
    <pre class="small wrap events" style="max-height:220px"></pre>`;
  const $ = (s) => el.querySelector(s);
  let rows = [];
  const used = (w, c) => Object.entries(w.stages).filter(([, d]) => d.budget).map(([s, d]) => `${s} ${c.budgets[s] ?? 0}/${d.budget}`).join(', ');
  const pill = (stage) => `<span class="pill ${stage === 'ESCALATED' ? 'ESCALATED' : 'PASS'}">${esc(stage)}</span>`;

  function render() {
    const w = WORKFLOWS[$('.wf').value].workflow;
    const all = paths(w);
    rows = all.map((p) => ({ events: p.events, cycle: p.cycle, w }));
    $('.paths tbody').innerHTML = all.map((p, i) => `<tr data-i="${i}" style="cursor:pointer"><td>${p.verdicts.map(([s, v]) => `${esc(s.toLowerCase().replace('_review', '').replaceAll('_', ' '))} <span class="pill ${v}">${v}</span>`).join(' → ')}</td>
      <td>${pill(p.cycle.stage)}</td><td class="mono">${used(w, p.cycle)}</td><td>${esc(p.cycle.escalation ?? 'waits for the owner')}</td></tr>`).join('');
  }

  // The odd cases, under the default workflow: the path up to the review, then the odd event.
  const oddRows = [];
  const odd = ODD.map(([label, before, make], i) => {
    const w = defaultWorkflow;
    let c = newCycle('c1', 'todo-01');
    const events = [];
    const push = (e) => { c = apply(c, e, w); events.push(e); };
    const develop = (n) => { push({ type: 'claim', runId: `dev${n}`, base: BASE, runtime: 'claude' }); push({ type: 'developer_result', runId: `dev${n}`, head: head(n), artifacts: ['src/todo.js'] }); push({ type: 'verification', head: head(n), checks: [{ name: 'test', result: 'PASS' }] }); };
    develop(1);
    for (const [, v] of before) push({ type: 'verdict', runId: 'std-1', head: head(1), verdict: v });
    if (before[0]?.[1] === 'FAIL') develop(2);
    const e = make({ previous: head(1) }) ?? { type: 'verdict', runId: 'std-1', head: head(1), verdict: 'PASS' };
    push(e);
    oddRows.push({ events, cycle: c, w });
    return `<tr data-i="odd-${i}" style="cursor:pointer"><td>${esc(label)}</td><td>${pill(c.stage)}</td><td class="mono">${used(w, c)}</td><td>${esc(c.history.at(-1).note ?? '')}</td></tr>`;
  });
  $('.odd tbody').innerHTML = odd.join('');

  el.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const r = tr.dataset.i.startsWith('odd-') ? oddRows[Number(tr.dataset.i.slice(4))] : rows[Number(tr.dataset.i)];
    let c = newCycle('c1', 'todo-01');
    $('.events').textContent = r.events.map((ev) => { const from = c.stage; c = apply(c, ev, r.w); const h = c.history.at(-1); return `${JSON.stringify(ev)}\n    ${from} → ${c.stage}${h.note ? `   (${h.note})` : ''}`; }).join('\n');
  });
  $('.wf').addEventListener('change', render);
  render();
}
