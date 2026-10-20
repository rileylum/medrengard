// The four configuration layers. The reader edits the personal, repository and job layers; the
// real allow and merge, and the real key lists and defaults, are cut out of src/config.ts and run
// here. The merged result shows which layer set each value. What loadConfig does after the merge
// (paths, the base, the workflow file, grants) reads files and Git, so it is described, not run.
import { esc, liveFunction } from '../live.js';

const C = 'src/config.ts';
const LAYERS = [
  ['personal', '~/.config/software_factory/config.json', 'yours, for every job on this machine', { runtime: { developer: 'claude', standard: 'claude', adversarial: 'pi' }, sandbox: { backend: 'bwrap', read: ['/opt/node22'] }, deadlineMs: 900000, grants: { forge: { variable: 'FORGE_TOKEN', file: 'forge-token' } } }],
  ['repository', '.factory/config.json at the base SHA', 'the repository\'s, committed with the code', { checks: [{ name: 'test', command: ['npm', 'test'] }, { name: 'lint', command: ['npm', 'run', 'lint'] }], runtime: { adversarial: 'claude' } }],
  ['job', 'job.json', 'one job\'s: which work, where, and anything to override', { workId: 'todo-01', ticketFile: 'ticket.md', repo: '../projects/todo-cli', runtime: { developer: 'pi' } }],
];
const TRIES = {
  'The repository turns the sandbox off': ['repository', (l) => ({ ...l, sandbox: { backend: 'none' } })],
  'The repository gives itself a grant': ['repository', (l) => ({ ...l, grants: { forge: { variable: 'T', file: '/tmp/t' } } })],
  'The repository sets the deadline': ['repository', (l) => ({ ...l, deadlineMs: 5 })],
  'The personal file names the work': ['personal', (l) => ({ ...l, workId: 'mine' })],
  'The job replaces the checks': ['job', (l) => ({ ...l, checks: [{ name: 'quick', command: ['npm', 'test', '--', 'quick'] }] })],
};

export default async function mount(el) {
  const names = ['DEFAULTS', 'NESTED', 'REPO_KEYS', 'OWNER_ONLY', 'isObject'];
  const v = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await liveFunction(C, n)])));
  v.PERSONAL_KEYS = await liveFunction(C, 'PERSONAL_KEYS', { REPO_KEYS: v.REPO_KEYS });
  v.JOB_KEYS = await liveFunction(C, 'JOB_KEYS', { PERSONAL_KEYS: v.PERSONAL_KEYS });
  const merge = await liveFunction(C, 'merge', { NESTED: v.NESTED });
  const allow = await liveFunction(C, 'allow', { NESTED: v.NESTED, isObject: v.isObject });
  const KEYS = { personal: v.PERSONAL_KEYS, repository: v.REPO_KEYS, job: v.JOB_KEYS };

  el.innerHTML = `
    <div class="row"><label>Try</label><select class="try"><option value="">(your own edits)</option>${Object.keys(TRIES).map((t) => `<option>${esc(t)}</option>`).join('')}</select><button class="reset">reset</button></div>
    <div class="cols" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="card"><h3>1 · factory defaults</h3><p class="small dim">in src/config.ts; no file</p><pre class="small">${esc(JSON.stringify(v.DEFAULTS, null, 1))}</pre></div>
      ${LAYERS.map(([k, file, who], i) => `<div class="card ${k === 'repository' ? 'amber' : 'violet'}"><h3>${i + 2} · ${k}</h3><p class="small dim"><code>${esc(file)}</code>: ${esc(who)}</p>
        <textarea class="layer mono small" data-k="${k}" rows="12" spellcheck="false"></textarea><p class="small allowed dim">may set: ${KEYS[k].map(esc).join(', ')}</p><div class="small says" data-k="${k}"></div></div>`).join('')}
    </div>
    <h3>The merged result <span class="tag real">real merge</span></h3>
    <table class="small merged"><thead><tr><th>key</th><th>value</th><th>set by</th></tr></thead><tbody></tbody></table>`;
  const $ = (s) => el.querySelector(s);
  const reset = () => { for (const [k, , , layer] of LAYERS) el.querySelector(`.layer[data-k="${k}"]`).value = JSON.stringify(layer, null, 1); };

  function render() {
    const layers = [['defaults', v.DEFAULTS]];
    let refused = false;
    for (const [k, file] of LAYERS) {
      const box = el.querySelector(`.says[data-k="${k}"]`);
      let layer;
      try { layer = JSON.parse(el.querySelector(`.layer[data-k="${k}"]`).value); } catch (err) { box.innerHTML = `<span class="bad-t">not JSON: ${esc(err.message)}</span>`; refused = true; continue; }
      try {
        allow(layer, KEYS[k], file, k === 'repository' ? v.OWNER_ONLY : {});
        box.innerHTML = '<span class="pill PASS">allowed</span>';
        layers.push([k, layer]);
      } catch (err) { box.innerHTML = `<span class="pill FAIL">refused</span> <span class="bad-t">${esc(err.message)}</span><div class="dim">loadConfig stops here: no job starts, and no command reads this job.</div>`; refused = true; }
    }
    // Who set each value: the last layer to name a key, or for a nested key each entry's last layer.
    const origin = {};
    for (const [k, layer] of layers) for (const [key, val] of Object.entries(layer)) {
      if (v.NESTED.includes(key)) for (const sub of Object.keys(val)) origin[`${key}.${sub}`] = k;
      else origin[key] = k;
    }
    const merged = merge(layers.map(([, l]) => l));
    const rows = Object.entries(merged).flatMap(([key, val]) => (v.NESTED.includes(key)
      ? Object.entries(val).map(([sub, x]) => [`${key}.${sub}`, x])
      : [[key, val]]));
    $('.merged tbody').innerHTML = refused
      ? '<tr><td colspan="3" class="bad-t">A layer was refused, so there is no configuration.</td></tr>'
      : rows.map(([key, val]) => `<tr><td class="mono">${esc(key)}</td><td class="mono">${esc(JSON.stringify(val))}</td><td><span class="pill ${origin[key] === 'repository' ? 'warn' : ''}">${esc(origin[key])}</span></td></tr>`).join('');
  }
  $('.try').addEventListener('change', (e) => {
    reset();
    const t = TRIES[e.target.value];
    if (t) { const box = el.querySelector(`.layer[data-k="${t[0]}"]`); box.value = JSON.stringify(t[1](JSON.parse(box.value)), null, 1); }
    render();
  });
  $('.reset').addEventListener('click', () => { $('.try').value = ''; reset(); render(); });
  el.addEventListener('input', (e) => { if (e.target.matches('.layer')) render(); });
  reset();
  render();
}
