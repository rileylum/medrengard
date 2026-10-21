// The workflow editor: a workflow as JSON, judged by the real checkWorkflow from src/lifecycle.ts
// on every keystroke, hashed the way the store records it, and drawn by diagram.js's layout.
// Click a stage for what it is and what src/run.ts does there.
import { checkWorkflow, defaultWorkflow } from '/src/lifecycle.ts';
import { workflowHash } from '/src/store.ts';
import { flow, layout } from '../diagram.js';
import { esc } from '../live.js';
import { WORKFLOWS } from '../shims/world.js';

const D = defaultWorkflow.stages;
const without = (o, k) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
const BROKEN = {
  loop: { label: 'refused: a loop that spends no budget', workflow: { name: 'no-budget', start: 'DEVELOPING', stages: { ...D, STANDARD_REVIEW: without(D.STANDARD_REVIEW, 'budget') } } },
  grant: { label: 'refused: a grant stage with no network', workflow: { name: 'merge-offline', start: 'DEVELOPING', stages: { ...D, AWAITING_ACCEPTANCE: { kind: 'human', transitions: { PASS: 'MERGE', FAIL: 'ESCALATED' } }, MERGE: { kind: 'command', grants: ['forge'], run: [{ name: 'merge', command: ['gh', 'pr', 'merge'] }], transitions: { PASS: 'ACCEPTED' } } } } },
  engine: { label: 'refused: a stage named after an engine stage', workflow: { name: 'own-escalated', start: 'DEVELOPING', stages: { ...D, ESCALATED: { kind: 'human', transitions: { PASS: 'CANCELLED' } } } } },
  roles: { label: 'refused: one role that both commits and reviews', workflow: { name: 'self-review', start: 'DEVELOPING', stages: { ...D, STANDARD_REVIEW: { ...D.STANDARD_REVIEW, role: 'developer' } } } },
  stuck: { label: 'refused: two stages with no way out', workflow: { name: 'stuck', start: 'A', stages: { A: { ...D.DEVELOPING, transitions: { PASS: 'B' } }, B: { kind: 'command', budget: 3, transitions: { PASS: 'A' } } } } },
};
const EXAMPLES = { ...Object.fromEntries(Object.entries(WORKFLOWS).map(([k, w]) => [k, { label: `accepted: ${w.label}`, workflow: w.workflow }])), ...BROKEN };

// What src/run.ts calls for each kind, and who moves the cycle on.
const KIND = {
  agent: (d) => d.produces === 'commit'
    ? `An agent stage whose role <b>${esc(d.role)}</b> produces a <b>commit</b>. <code>run</code> calls <code>develop</code> the first time and <code>fix</code> when a FAIL sends the cycle back, prompted with <code>${d.fixRoleText ? 'fixRoleText' : 'roleText'}</code> and the findings.`
    : `An agent stage whose role <b>${esc(d.role)}</b> produces a <b>verdict</b>. <code>run</code> calls <code>review</code>; the reviewer's PASS or FAIL picks the transition.`,
  command: (d) => `A command stage. <code>run</code> calls <code>verify</code>, which runs ${d.run ? `the stage's own ${d.run.length} command${d.run.length > 1 ? 's' : ''}` : 'the job\'s checks'} on a fresh checkout${d.network ? ', with network' : ', with no network'}${d.grants ? `, holding the grants ${d.grants.map(esc).join(', ')}` : ''}. PASS needs at least one result and every result PASS; anything else takes FAIL.`,
  human: () => 'A human stage. <code>run</code> returns here: the cycle waits for the owner. <code>accept &lt;sha&gt;</code> takes PASS. <code>request-changes &lt;sha&gt;</code> takes FAIL; like accept, it names the candidate head.',
};

export default function mount(el) {
  el.innerHTML = `
    <div class="row"><label>Start from</label><select class="ex">${Object.entries(EXAMPLES).map(([k, e]) => `<option value="${k}">${esc(e.label)}</option>`).join('')}</select></div>
    <div class="cols"><div>
      <label>The workflow, as the module's <code>workflow</code> export <span class="dim">(edit anything)</span></label>
      <textarea class="json mono small" rows="16" spellcheck="false"></textarea>
    </div><div>
      <div class="file"><span>checkWorkflow(workflow) from src/lifecycle.ts</span><span class="tag real">real</span></div>
      <div class="verdict"></div>
      <p class="small hash"></p>
      <div class="stage small"><p class="dim">Click a stage in the picture below.</p></div>
    </div></div>
    <div class="diagram"></div>`;
  const $ = (s) => el.querySelector(s);
  let w;
  const render = () => {
    $('.diagram').innerHTML = ''; $('.stage').innerHTML = '<p class="dim">Click a stage in the picture below.</p>';
    try { w = JSON.parse($('.json').value); } catch (err) { $('.verdict').innerHTML = `<p class="bad-t small">Not JSON: ${esc(err.message)}</p>`; $('.hash').textContent = ''; return; }
    const reasons = checkWorkflow(w);
    $('.verdict').innerHTML = reasons.length
      ? `<p><span class="pill FAIL">refused</span> <span class="small">the store would not open, and no job would start</span></p><ul class="small">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : '<p><span class="pill PASS">accepted</span> <span class="small">no reasons: the store accepts it (run still refuses a few shapes its steps cannot run yet)</span></p>';
    $('.hash').innerHTML = reasons.length ? '' : `Recorded on every cycle it opens as <code>${esc(w.name ?? 'unnamed')}</code>, hash <code>${workflowHash(w).slice(0, 16)}…</code>`;
    if (reasons.length) return;
    const d = flow($('.diagram'), layout(w));
    d.onClick((id) => {
      d.current(id); d.options(id);
      const def = w.stages[id];
      $('.stage').innerHTML = def
        ? `<p><b>${esc(id)}</b>: ${KIND[def.kind](def)}</p><p>PASS → <code>${esc(def.transitions.PASS)}</code>${def.transitions.FAIL ? ` · FAIL → <code>${esc(def.transitions.FAIL)}</code>` : ' · FAIL → <code>ESCALATED</code> (none given)'}${def.budget ? ` · budget ${def.budget}: its outcomes are counted, and a FAIL at the limit escalates` : ''}</p>`
        : `<p><b>${esc(id)}</b> is an engine stage. No workflow defines it; ${id === 'QUEUED' ? 'every cycle starts here, and the first claim moves it to the start stage' : id === 'ESCALATED' ? 'a cycle here waits for the owner, who retries, overrules, routes, cancels or opens a child cycle' : 'a cycle here is settled and ignores every event'}.</p>`;
    });
  };
  const load = (k) => { $('.json').value = JSON.stringify(EXAMPLES[k].workflow, null, 2); render(); };
  $('.ex').addEventListener('change', (e) => load(e.target.value));
  $('.json').addEventListener('input', render);
  load('default');
}
