// The command-stage builder. The reader writes a command stage; the real checkWorkflow judges it,
// each command is found the way src/verify.ts#runCheck finds it (the real executables and
// reachable over the guide's made-up machine), the real wrap shows the environment the command
// gets, and the real apply says where the results leave the cycle. How each command behaves once
// it runs is the reader's choice: nothing is spawned. The rest mirrors src/verify.ts#verify: the
// paths, request.json, the file copies and their hashes.
import { createHash } from 'node:crypto';
import { apply, checkWorkflow, defaultWorkflow, fileArgs, newCycle } from '/src/lifecycle.ts';
import { executables, reachable, wrap } from '/src/sandbox.ts';
import { vfs } from '../shims/node/fs.js';
import { esc, highlight } from '../live.js';
import { TICKET } from '../shims/world.js';

const RUNS = '/var/tmp/software_factory/runs';
const CYCLE = 'c0ffee';
const CHECKOUT = `${RUNS}/${CYCLE}-verify`;
const BASE = 'b'.repeat(40);
const HEAD = '5e1f0c2a9d7b3e4f6a8c1d2e3f4a5b6c7d8e9f01';
const CHECKS = [
  { name: 'test', command: ['npm', 'test'] },
  { name: 'lint', command: ['eslint', '.'] },
  { name: 'fmt', command: ['ruff', 'format', '--check'] },
  { name: 'smoke', command: ['./scripts/smoke.sh'] },
];
// Paths as the owner would read them: the runs directory and the head shortened.
const short = (p) => p.replaceAll(RUNS, 'runs').replaceAll(HEAD, `${HEAD.slice(0, 7)}…`);
const NOTES = "// Writes release notes from the diff into output/.\nimport { readFileSync, writeFileSync } from 'node:fs';\nconst r = JSON.parse(readFileSync(process.env.SF_REQUEST, 'utf8'));\nconst files = readFileSync(r.diffFile, 'utf8').match(/^diff --git .*$/gm) ?? [];\nwriteFileSync(`${r.outputDir}/notes.md`, `${r.stage} on ${r.head}: ${files.length} files\\n`);\n";
const STAGES = {
  VERIFYING: { label: 'VERIFYING: no run of its own, so the job\'s checks', def: { kind: 'command' } },
  PACKAGE: { label: 'PACKAGE: a stage with its own run', def: { kind: 'command', run: [{ name: 'pack', command: ['npm', 'pack', '--dry-run'] }] } },
  NOTES: { label: 'NOTES: a script beside the workflow, with network', def: { kind: 'command', network: true, run: [{ name: 'notes', command: ['node', { file: 'scripts/notes.js' }] }] } },
};

// The made-up machine: npm and node in /usr/bin, ruff in the owner's ~/.local (outside the
// sandbox), no eslint anywhere, and a script committed in the candidate.
vfs.file('/home/owner/.local/bin/ruff', '', 0o755).file(`${CHECKOUT}/scripts/smoke.sh`, '#!/bin/sh\n', 0o755).file(`${CHECKOUT}/package.json`, '{}');

