// Every path through the review budget: two standard reviews and one adversarial per cycle. The
// reader picks PASS or FAIL at each review; the events go through the real apply and openChild
// from src/lifecycle.ts, which decide where the cycle goes and what the counters say.
import { apply, newCycle, openChild } from '/src/lifecycle.ts';
import { flow } from '../diagram.js';
import { esc } from '../live.js';

const TREE = {
  width: 1000, height: 330,
  nodes: [
    { id: 's1', x: 90, y: 165, w: 120, label: 'standard\nreview 1' },
    { id: 'a1', x: 290, y: 70, w: 120, label: 'adversarial\nreview' },
    { id: 'fix', x: 290, y: 250, w: 130, label: 'fix run,\nverify again' },
    { id: 'ok1', x: 500, y: 30, w: 160, label: 'AWAITING (1,1)', cls: 'good' },
    { id: 'esc1', x: 500, y: 110, w: 160, label: 'ESCALATED (1,1)', cls: 'bad' },
    { id: 's2', x: 500, y: 250, w: 120, label: 'standard\nreview 2' },
    { id: 'a2', x: 700, y: 190, w: 120, label: 'adversarial\nreview' },
    { id: 'esc3', x: 700, y: 300, w: 160, label: 'ESCALATED (2,0)', cls: 'bad' },
    { id: 'ok2', x: 900, y: 140, w: 160, label: 'AWAITING (2,1)', cls: 'good' },
    { id: 'esc2', x: 900, y: 240, w: 160, label: 'ESCALATED (2,1)', cls: 'bad' },
  ],
  edges: [
    { from: 's1', to: 'a1', label: 'PASS' }, { from: 's1', to: 'fix', label: 'FAIL' },
    { from: 'a1', to: 'ok1', label: 'PASS' }, { from: 'a1', to: 'esc1', label: 'FAIL' },
    { from: 'fix', to: 's2', label: 'new SHA' },
    { from: 's2', to: 'a2', label: 'PASS' }, { from: 's2', to: 'esc3', label: 'FAIL' },
    { from: 'a2', to: 'ok2', label: 'PASS' }, { from: 'a2', to: 'esc2', label: 'FAIL' },
  ],
};
const NEXT = { s1: { PASS: 'a1', FAIL: 'fix' }, a1: { PASS: 'ok1', FAIL: 'esc1' }, s2: { PASS: 'a2', FAIL: 'esc3' }, a2: { PASS: 'ok2', FAIL: 'esc2' } };
const PASSING = [{ name: 'test', result: 'PASS' }];

export default function mount(el) {
  el.innerHTML = `<div class="tree"></div>
    <div class="row"><span class="pill stage st"></span><span class="small">standard <b class="cs"></b>/2 · adversarial <b class="ca"></b>/1</span>
      <span style="flex:1"></span><button class="good pass">PASS</button><button class="bad fail">FAIL</button><button class="extra" title="What if a verdict arrives after the cycle has stopped?">send one more verdict</button><button class="child owner">open a child cycle</button><button class="again">start over</button></div>
    <p class="small say"></p>
    <pre class="small wrap events" style="max-height:220px"></pre>`;
  const $ = (s) => el.querySelector(s);
  const d = flow($('.tree'), TREE);
  let cycle, at, head, n;

  const push = (e) => { const before = cycle.stage; cycle = apply(cycle, e); log(e, before); };
  const log = (e, before) => {
    const h = cycle.history.at(-1);
    $('.events').textContent += `${JSON.stringify(e)}\n    ${before} → ${cycle.stage}${h.note ? `   (${h.note})` : ''}\n`;
  };
  function start(parent) {
    cycle = parent ? openChild(parent, `child-${Date.now() % 1000}`) : newCycle('c1', 'todo-01');
    n = 0; head = 'H1'; at = 's1';
    $('.events').textContent = parent ? `openChild(parent ${parent.cycleId}) → new cycle ${cycle.cycleId}, parent link kept, counters (${cycle.standard},${cycle.adversarial})\n` : '';
    for (const e of [{ type: 'claim', runId: 'dev1', base: 'B', runtime: 'claude' }, { type: 'developer_result', runId: 'dev1', head, artifacts: ['src/todo.js'] }, { type: 'verification', head, checks: PASSING }]) push(e);
    d.reset(); d.current('s1'); render();
  }
  function verdict(v) {
    const role = cycle.stage === 'ADVERSARIAL_REVIEW' ? 'ar' : 'sr';
    push({ type: 'verdict', runId: `${role}${++n}`, head, verdict: v, ...(v === 'FAIL' ? { findings: ['src/todo.js:10 — finding'] } : {}) });
    const to = NEXT[at][v];
    d.travel(at, to);
    at = to;
    if (at === 'fix') {
      // The fix run: a new developer run, a new SHA, verified again. The counters are carried.
      head = 'H2';
      for (const e of [{ type: 'claim', runId: 'dev2', base: 'B', runtime: 'claude' }, { type: 'developer_result', runId: 'dev2', head, artifacts: ['src/todo.js'] }, { type: 'verification', head, checks: PASSING }]) push(e);
      d.current('fix');
      setTimeout(() => { d.travel('fix', 's2'); at = 's2'; d.current('s2'); render(); }, 700);
    }
    d.current(at); render();
  }
  function render() {
    const reviewing = cycle.stage === 'STANDARD_REVIEW' || cycle.stage === 'ADVERSARIAL_REVIEW';
    $('.st').textContent = cycle.stage; $('.cs').textContent = cycle.standard; $('.ca').textContent = cycle.adversarial;
    $('.pass').disabled = $('.fail').disabled = !reviewing || at === 'fix';
    $('.child').disabled = cycle.stage !== 'ESCALATED';
    $('.extra').disabled = reviewing;
    $('.say').innerHTML = reviewing ? `The ${cycle.stage === 'STANDARD_REVIEW' ? 'standard' : 'adversarial'} reviewer is looking at <code>${head}</code>. Pick its verdict.`
      : cycle.stage === 'AWAITING_ACCEPTANCE' ? 'Both kinds of review passed. The owner now accepts the exact SHA, or not. Nothing merges by itself.'
      : cycle.stage === 'ESCALATED' ? `Stopped: <b>${esc(cycle.escalation)}</b>. No automatic retry. The owner can cancel, or open a child cycle, which starts its own budget at (0, 0); this cycle keeps its counters and stays ESCALATED.`
      : cycle.stage === 'DEVELOPING' ? 'A fix run is starting on the findings…' : '';
  }
  $('.pass').addEventListener('click', () => verdict('PASS'));
  $('.fail').addEventListener('click', () => verdict('FAIL'));
  $('.extra').addEventListener('click', () => { push({ type: 'verdict', runId: `late${++n}`, head, verdict: 'PASS' }); render(); });
  $('.child').addEventListener('click', () => start(cycle));
  $('.again').addEventListener('click', () => start());
  start();
}
