// The claim guard: the real refuse() from src/developer.ts, run against a fake repository. Each
// case builds the commits a developer might leave and names a claimed head; refuse judges every
// case at once, one row each.
import { Repo, gitFor } from '../shims/fakegit.js';
import { liveFunction, esc } from '../live.js';
import { CHANGES, FILES } from '../shims/world.js';

const CLONE = 'refs/clone/c1';

// Each case returns { repo, base, previous, head, note }. The clone's branch is CLONE.
const CASES = {
  good: { label: 'Commits the change, claims its commit', build(r, base) { const h = r.commit(CLONE, CHANGES.good.files, 'Add todo done'); return { base, head: h }; } },
  base: { label: 'Claims the base commit', build(r, base) { r.commit(CLONE, CHANGES.good.files, 'Add todo done'); return { base, head: base }; } },
  notTip: { label: 'Commits twice, claims the first commit', build(r, base) { const a = r.commit(CLONE, CHANGES.offByOne.files, 'first try'); r.commit(CLONE, CHANGES.good.files, 'second try'); return { base, head: a }; } },
  short: { label: 'Claims a short SHA', build(r, base) { const h = r.commit(CLONE, CHANGES.good.files, 'Add todo done'); return { base, head: h.slice(0, 7) }; } },
  orphan: { label: 'Starts the branch over from nothing', build(r, base) { const root = r.write(undefined, { 'todo.py': 'print("rewrite")\n' }, 'start over'); r.refs.set(CLONE, root); return { base, head: root }; } },
  empty: { label: 'Makes an empty commit', build(r, base) { const h = r.commit(CLONE, {}, 'WIP'); return { base, head: h }; } },
  prevFix: { label: 'Fix run: claims the commit that failed review', build(r, base) { const p = r.commit(CLONE, CHANGES.offByOne.files, 'Add todo done'); return { base, previous: p, head: p }; } },
  sameTree: { label: 'Fix run: an empty commit on top of the failed one', build(r, base) { const p = r.commit(CLONE, CHANGES.offByOne.files, 'Add todo done'); const h = r.commit(CLONE, {}, 'fix review'); return { base, previous: p, head: h }; } },
  goodFix: { label: 'Fix run: a real fix on top', build(r, base) { const p = r.commit(CLONE, CHANGES.offByOne.files, 'Add todo done'); const h = r.commit(CLONE, CHANGES.good.files, 'Fix review: count from 1'); return { base, previous: p, head: h }; } },
};

export default async function mount(el) {
  el.innerHTML = `<table class="small guard"><thead><tr><th>What the developer left</th><th>Previous candidate</th><th>refuse(…) says</th></tr></thead><tbody></tbody></table>
    <p class="small dim">Click a row for the branch it left.</p><div class="graph"></div>`;
  const s = (x) => x?.slice(0, 7);
  // Each case on a repository of its own, all judged at once by the same real refuse.
  const judged = await Promise.all(Object.entries(CASES).map(async ([k, c]) => {
    const repo = new Repo('/repo', FILES, 'todo-cli: add and list');
    const base = repo.resolve('main');
    repo.refs.set(CLONE, base);
    const { previous, head } = c.build(repo, base);
    const refuse = await liveFunction('src/developer.ts', 'refuse', gitFor({ '/repo': repo }));
    let why;
    try { why = refuse('/repo', CLONE, 'sf/c1', base, previous, head); } catch (err) { why = `threw: ${err.message}`; }
    return { k, c, repo, base, previous, head, why };
  }));
  el.querySelector('tbody').innerHTML = judged.map(({ k, c, previous, why }) => `<tr data-k="${k}" style="cursor:pointer"><td>${esc(c.label)}</td><td class="mono">${previous ? s(previous) : '<span class="dim">first run</span>'}</td>
    <td>${why === undefined ? '<span class="pill good">accepted</span> the branch moves to the claimed head' : `<span class="pill bad">refused</span> <span class="bad-t">${esc(why)}</span>`}</td></tr>`).join('');
  const show = (k) => {
    const { repo, base, previous, head } = judged.find((j) => j.k === k);
    for (const tr of el.querySelectorAll('tbody tr')) tr.classList.toggle('on', tr.dataset.k === k);
    const tip = repo.refs.get(CLONE);
    el.querySelector('.graph').innerHTML = repo.log(CLONE).map((c) => {
      const tags = [c.sha === tip && 'tip', c.sha === base && 'base', c.sha === previous && 'previous candidate', head && c.sha.startsWith(head) && 'claimed'].filter(Boolean);
      return `<div class="commit"><span class="dotc ${head && c.sha.startsWith(head) ? 'claimed' : ''}"></span><code>${s(c.sha)}</code> ${esc(c.message)} ${tags.map((t) => `<span class="pill ${t === 'claimed' ? 'warn' : ''}">${t}</span>`).join(' ')}</div>`;
    }).join('') + (repo.isAncestor(base, tip) ? '' : `<div class="commit dim">(the base <code>${s(base)}</code> is not on this branch any more)</div>`)
      + (head.length === 40 ? '' : `<div class="commit">claimed: <code>${esc(head)}</code></div>`);
  };
  el.querySelector('tbody').addEventListener('click', (e) => { const k = e.target.closest('tr')?.dataset.k; if (k) show(k); });
  show('good');
}