export default function mount(el) {
  el.innerHTML = `<style>[data-demo=ver-lab] td.mono { overflow-wrap: anywhere; }</style>
    <div class="row"><label>Stage</label><select class="pick">${Object.entries(STAGES).map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join('')}</select></div>
    <div class="cols">
      <div style="min-width:0">
        <label>The stage, as the workflow declares it <span class="dim">(the lab sets its transitions)</span></label>
        <textarea class="def mono small" rows="7" spellcheck="false"></textarea>
        <div class="jobbox"><label>The job's checks <span class="dim">(argv; no shell; used only by a stage with no <code>run</code>)</span></label>
        <textarea class="checks mono small" rows="6" spellcheck="false"></textarea></div>
        <div class="filebox"><label><code>scripts/notes.js</code>, beside the workflow file</label>
        <textarea class="file mono small" rows="6" spellcheck="false"></textarea></div>
        <label>sandbox.read <span class="dim">(the owner's extra read-only roots, one per line)</span></label>
        <textarea class="read small" rows="2" placeholder="/home/owner/.local/bin"></textarea>
        <label><input type="checkbox" class="dirty"> a command rewrites a tracked file, as a formatter would</label>
      </div>
      <div style="min-width:0"><div class="judged"></div><div class="table"></div></div>
    </div>
    <div class="cols">
      <div style="min-width:0"><h3>What every command is given</h3><div class="given small"></div></div>
      <div style="min-width:0"><h3>The verification event, and what apply does with it <span class="tag real">real</span></h3><pre class="ev small"></pre><div class="verdict small"></div></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const behaviour = new Map();
  $('.checks').value = JSON.stringify(CHECKS, null, 0).replace(/\},\{/g, '},\n {').replace('[{', '[\n {').replace('}]', '}\n]');
  $('.file').value = NOTES;
  const load = (k) => { $('.def').value = JSON.stringify(STAGES[k].def, null, 1); render(); };

  function render() {
    const stage = $('.pick').value;
    let def, checks;
    try { def = JSON.parse($('.def').value); } catch (err) { $('.judged').innerHTML = `<p class="err">stage: ${esc(err.message)}</p>`; return; }
    def = { ...def, transitions: { PASS: 'AWAITING_ACCEPTANCE' } };
    // A workflow around the stage, so checkWorkflow can judge it.
    const workflow = { name: 'lab', start: 'DEVELOPING', stages: { DEVELOPING: { ...defaultWorkflow.stages.DEVELOPING, transitions: { PASS: stage } }, [stage]: def, AWAITING_ACCEPTANCE: defaultWorkflow.stages.AWAITING_ACCEPTANCE } };
    const reasons = checkWorkflow(workflow);
    $('.judged').innerHTML = reasons.length
      ? `<p><span class="pill FAIL">refused</span> by checkWorkflow:</p><ul class="small">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : '<p><span class="pill PASS">accepted</span> <span class="small">by checkWorkflow</span></p>';
    if (reasons.length) { $('.table').innerHTML = ''; return; }
    const own = def.run !== undefined;
    $('.jobbox').style.opacity = own ? 0.45 : 1;
    try { checks = own ? def.run : JSON.parse($('.checks').value); if (!Array.isArray(checks)) throw new Error('not a list'); }
    catch (err) { $('.table').innerHTML = `<p class="err">checks: ${esc(err.message)}</p>`; return; }
    const files = [...new Set(checks.flatMap(fileArgs))];
    $('.filebox').hidden = files.length === 0;

    const evidenceDir = `${RUNS}/evidence/${HEAD}/${stage}`;
    const outputDir = `${evidenceDir}/output`;
    const requestFile = `${evidenceDir}/request.json`;
    // The bytes hashed are the bytes run: the command runs the copy, as verify's does.
    const hashes = new Map(files.map((f) => {
      const text = f === 'scripts/notes.js' ? $('.file').value : '';
      vfs.file(`${evidenceDir}/files/${f}`, text, 0o755);
      return [f, createHash('sha256').update(text).digest('hex')];
    }));
    const read = $('.read').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const sandbox = { backend: 'bwrap', read };
    const policy = { cwd: CHECKOUT, write: [CHECKOUT, outputDir], read: [evidenceDir], network: def.network ?? false, env: { SF_REQUEST: requestFile } };
    const rows = checks.map((c) => {
      const named = Array.isArray(c.command) && c.command.some((a) => typeof a !== 'string');
      // verify refuses this before anything runs: the repository layer may set checks, but a file argument is the workflow's.
      if (!own && named) return { c, argv: [], refused: `check ${c.name}: every argument must be a string` };
      const argv = (c.command ?? []).map((a) => (typeof a === 'string' ? a : `${evidenceDir}/files/${a.file}`));
      const [command = ''] = argv;
      const found = executables(command, CHECKOUT);
      if (!found.length) return { c, argv, result: 'MISSING', exit: `missing: ${command || '(empty command)'} not found` };
      if (!found.some((p) => reachable(sandbox, policy, p))) return { c, argv, result: 'MISSING', exit: `missing: ${command} resolves to ${found[0]}, outside the sandbox; add its directory to sandbox.read` };
      const b = behaviour.get(c.name) ?? 'pass';
      return { c, argv, path: found[0], result: b === 'pass' ? 'PASS' : 'FAIL', exit: b === 'pass' ? 'exit 0' : b === 'fail' ? 'exit 1' : 'timeout' };
    });
    const refused = rows.find((r) => r.refused);
    $('.table').innerHTML = refused ? `<p class="err">verify throws before anything runs: ${esc(refused.refused)}</p>` : `<table class="small"><thead><tr><th>command</th><th>runs as</th><th>when it runs</th><th>result</th></tr></thead><tbody>${rows.map((r) => `
      <tr><td><b>${esc(r.c.name)}</b></td>
      <td class="mono">${esc(short(r.argv.join(' ')))}${r.path ? '' : `<div class="small">${esc(r.exit)}</div>`}</td>
      <td>${r.path ? `<select data-name="${esc(r.c.name)}"><option value="pass">exits 0</option><option value="fail">exits 1</option><option value="timeout">runs past the deadline</option></select>` : '<span class="dim">never runs</span>'}</td>
      <td><span class="pill ${r.result}">${r.result}</span></td></tr>`).join('')}</tbody></table>`;
    for (const s of el.querySelectorAll('select[data-name]')) { s.value = behaviour.get(s.dataset.name) ?? 'pass'; s.addEventListener('change', () => { behaviour.set(s.dataset.name, s.value); render(); }); }
    if (refused) { $('.given').innerHTML = ''; $('.ev').textContent = ''; $('.verdict').innerHTML = ''; return; }

    // The environment inside, read from the real bwrap argv: --clearenv, then each --setenv.
    const [, args] = wrap(sandbox, policy, 'true', []);
    const env = [];
    for (let i = 0; i < args.length; i++) if (args[i] === '--setenv') env.push([args[i + 1], args[i + 2]]);
    const request = { cycleId: CYCLE, workId: 'todo-01', stage, head: HEAD, base: BASE, ticket: TICKET.split('\n')[0] + ' …', diffFile: `${evidenceDir}/diff.patch`, outputDir };
    $('.given').innerHTML = `<table class="small"><tbody>
      <tr><td>working directory</td><td class="mono">${esc(short(CHECKOUT))}</td><td>a fresh checkout of the candidate, with no <code>.git</code></td></tr>
      <tr><td>may write</td><td class="mono">the checkout, ${esc(short(outputDir))}</td><td>what it writes in <code>output/</code> stays with the evidence</td></tr>
      <tr><td>may read</td><td class="mono">${esc(short(evidenceDir))}</td><td>the request, the diff, the file copies; the rest of the evidence is read-only</td></tr>
      <tr><td>network</td><td>${policy.network ? '<b>yes</b>' : 'no'}</td><td>off unless the stage sets <code>network: true</code></td></tr>
      <tr><td>environment</td><td class="mono" colspan="2">${env.map(([k, v]) => `${esc(k)}=${esc(short(v))}`).join('<br>')}</td></tr>
      </tbody></table>
      <p><code>request.json</code>, which <code>SF_REQUEST</code> names:</p><pre class="small">${highlight(JSON.stringify(request, null, 1))}</pre>`;

    const results = rows.map((r) => {
      const named = fileArgs(r.c);
      return { name: r.c.name, result: r.result, ...(named.length ? { files: Object.fromEntries(named.map((f) => [f, hashes.get(f)])) } : {}) };
    });
    if ($('.dirty').checked) results.push({ name: 'tree', result: 'FAIL' });
    const event = { type: 'verification', head: HEAD, checks: results };
    $('.ev').innerHTML = highlight(JSON.stringify(event, null, 1));
    let cycle = newCycle(CYCLE, 'todo-01');
    for (const e of [{ type: 'claim', runId: 'dev1', base: BASE, runtime: 'claude' }, { type: 'developer_result', runId: 'dev1', head: HEAD, artifacts: ['src/todo.js'] }]) cycle = apply(cycle, e, workflow);
    const after = apply(cycle, event, workflow);
    $('.verdict').innerHTML = `<p><span class="pill stage">${esc(cycle.stage)}</span> → <span class="pill ${after.stage === 'ESCALATED' ? 'ESCALATED' : 'PASS'}">${esc(after.stage)}</span></p>` +
      (after.escalation ? `<p>Reason: <b>${esc(after.escalation)}</b>. You read the evidence and decide.</p>` : '<p>Every result is PASS on this SHA, so the cycle moves on.</p>') +
      (results.length === 0 ? '<p>An empty list is not a pass: no commands means no evidence.</p>' : '');
  }
  $('.pick').addEventListener('change', (e) => load(e.target.value));
  el.addEventListener('input', (e) => { if (!e.target.matches('select')) render(); });
  load('VERIFYING');
}
