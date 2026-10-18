// The spec's state machine, clickable: pick a stage and see every transition out of it, with
// the trigger and the guard, as docs/specs/core-lifecycle-v1.md lists them.
import { flow, LIFECYCLE } from '../diagram.js';
import { esc } from '../live.js';

const ANY = ['QUEUED', 'DEVELOPING', 'VERIFYING', 'STANDARD_REVIEW', 'ADVERSARIAL_REVIEW', 'AWAITING_ACCEPTANCE'];
// [from, trigger, guard, to]. "any" rows apply to every open stage, so they get their own table
// instead of repeating under each stage.
const ROWS = [
  ['QUEUED', 'scheduler claims', 'work READY, slot free, no other open cycle for this work', 'DEVELOPING (run created, base SHA captured)'],
  ['DEVELOPING', 'developer result', 'result valid, commit exists, run matches', 'VERIFYING (candidate frozen)'],
  ['DEVELOPING', 'invalid result, missing artifact, crash, timeout', '—', 'ESCALATED'],
  ['VERIFYING', 'all required checks PASS on candidate SHA', 'checks ran independently of the developer', 'STANDARD_REVIEW'],
  ['VERIFYING', 'any required check FAIL or missing', '—', 'ESCALATED'],
  ['STANDARD_REVIEW', 'verdict PASS on candidate SHA', 'standard < 2', 'ADVERSARIAL_REVIEW; standard += 1'],
  ['STANDARD_REVIEW', 'verdict FAIL, standard == 0', '—', 'DEVELOPING (fix run on findings); standard += 1'],
  ['STANDARD_REVIEW', 'verdict FAIL, standard == 1', '—', 'ESCALATED; standard += 1'],
  ['ADVERSARIAL_REVIEW', 'verdict PASS on candidate SHA', 'adversarial == 0', 'AWAITING_ACCEPTANCE; adversarial += 1'],
  ['ADVERSARIAL_REVIEW', 'verdict FAIL', '—', 'ESCALATED; adversarial += 1'],
  ['AWAITING_ACCEPTANCE', 'owner accepts SHA', 'SHA is the candidate', 'ACCEPTED'],
  ['AWAITING_ACCEPTANCE', 'owner requests changes', '—', 'ESCALATED'],
  ['any', 'candidate SHA changes outside a fix run', '—', 'ESCALATED'],
  ['any', 'verdict for a SHA that is not the candidate', '—', 'record verdict, count it, ESCALATED'],
  ['any', 'duplicate result or verdict (same run ID)', '—', 'no change'],
  ['any', 'owner cancels', '—', 'CANCELLED'],
  ['ESCALATED', 'owner cancels', '—', 'CANCELLED'],
  ['ESCALATED', 'owner authorises new cycle', '—', 'child cycle created (0,0) with parent link; this cycle stays ESCALATED'],
];
// Both tables share column widths so they read as one table in two parts.
const HEAD = '<colgroup><col style="width:38%"><col style="width:27%"><col></colgroup><thead><tr><th>trigger</th><th>guard</th><th>to</th></tr></thead>';
const row = ([from, t, g, to]) => `<tr><td>${esc(t)}</td><td class="dim">${esc(g)}</td><td><b>${esc(to)}</b></td></tr>`;
const ABOUT = {
  ACCEPTED: 'Terminal. The owner accepted this exact SHA. Every later event is recorded and ignored.',
  CANCELLED: 'Terminal. The owner cancelled. Every later event is recorded and ignored, and the work ID is free again.',
  ESCALATED: 'Holding. The controller could not go on alone. Nothing moves this cycle again except a cancel; the owner may open a child cycle instead.',
};

export default function mount(el) {
  el.innerHTML = `<div class="diagram"></div><h3 class="lc-title">Click a stage</h3><p class="small muted lc-about"></p><table class="small lc-rows" style="table-layout:fixed;width:100%">${HEAD}<tbody></tbody></table>
    <div class="lc-any"><h3>In any open stage</h3><p class="small muted">QUEUED to AWAITING_ACCEPTANCE. ESCALATED ignores these, except a cancel; ACCEPTED and CANCELLED ignore everything.</p>
    <table class="small" style="table-layout:fixed;width:100%">${HEAD}<tbody>${ROWS.filter(([from]) => from === 'any').map(row).join('')}</tbody></table></div>`;
  const d = flow(el.querySelector('.diagram'), LIFECYCLE);
  d.svg.classList.add('labels');
  const show = (id) => {
    d.reset(); d.current(id); d.options(id);
    el.querySelector('.lc-title').textContent = id;
    const rows = ROWS.filter(([from]) => from === id);
    el.querySelector('.lc-any').style.opacity = ANY.includes(id) ? '' : '.45';
    el.querySelector('.lc-about').textContent = ABOUT[id] ?? (id === 'QUEUED' ? 'The cycle exists in the store and waits for its first developer run.' : '');
    el.querySelector('.lc-rows tbody').innerHTML = rows.map(row).join('') || '<tr><td colspan="3" class="dim">No transitions out, except as described above.</td></tr>';
  };
  d.onClick(show);
  show('STANDARD_REVIEW');
}
