// Follow one grant's value. A MERGE stage holds the grant `forge`; the value is looked for in
// every place the factory writes or passes things, each built by the real code where the browser
// can run it: wrap and spawnEnv from src/sandbox.ts for the stage and for a check, redactAll and
// headGate cut out of src/verify.ts, stageGrants for the sandbox rule, and the event verify
// would append. A place that holds the value is marked; every other place must not.
import { checksPass, defaultWorkflow, took } from '/src/lifecycle.ts';
import { confines, spawnEnv, wrap } from '/src/sandbox.ts';
import { esc, liveFunction } from '../live.js';

const RUNS = '/var/tmp/software_factory/runs';
const HEAD = '9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7081920';
const OLD = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';
const EVIDENCE = `${RUNS}/evidence/${HEAD}/MERGE`;
const CHECKOUT = `${RUNS}/c0ffee-verify`;
const MERGE = { kind: 'command', grants: ['forge'], network: true, run: [{ name: 'merge', command: ['gh', 'pr', 'merge', '--squash'] }], transitions: { PASS: 'ACCEPTED' } };
const WORKFLOW = { ...defaultWorkflow, stages: { ...defaultWorkflow.stages, MERGE } };
const GRANTS = { forge: { variable: 'FORGE_TOKEN', file: '/home/owner/.config/software_factory/forge-token' } };

// The history a grant stage looks back on: verify, two PASS verdicts, the owner's accept.
const reviewed = (late) => ({
  stage: 'MERGE', candidate: { head: HEAD, base: 'b'.repeat(40) },
  history: [
    { from: 'VERIFYING', event: { type: 'verification', head: HEAD, checks: [{ name: 'tests', result: 'PASS' }] } },
    { from: 'STANDARD_REVIEW', event: { type: 'verdict', verdict: 'PASS', head: HEAD } },
    { from: 'ADVERSARIAL_REVIEW', event: { type: 'verdict', verdict: 'PASS', head: late ? OLD : HEAD } },
    { from: 'AWAITING_ACCEPTANCE', event: { type: 'accept', head: HEAD } },
  ],
});

export default async function mount(el) {
  const [redactAll, headGate, stageGrants] = await Promise.all([liveFunction('src/verify.ts', 'redactAll'), liveFunction('src/verify.ts', 'headGate', { checksPass, took }), liveFunction('src/verify.ts', 'stageGrants', { confines })]);
  el.innerHTML = `
    <div class="cols"><div>
      <label>The token's value <span class="dim">(read from the grant's file when the stage runs; a fake one here)</span></label>
      <input class="value mono" style="width:100%" value="ghp_demo0123456789">
      <label>What <code>gh pr merge</code> prints to stdout</label>
      <textarea class="stdout small mono" rows="3"></textarea>
      <label>What it writes to <code>output/head</code></label>
      <input class="headfile mono" style="width:100%">
    </div><div>
      <label><input type="checkbox" class="late"> the adversarial verdict was for an older head</label><br>
      <label><input type="checkbox" class="none"> the job's sandbox backend is <code>none</code></label>
      <p class="small dim">The stage, as the workflow declares it:</p>
      <pre class="small wrap">${esc(JSON.stringify(MERGE))}</pre>
    </div></div>
    <div class="gate"></div>
    <table class="small trace"><thead><tr><th>Where</th><th>Holds the value?</th><th>What is there</th></tr></thead><tbody></tbody></table>`;
  const $ = (s) => el.querySelector(s);
  $('.stdout').value = 'Merging pull request #12 with token ghp_demo0123456789\n✓ Squashed and merged';
  $('.headfile').value = HEAD;

  function render() {
    const value = $('.value').value;
    const sandbox = { backend: $('.none').checked ? 'none' : 'bwrap' };
    // Before anything runs: the stage's grants, then the head gate.
    try { stageGrants('MERGE', MERGE, GRANTS, sandbox); headGate(reviewed($('.late').checked), WORKFLOW); }
    catch (err) { $('.gate').innerHTML = `<p><span class="pill FAIL">nothing runs</span> <span class="bad-t">${esc(err.message)}</span></p><p class="small">The cycle escalates and the token is never read.</p>`; $('.trace tbody').innerHTML = ''; return; }
    $('.gate').innerHTML = '<p><span class="pill PASS">the stage may run</span> <span class="small">every stage\'s last outcome names the candidate, and a PASS verdict does</span></p>';
    if (!value) { $('.trace tbody').innerHTML = '<tr><td colspan="3" class="err">An empty grant file is refused: redacting an empty value would mark every character.</td></tr>'; return; }

    const policy = { cwd: CHECKOUT, write: [CHECKOUT, `${EVIDENCE}/output`], read: [EVIDENCE], network: true, env: { SF_REQUEST: `${EVIDENCE}/request.json` }, secrets: { FORGE_TOKEN: value } };
    const [, mergeArgv] = wrap(sandbox, policy, 'gh', ['pr', 'merge', '--squash']);
    const env = spawnEnv(policy);
    const check = { ...policy, secrets: undefined, network: false };
    const [, checkArgv] = wrap(sandbox, check, 'npm', ['test']);
    const checkEnv = spawnEnv(check);
    const redact = (t) => redactAll(t, [{ name: 'forge', value }]);
    const headText = $('.headfile').value.replace(/\n$/, '');
    const headOk = headText === HEAD;
    const event = { type: 'verification', head: HEAD, checks: [{ name: 'merge', result: 'PASS' }, ...(headOk ? [] : [{ name: 'head', result: 'FAIL' }])], grants: ['forge'] };
    const places = [
      ['Your personal or job file', JSON.stringify({ grants: GRANTS }), 'the name, the variable and the file: never the value'],
      ['The workflow', JSON.stringify(MERGE), 'only the grant\'s name'],
      ['bwrap\'s argv for MERGE', mergeArgv.join(' '), `world-readable in /proc, so the value is not here: ${mergeArgv.filter((a) => a === '--unsetenv').length} inherited names are unset instead of --clearenv`],
      ['The environment MERGE is spawned in', `FORGE_TOKEN=${env.FORGE_TOKEN}`, 'the one place: its commands read FORGE_TOKEN'],
      ['bwrap\'s argv for a check in VERIFYING', checkArgv.join(' '), 'another stage holds no grant'],
      ['The environment a check is spawned in', Object.keys(checkEnv).join(' '), 'the names only; no FORGE_TOKEN'],
      ['merge.stdout in the evidence', redact($('.stdout').value), 'redacted before it is written, so a reviewer or observer never reads it'],
      ['The verification event', JSON.stringify(event), headOk ? 'the grant\'s name, and the results' : 'the head file does not name the candidate: a FAIL head check escalates the cycle'],
      ['head.stdout, when the head check fails', headOk ? '(not written: the head check passed)' : redact(`head file names ${JSON.stringify(headText)}; candidate is ${HEAD}`), 'quotes what the command wrote, redacted'],
    ];
    $('.trace tbody').innerHTML = places.map(([where, text, why]) => {
      const holds = text.includes(value);
      return `<tr><td>${esc(where)}</td><td>${holds ? '<span class="pill warn">yes</span>' : '<span class="pill PASS">no</span>'}</td><td><code class="small" style="overflow-wrap:anywhere">${esc(text.length > 260 ? `${text.slice(0, 260)}…` : text)}</code><div class="dim">${esc(why)}</div></td></tr>`;
    }).join('');
  }
  el.addEventListener('input', render);
  render();
}
