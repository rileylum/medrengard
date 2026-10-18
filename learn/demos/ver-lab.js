// The checks lab. Each command is found the way src/verify.ts#runCheck finds it, with the real
// executables and reachable from src/sandbox.ts over the guide's made-up machine; the results
// become one verification event, and the real apply says where that leaves a cycle in VERIFYING.
// How each check behaves once it runs is the reader's choice: nothing is spawned.
import { executables, reachable } from '/src/sandbox.ts';
import { apply, newCycle } from '/src/lifecycle.ts';
import { vfs } from '../shims/node/fs.js';
import { esc, highlight } from '../live.js';

const CHECKOUT = '/var/tmp/software_factory/runs/c0ffee-verify';
const HEAD = '5e1f0c2a9d7b3e4f6a8c1d2e3f4a5b6c7d8e9f01';
const START = [
  { name: 'test', command: ['npm', 'test'] },
  { name: 'lint', command: ['eslint', '.'] },
  { name: 'fmt', command: ['ruff', 'format', '--check'] },
  { name: 'smoke', command: ['./scripts/smoke.sh'] },
];

// The made-up machine: npm and node in /usr/bin, ruff in the owner's ~/.local (outside the
// sandbox), no eslint anywhere, and a script committed in the candidate.
vfs.file('/home/owner/.local/bin/ruff', '', 0o755).file(`${CHECKOUT}/scripts/smoke.sh`, '#!/bin/sh\n', 0o755).file(`${CHECKOUT}/package.json`, '{}');

export default function mount(el) {
  el.innerHTML = `
    <div class="cols">
      <div>
        <label>The job's checks <span class="dim">(argv; no shell)</span></label>
        <textarea class="checks" rows="7"></textarea>
        <label>sandbox.read <span class="dim">(absolute paths, one per line; the owner's extra read-only roots)</span></label>
        <textarea class="read" rows="2" placeholder="/home/owner/.local/bin"></textarea>
        <div class="row" style="margin-top:6px">
          <label><input type="checkbox" class="dirty"> a check rewrites a tracked file (a formatter)</label>
          <label><input type="checkbox" class="untracked"> a check leaves an untracked file (a build output)</label>
        </div>
      </div>
      <div class="ver-table"></div>
    </div>
    <div class="cols">
      <div><h3>The verification event</h3><pre class="ev small"></pre><h3>Evidence in runs/evidence/${HEAD.slice(0, 7)}…/</h3><div class="files small mono"></div></div>
      <div><h3>apply, from a cycle in VERIFYING <span class="tag real">real</span></h3><div class="verdict"></div></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  $('.checks').value = JSON.stringify(START, null, 0).replace(/\},\{/g, '},\n {').replace('[{', '[\n {').replace('}]', '}\n]');
  const behaviour = new Map();

  function render() {
    let checks;
    try { checks = JSON.parse($('.checks').value); if (!Array.isArray(checks)) throw new Error('not a list'); }
    catch (err) { $('.ver-table').innerHTML = `<p class="err">checks: ${esc(err.message)}</p>`; return; }
    const read = $('.read').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const sandbox = { backend: 'bwrap', read };
    // The policy src/verify.ts#runCheck gives every check: write the checkout, read nothing more, no network.
    const policy = { cwd: CHECKOUT, write: [CHECKOUT], read: [], network: false };
    const rows = checks.map((c) => {
      const [command = ''] = c.command ?? [];
      const found = executables(command, CHECKOUT);
      if (!found.length) return { c, result: 'MISSING', exit: `missing: ${command || '(empty command)'} not found` };
      if (!found.some((p) => reachable(sandbox, policy, p))) return { c, result: 'MISSING', exit: `missing: ${command} resolves to ${found[0]}, outside the sandbox; add its directory to sandbox.read` };
      const b = behaviour.get(c.name) ?? 'pass';
      return { c, path: found[0], b, result: b === 'pass' ? 'PASS' : 'FAIL', exit: b === 'pass' ? 'exit 0' : b === 'fail' ? 'exit 1' : 'timeout' };
    });
    $('.ver-table').innerHTML = `<table class="small"><thead><tr><th>check</th><th>found</th><th>when it runs</th><th>result</th></tr></thead><tbody>${rows.map((r, i) => `
      <tr><td><b>${esc(r.c.name)}</b><div class="dim mono">${esc((r.c.command ?? []).join(' '))}</div></td>
      <td class="mono">${r.path ? esc(r.path) : `<span class="small">${esc(r.exit)}</span>`}</td>
      <td>${r.path ? `<select data-name="${esc(r.c.name)}"><option value="pass">exits 0</option><option value="fail">exits 1</option><option value="timeout">runs past the deadline</option></select>` : '<span class="dim">never runs</span>'}</td>
      <td><span class="pill ${r.result}">${r.result}</span></td></tr>`).join('')}</tbody></table>`;
    for (const s of el.querySelectorAll('select[data-name]')) { s.value = behaviour.get(s.dataset.name) ?? 'pass'; s.addEventListener('change', () => { behaviour.set(s.dataset.name, s.value); render(); }); }

    const results = rows.map((r) => ({ name: r.c.name, result: r.result }));
    const dirty = $('.dirty').checked;
    if (dirty) results.push({ name: 'tree', result: 'FAIL' });
    const event = { type: 'verification', head: HEAD, checks: results };
    $('.ev').innerHTML = highlight(JSON.stringify(event, null, 1));
    const files = [...rows.map((r) => [r.c.name, r.exit]), ...(dirty ? [['tree', 'dirty']] : [])];
    $('.files').innerHTML = files.map(([n, exit]) => `${esc(n)}.stdout · ${esc(n)}.stderr · ${esc(n)}.exit <span class="dim">= "${esc(exit)}"</span>`).join('<br>') +
      ($('.untracked').checked ? '<p class="muted" style="font-family:var(--sans)">The untracked file is not dirt: <code>treeDiff</code> compares tracked files only. It is deleted before review, so the reviewer reads only what the commit holds.</p>' : '');

    let cycle = newCycle('c0ffee', 'demo');
    for (const e of [{ type: 'claim', runId: 'dev1', base: 'B', runtime: 'claude' }, { type: 'developer_result', runId: 'dev1', head: HEAD, artifacts: ['src/todo.js'] }]) cycle = apply(cycle, e);
    const after = apply(cycle, event);
    $('.verdict').innerHTML = `<p><span class="pill stage">${cycle.stage}</span> → <span class="pill ${after.stage === 'ESCALATED' ? 'ESCALATED' : 'PASS'}">${after.stage}</span></p>` +
      (after.escalation ? `<p class="small">Reason: <b>${esc(after.escalation)}</b>. No reviewer starts. The owner reads the evidence and decides.</p>` : '<p class="small">Every check said PASS on this SHA, so a standard reviewer may start. Change any check to see it stop.</p>') +
      (results.length === 0 ? '<p class="small">An empty list is not a pass either: no checks means no evidence.</p>' : '');
  }
  el.addEventListener('input', (e) => { if (!e.target.matches('select')) render(); });
  render();
}
