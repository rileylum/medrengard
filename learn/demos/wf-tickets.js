// Every ticket in docs/work, read live: title, route, and the review outcomes its log mentions.
// The log lines are free text, so the badges are a best reading of them, not a record; click a
// ticket to read the file itself.
import { esc, list, markdown, source } from '../live.js';

// "Standard review 1 on c5322f6: FAIL", "standard 1 PASS", "Adversarial review on 76a84cd: PASS", "adversarial FAIL"
const OUTCOME = /\b(standard(?: review)?\s*([12])|adversarial(?: review)?)\b[^.;:]{0,40}?[:\s]\s*(PASS|FAIL)\b/gi;

function outcomes(log) {
  const seen = new Map();
  for (const m of log.matchAll(OUTCOME)) {
    const key = m[2] ? `S${m[2]}` : 'A';
    seen.set(key, m[3].toUpperCase());
  }
  return ['S1', 'S2', 'A'].filter((k) => seen.has(k)).map((k) => ({ k, v: seen.get(k) }));
}

export default async function mount(el) {
  el.innerHTML = '<p class="muted small">Reading docs/work …</p>';
  const names = (await list('docs/work')).filter((n) => /^\d\d-[a-z]-.*\.md$/.test(n) && !n.includes('findings'));
  const tickets = await Promise.all(names.map(async (file) => {
    const text = await source(`docs/work/${file}`);
    const title = text.match(/^# (.*)/m)?.[1] ?? file;
    const route = text.match(/^Route: (\w+)/m)?.[1] ?? '?';
    const log = text.split(/^## Log/m)[1] ?? '';
    return { file, text, title, route, step: file.slice(0, 2), outs: outcomes(log), merged: /merged/i.test(log) };
  }));
  const steps = [...new Set(tickets.map((t) => t.step))];
  el.innerHTML = `<div class="row small"><span class="pill good">PASS</span><span class="pill bad">FAIL</span> S1, S2 = standard reviews, A = adversarial. Parsed from each ticket's log.</div>
    <div class="wf-grid">${steps.map((s) => `<div class="wf-step"><div class="mono small amber-t">PLAN STEP ${Number(s)}</div>${tickets.filter((t) => t.step === s).map((t) => `
      <button class="wf-ticket" data-file="${esc(t.file)}"><span class="mono">${esc(t.file.slice(0, 4))}</span> ${esc(t.title.replace(/^\d\d-[a-z]\s*[—-]\s*/, ''))}
      <span class="wf-badges">${t.route === 'Design' ? '<span class="pill warn">design</span>' : ''}${t.outs.map((o) => `<span class="pill ${o.v === 'PASS' ? 'good' : 'bad'}">${o.k} ${o.v}</span>`).join('')}</span></button>`).join('')}</div>`).join('')}</div>
    <div class="wf-read" hidden></div>`;
  const read = el.querySelector('.wf-read');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.wf-ticket');
    if (!b) return;
    const t = tickets.find((x) => x.file === b.dataset.file);
    read.hidden = false;
    read.innerHTML = `<div class="row"><b class="mono">docs/work/${esc(t.file)}</b><span class="tag live">live</span><button class="close">close</button></div><div class="md">${markdown(t.text)}</div>`;
    read.querySelector('.close').addEventListener('click', () => { read.hidden = true; });
    read.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  const fails = tickets.flatMap((t) => t.outs).filter((o) => o.v === 'FAIL').length;
  const advFails = tickets.filter((t) => t.outs.some((o) => o.k === 'A' && o.v === 'FAIL')).length;
  el.insertAdjacentHTML('afterbegin', `<p class="small">${tickets.length} tickets so far. Their logs record ${fails} FAIL verdicts, and an adversarial FAIL on ${advFails} tickets.</p>`);
}
