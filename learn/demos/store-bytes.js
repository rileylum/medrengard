// Validate the bytes, not the object (ticket 02-c). Each of these objects passes isEvent as a
// live object, yet its JSON, which is what the row stores and what replay reads, is something
// apply would read differently. src/store.ts#append checks the serialised body.
import { isEvent } from '/src/lifecycle.ts';
import { EventStore } from '/src/store.ts';
import { esc } from '../live.js';

const CASES = {
  'toJSON that drops the head': {
    make: () => ({ type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS', toJSON() { return { type: 'verdict', runId: 'sr1', verdict: 'PASS' }; } }),
    code: "{ type: 'verdict', runId: 'sr1', head: 'H1', verdict: 'PASS',\n  toJSON() { return { type: 'verdict', runId: 'sr1', verdict: 'PASS' }; } }",
  },
  'head inherited from a prototype': {
    make: () => Object.assign(Object.create({ head: 'H1' }), { type: 'verdict', runId: 'sr1', verdict: 'PASS' }),
    code: "Object.assign(Object.create({ head: 'H1' }), { type: 'verdict', runId: 'sr1', verdict: 'PASS' })",
  },
  'a sparse artifacts array': {
    // every() skips holes, so [ , ] passes "every artifact is a string"; JSON writes [null].
    // eslint-disable-next-line no-sparse-arrays
    make: () => ({ type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: [, ] }),
    code: "{ type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: [ , ] }",
  },
  'a check whose JSON says something else': {
    make: () => ({ type: 'verification', head: 'H1', checks: [{ name: 'tests', result: 'PASS', toJSON() { return { name: 'tests', result: 'SKIPPED' }; } }] }),
    code: "{ type: 'verification', head: 'H1',\n  checks: [{ name: 'tests', result: 'PASS', toJSON() { return { name: 'tests', result: 'SKIPPED' }; } }] }",
  },
};

export default function mount(el) {
  el.innerHTML = `<div class="row"><label>Object</label><select class="pick">${Object.keys(CASES).map((k) => `<option>${esc(k)}</option>`).join('')}</select><button class="primary go">check it both ways</button></div><pre class="src small"></pre><div class="out small"></div>`;
  const $ = (s) => el.querySelector(s);
  const show = () => { $('.src').textContent = CASES[$('.pick').value].code; $('.out').innerHTML = ''; };
  $('.pick').addEventListener('change', show);
  $('.go').addEventListener('click', () => {
    const c = CASES[$('.pick').value];
    const naive = isEvent(c.make());
    const body = JSON.stringify(c.make());
    const store = new EventStore(':memory:');
    store.open('c1', 'w');
    let result;
    try { store.append('c1', c.make()); result = '<span class="bad-t">written (unexpected)</span>'; } catch (err) { result = `<span class="good-t">refused:</span> <code>${esc(err.message)}</code>`; }
    $('.out').innerHTML = `<p>isEvent on the live object: <b class="${naive ? 'amber-t' : ''}">${naive}</b>${naive ? ' — a check here would let it in' : ''}</p>
      <p>its JSON, the bytes the row would hold: <code>${esc(body)}</code></p>
      <p>isEvent on those bytes: <b>${isEvent(JSON.parse(body))}</b></p>
      <p>store.append: ${result}</p>`;
  });
  show();
}
