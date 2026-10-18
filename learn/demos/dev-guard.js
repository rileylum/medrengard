// The claim guard: the real refuse() from src/developer.ts, run against a fake repository. Each
// case builds the commits a developer might leave, names a claimed head, and asks refuse.
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
  el.innerHTML = `<div class="row">${Object.entries(CASES).map(([k, c]) => `<button data-k="${k}">${esc(c.label)}</button>`).join('')}</div>
    <div class="cols"><div><h3>The clone's branch</h3><div class="graph"></div></div><div><h3>refuse(…) says</h3><div class="verdict"></div><pre class="call small wrap"></pre></div></div>`;
  const show = async (k) => {
    for (const b of el.querySelectorAll('button')) b.classList.toggle('on', b.dataset.k === k);
    const repo = new Repo('/repo', FILES, 'todo-cli: add and list');
    const base = repo.resolve('main');
    repo.refs.set(CLONE, base);
    const { previous, head } = CASES[k].build(repo, base);
    const refuse = await liveFunction('src/developer.ts', 'refuse', gitFor({ '/repo': repo }));
    const tip = repo.refs.get(CLONE);
    const s = (x) => x?.slice(0, 7);
    el.querySelector('.graph').innerHTML = repo.log(CLONE).map((c) => {
      const tags = [c.sha === tip && 'tip', c.sha === base && 'base', c.sha === previous && 'previous candidate', head && c.sha.startsWith(head) && 'claimed'].filter(Boolean);
      return `<div class="commit"><span class="dotc ${head && c.sha.startsWith(head) ? 'claimed' : ''}"></span><code>${s(c.sha)}</code> ${esc(c.message)} ${tags.map((t) => `<span class="pill ${t === 'claimed' ? 'warn' : ''}">${t}</span>`).join(' ')}</div>`;
    }).join('') + (repo.isAncestor(base, tip) ? '' : `<div class="commit dim">(the base <code>${s(base)}</code> is not on this branch any more)</div>`);
    let why;
    try { why = refuse('/repo', CLONE, 'sf/c1', base, previous, head); } catch (err) { why = `threw: ${err.message}`; }
    el.querySelector('.verdict').innerHTML = why === undefined
      ? '<p><span class="pill good">accepted</span> The branch moves to the claimed head; the result is recorded.</p>'
      : `<p><span class="pill bad">refused</span> <span class="bad-t">${esc(why)}</span></p><p class="small muted">The controller records <code>run_failed</code> with this reason, and the cycle escalates.</p>`;
    el.querySelector('.call').textContent = `refuse(repo, 'refs/sf/incoming/c1', 'sf/c1',\n  base = ${s(base)}, previous = ${previous ? s(previous) : 'undefined'}, head = ${head.length === 40 ? s(head) + '…' : JSON.stringify(head)})`;
  };
  el.addEventListener('click', (e) => { const k = e.target.closest('button')?.dataset.k; if (k) show(k); });
  show('good');
}
