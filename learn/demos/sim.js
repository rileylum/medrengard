// The simulator. src/run.ts drives one job through the real controller (src/controller.ts) and
// the real lifecycle (src/lifecycle.ts); the stages are the stand-ins in shims/sim-*.js, and the
// agents are the reader, or a scripted autopilot. Replies go through the real claude and pi
// parsers (src/runtime/cli-adapter.ts), so a reply without a claim block fails as it would live.
import { run } from '/src/run.ts';
import { claude, pi } from '/src/runtime/cli-adapter.ts';
import { EventStore, SETTLED } from '/src/store.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { flow, LIFECYCLE } from '../diagram.js';
import { esc, highlight } from '../live.js';
import { CHANGES, REPO, RUNS, TICKET, world } from '../shims/world.js';
import { cloneRef } from '../shims/sim-developer.js';

const short = (s) => (s ? String(s).slice(0, 7) : '(none)');
const F1 = 'src/todo.js:9 — done(todos, n) marks item n+1: the ticket numbers items from 1, as list prints them';
const F1b = 'src/todo.js:9 — no check for a number outside the list; the ticket wants exit 1 and no change';
const F2 = 'src/todo.js:10 — `todo done 0` and `todo done -1` pass the guard; only the upper bound is checked';
const F3 = 'bin/todo.js:7 — `todo done abc` passes NaN, which the guard lets through, and the save rewrites the file unchanged with exit 0';
const DEFAULT_CHECKS = [{ name: 'test', command: ['npm', 'test'] }, { name: 'syntax', command: ['node', '--check', 'src/todo.js'] }];

/** Autopilot scripts: what each actor does on its n-th turn. */
const PRESETS = {
  happy: { label: 'Happy path', about: 'A correct change; every check passes; both reviewers PASS. It stops at AWAITING_ACCEPTANCE for you.',
    developer: [{ change: 'good' }], standard: [{ verdict: 'PASS' }], adversarial: [{ verdict: 'PASS' }] },
  fix: { label: 'Standard FAIL, then a fix run', about: 'The first commit is off by one. The standard reviewer FAILs it, the developer runs again on the findings, and the second commit passes. Counters carry forward: standard ends at 2.',
    developer: [{ change: 'offByOne' }, { change: 'good' }], standard: [{ verdict: 'FAIL', findings: [F1, F1b] }, { verdict: 'PASS' }], adversarial: [{ verdict: 'PASS' }] },
  twoFails: { label: 'Two standard FAILs', about: 'The fix run only half fixes it. A second standard FAIL is the end of the budget: the cycle escalates to you.',
    developer: [{ change: 'offByOne' }, { change: 'upperOnly' }], standard: [{ verdict: 'FAIL', findings: [F1, F1b] }, { verdict: 'FAIL', findings: [F2] }] },
  adversarial: { label: 'The adversary breaks it', about: 'The standard reviewer PASSes a change that checks only the upper bound. The adversarial reviewer finds `todo done 0`. One adversarial FAIL escalates at once.',
    developer: [{ change: 'upperOnly' }], standard: [{ verdict: 'PASS' }], adversarial: [{ verdict: 'FAIL', findings: [F2, F3] }] },
  checkFails: { label: 'A check fails', about: 'The developer commits a test that does not pass. The controller\'s own run of npm test FAILs, and no reviewer is ever started.',
    developer: [{ change: 'failingTest' }], checks: [{ test: 'fail' }] },
  formatter: { label: 'A check rewrites a file', about: 'Every check exits 0, but one rewrote a tracked file. The controller adds its own tree check, which FAILs: the reviewers must read the commit, not what a check left behind.',
    developer: [{ change: 'good' }], checks: [{ dirty: true }] },
  missing: { label: 'A check is not installed', about: 'The job declares eslint, which this machine does not have. Missing evidence is never PASS: the check is MISSING and the cycle escalates.',
    checksJson: [...DEFAULT_CHECKS, { name: 'lint', command: ['eslint', '.'] }], developer: [{ change: 'good' }] },
  timeout: { label: 'The developer hangs', about: 'The developer commits and then says nothing. At the deadline (5 s here) the controller stops waiting, records run_failed: timeout, and escalates.',
    deadline: 5, developer: [{ change: 'good', hang: true }] },
  noClaim: { label: 'A reply with no claim', about: 'The developer does the work but forgets the fenced json block. The runtime parser finds no claim; that is a failed run, not a guess.',
    developer: [{ change: 'good', reply: 'Done! I added `todo done <n>` and tests. Everything passes on my machine.' }] },
  notTip: { label: 'A claim the controller cannot prove', about: 'The developer claims the base commit as its result. The real refuse guard says why that is not a new commit, and the run fails.',
    developer: [{ change: 'good', claimHead: 'base' }] },
  empty: { label: 'An empty commit', about: 'The developer commits nothing. The guard refuses a head with no changes against the base.',
    developer: [{ change: 'nothing' }] },
  stale: { label: 'A verdict for the wrong SHA', about: 'After the fix run, the second standard reviewer names the first, failed commit. The verdict is recorded and counted, but cannot advance the cycle.',
    developer: [{ change: 'offByOne' }, { change: 'good' }], standard: [{ verdict: 'FAIL', findings: [F1, F1b] }, { verdict: 'PASS', sha: 'previous' }] },
  manual: { label: 'You play every agent', about: 'No autopilot. Each agent waits for you: pick what the developer commits, how each check behaves, and what each reviewer says. Edit any reply by hand.' },
};

const sleep = (ms, signal) => new Promise((res) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });

export default function mount(el) {
  el.innerHTML = `
  <div class="sim">
    <div class="sim-top">
      <div class="card violet sim-job">
        <h3>1 · The owner writes a job</h3>
        <div class="row"><label>Scenario</label><select class="preset">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select></div>
        <p class="small muted about"></p>
        <label>Ticket <span class="dim">(the contract the developer and the reviewers read)</span></label>
        <textarea class="ticket" rows="9"></textarea>
        <details><summary class="small">Job file: work ID, checks, runtimes, deadline</summary>
          <div class="row" style="margin-top:8px"><label>workId</label><input class="workId" value="todo-01" size="10">
            <label>deadline</label><input class="deadline" type="number" min="1" max="3600" value="300" style="width:70px"><span class="small dim">s per stage</span></div>
          <div class="row"><label>developer</label><select class="rt-developer"><option>claude</option><option>pi</option></select>
            <label>standard</label><select class="rt-standard"><option>claude</option><option>pi</option></select>
            <label>adversarial</label><select class="rt-adversarial"><option>pi</option><option>claude</option></select></div>
          <label>checks <span class="dim">(argv each; try a command that is not installed)</span></label>
          <textarea class="checks" rows="4"></textarea>
          <pre class="jobfile wrap small"></pre>
        </details>
        <div class="row" style="margin-top:10px">
          <label><input type="radio" name="mode" value="auto" checked> Autopilot</label>
          <select class="speed" title="Pause between the autopilot's actions"><option value="1800">slow</option><option value="900" selected>normal</option><option value="300">fast</option></select>
          <label><input type="radio" name="mode" value="step"> Step through</label>
          <label><input type="radio" name="mode" value="manual"> I play the agents</label>
        </div>
        <div class="row"><button class="primary go">▶ node src/main.ts job.json</button><button class="reset">Reset</button></div>
      </div>
      <div class="sim-board">
        <div class="diagram"></div>
        <div class="row status">
          <span class="pill stage stage-now">no cycle</span>
          <span class="small">cycle <code class="cycle-id">—</code></span>
          <span class="small">standard <span class="meter std"></span></span>
          <span class="small">adversarial <span class="meter adv"></span></span>
          <span class="small">head <code class="head">—</code></span>
        </div>
        <div class="row interfere">
          <span class="small dim">While it runs:</span>
          <button class="owner i-cancel" disabled title="What node src/main.ts cancel does from another terminal">Owner cancels</button>
          <button class="i-base" disabled title="Someone merges into main while the cycle runs">main moves on</button>
          <button class="i-head" disabled title="A push to sf/<cycle> that no fix run made">someone pushes to the branch</button>
        </div>
      </div>
    </div>
    <div class="sim-mid">
      <div class="sim-actors"><h3>2 · Who is working</h3><div class="timeline"><p class="muted small">Press ▶ to start. src/run.ts will call develop(), then whatever stage the cycle is in, until it reaches one no stage acts on.</p></div></div>
      <div class="card amber sim-log"><h3>3 · The event log <span class="dim small">(src/store.ts, replayed through apply)</span></h3>
        <table class="log"><thead><tr><th>#</th><th>event</th><th>stage</th><th>note</th></tr></thead><tbody></tbody></table>
        <pre class="row-json wrap" hidden></pre>
        <details><summary class="small">The Cycle value, replayed</summary><pre class="cycle-json wrap"></pre></details>
      </div>
    </div>
    <div class="sim-bottom">
      <div class="card"><h3>4 · What the owner's terminal shows</h3><pre class="term wrap">$ </pre><div class="row owner-actions"></div></div>
      <div class="card"><h3>5 · The pull request</h3><div class="pr"><p class="muted small">With no remote, the PR is the local branch <code>sf/&lt;cycle&gt;</code>: the owner diffs it, accepts the exact SHA, and merges.</p></div></div>
    </div>
  </div>`;
  const $ = (s) => el.querySelector(s);
  const diagram = flow($('.diagram'), LIFECYCLE);
  diagram.onClick((id) => diagram.options(id));
  const store = new EventStore(`${RUNS}/events.sqlite`);
  const state = {
    cycleId: undefined, parent: undefined, running: false, turns: {}, job: undefined, merged: [],
    cycle: () => (state.cycleId ? store.load(state.cycleId) : undefined),
  };
  let preset = PRESETS.happy;

  const mode = () => (preset === PRESETS.manual ? 'manual' : el.querySelector('input[name=mode]:checked').value);
  // A card the script plays shows what the agent chose, but none of the reader's controls.
  // Switching to "I play the agents" mid-run hands every scripted card back: its script stops at
  // the next pace and the controls return.
  const scripted = new Set();
  const fields = (c) => c.body.querySelectorAll('input, select, textarea');
  function autoplay(c) {
    if (mode() === 'manual') return false;
    c.c.classList.add('scripted');
    for (const f of fields(c)) f.disabled = true;
    scripted.add(c);
    return true;
  }
  function handBack(c) {
    c.c.classList.remove('scripted');
    for (const f of fields(c)) f.disabled = false;
    scripted.delete(c);
  }
  // The script's next action waits for a pause, or in step mode for the reader's Next button on
  // the card. Leaving step mode releases a waiting step, or the run would stall on it. Resolves
  // whether the script may still act.
  let stepping;
  async function pace(c, what, factor, signal) {
    if (mode() !== 'step') await sleep(Number($('.speed').value) * factor, signal);
    else await new Promise((res) => {
      c.body.insertAdjacentHTML('beforeend', `<div class="row step-row"><button class="step">Next ▶ ${esc(what)}</button></div>`);
      const row = c.body.querySelector('.step-row:last-child');
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      stepping = () => { row.remove(); stepping = undefined; res(); };
      row.querySelector('button').addEventListener('click', stepping, { once: true });
      signal?.addEventListener('abort', () => stepping?.(), { once: true });
    });
    return !signal?.aborted && scripted.has(c);
  }
  for (const r of el.querySelectorAll('input[name=mode]')) r.addEventListener('change', () => {
    $('.speed').disabled = mode() !== 'auto';
    if (mode() === 'manual') for (const c of [...scripted]) handBack(c);
    if (mode() !== 'step') stepping?.();
  });

  function jobFromForm() {
    let checks;
    try { checks = JSON.parse($('.checks').value); } catch (err) { throw new Error(`checks is not JSON: ${err.message}`); }
    return {
      workId: $('.workId').value, ticket: $('.ticket').value, repo: REPO, checks,
      parentCycleId: state.parent,
      runtime: { developer: $('.rt-developer').value, standard: $('.rt-standard').value, adversarial: $('.rt-adversarial').value },
      deadlineMs: Math.round(Number($('.deadline').value) * 1000),
    };
  }
  function showJob() {
    try {
      const j = jobFromForm();
      $('.jobfile').innerHTML = highlight(JSON.stringify({ workId: j.workId, ticketFile: 'ticket.md', repo: '../projects/todo-cli', checks: j.checks, runtime: j.runtime, deadlineMs: j.deadlineMs, ...(j.parentCycleId ? { parentCycleId: j.parentCycleId } : {}) }, null, 2));
    } catch (err) { $('.jobfile').textContent = err.message; }
  }
  function loadPreset(key) {
    preset = PRESETS[key];
    $('.about').textContent = preset.about;
    $('.checks').value = JSON.stringify(preset.checksJson ?? DEFAULT_CHECKS, null, 1).replace(/\n\s*/g, ' ').replace('[ {', '[\n {').replace(/\}, \{/g, '},\n {').replace('} ]', '}\n]');
    $('.deadline').value = preset.deadline ?? (key === 'manual' ? 600 : 300);
    if (key === 'manual') el.querySelector('input[value=manual]').checked = true; else el.querySelector('input[value=auto]').checked = true;
    showJob();
  }
  $('.ticket').value = TICKET;
  $('.preset').addEventListener('change', (e) => loadPreset(e.target.value));
  for (const s of ['.ticket', '.checks', '.workId', '.deadline', '.rt-developer', '.rt-standard', '.rt-adversarial']) $(s).addEventListener('input', showJob);
  loadPreset('happy');

  // ---- the board ------------------------------------------------------------------------------
  function meter(used, limit) { return Array.from({ length: limit }, (_, i) => `<span class="pip ${i < used ? 'used' : ''}"></span>`).join('') + ` <span class="dim">${used}/${limit}</span>`; }
  function board(cycle) {
    $('.stage-now').textContent = cycle?.stage ?? 'no cycle';
    $('.stage-now').className = `pill stage stage-now ${cycle?.stage ?? ''}`;
    $('.cycle-id').textContent = cycle ? short(cycle.cycleId) + (cycle.parentCycleId ? ` (child of ${short(cycle.parentCycleId)})` : '') : '—';
    $('.std').innerHTML = meter(cycle?.standard ?? 0, 2);
    $('.adv').innerHTML = meter(cycle?.adversarial ?? 0, 1);
    $('.head').textContent = short(cycle?.candidate?.head || undefined);
    $('.cycle-json').innerHTML = cycle ? highlight(JSON.stringify(cycle, null, 2)) : '';
  }
  board();

  // ---- the event log --------------------------------------------------------------------------
  const tbody = $('.log tbody');
  const summary = (e) => {
    const bits = { claim: () => `run ${short(e.runId)} · ${e.runtime} · base ${short(e.base)}`, developer_result: () => `head ${short(e.head)} · ${e.artifacts?.length ?? 0} artifacts`,
      verification: () => `${short(e.head)} · ${e.checks.map((c) => `${c.name} <span class="pill ${c.result}">${c.result}</span>`).join(' ')}`,
      verdict: () => `<span class="pill ${e.verdict}">${e.verdict}</span> on ${short(e.head)}${e.findings?.length ? ` · ${e.findings.length} findings` : ''}`,
      run_failed: () => `run ${short(e.runId)}: ${esc(e.reason)}`, accept: () => `head ${short(e.head)}`, reject_dispatch: () => esc(e.reason),
      head_changed: () => `head ${short(e.head)}`, base_changed: () => `base ${short(e.base)}` };
    return bits[e.type]?.() ?? '';
  };
  store.subscribe((ch) => {
    if (ch.kind === 'open') {
      const c = store.load(ch.cycleId);
      tbody.insertAdjacentHTML('beforeend', `<tr class="open"><td>0</td><td colspan="3"><b>open</b> cycle ${short(ch.cycleId)} for work ${esc(c.workId)}${c.parentCycleId ? `, parent ${short(c.parentCycleId)}` : ''} <span class="dim">(row 0, the store's own marker)</span></td></tr>`);
      if (c.parentCycleId) diagram.travel('ESCALATED', 'QUEUED');
      setTimeout(() => { diagram.reset(); diagram.current('QUEUED'); }, c.parentCycleId ? 900 : 0);
      if (ch.cycleId === state.cycleId || !state.cycleId) board(c);
      return;
    }
    if (ch.kind === 'duplicate' || ch.kind === 'refused') {
      tbody.insertAdjacentHTML('beforeend', `<tr class="ignored"><td>–</td><td colspan="3">${ch.kind === 'duplicate' ? 'not written: this run already has an outcome' : 'refused before writing: apply could not classify it'} <code>${esc(ch.body.slice(0, 90))}</code></td></tr>`);
      return;
    }
    const h = ch.cycle.history.at(-1);
    const moved = h.from !== h.to;
    const tr = document.createElement('tr');
    tr.className = moved ? '' : 'still';
    tr.innerHTML = `<td>${ch.seq}</td><td><b>${ch.event.type}</b><div class="small dim">${summary(ch.event)}</div></td><td class="mono small">${moved ? `${h.from}<br>→ <b>${h.to}</b>` : `<span class="dim">${h.to}</span>`}</td><td class="small">${esc(h.note ?? '')}</td>`;
    tr.addEventListener('click', () => { const pre = $('.row-json'); pre.hidden = false; pre.innerHTML = highlight(JSON.stringify(ch.event, null, 2)); });
    tbody.append(tr);
    tr.scrollIntoView({ block: 'nearest' });
    if (moved) diagram.travel(h.from, h.to);
    diagram.current(h.to);
    if (ch.cycleId === state.cycleId) board(ch.cycle);
  });

  // ---- the actors -----------------------------------------------------------------------------
  const timeline = $('.timeline');
  function card(kind, title) {
    timeline.querySelector('.hint')?.remove();
    for (const old of timeline.querySelectorAll('.actor.open')) old.classList.remove('open');
    const c = document.createElement('div');
    c.className = `actor open ${kind}`;
    c.innerHTML = `<div class="actor-head"><span class="who">${title}</span><span class="clock"></span></div><div class="actor-body"></div>`;
    c.querySelector('.actor-head').addEventListener('click', () => c.classList.toggle('open'));
    timeline.append(c);
    c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return { c, body: c.querySelector('.actor-body'), done(text, cls = '') { c.classList.remove('open'); c.querySelector('.clock').innerHTML = `<span class="pill ${cls}">${text}</span>`; } };
  }
  const narrate = (html) => { timeline.insertAdjacentHTML('beforeend', `<div class="narrate small">${html}</div>`); timeline.lastElementChild.scrollIntoView({ block: 'nearest' }); };

  world.ui.stage = (name, d) => {
    if (name === 'develop') {
      state.cycleId = d.cycleId;
      narrate(`<b>src/run.ts</b> → <code>develop()</code>: resolved the base <code>${short(d.base)}</code>, opened cycle <code>${short(d.cycleId)}</code>, made the clone <code>${esc(d.worktree)}</code> on branch <code>${esc(d.branch)}</code>.`);
      interfere(true);
    }
    if (name === 'fix') narrate(`<b>src/run.ts</b> → <code>fix()</code>: the cycle is back in DEVELOPING after a standard FAIL. Same clone, same branch, prompted with ${d.findings?.length ?? 0} findings.`);
    if (name === 'land') narrate(d.refused ? `<b>controller</b>: fetched the branch and judged <code>${short(d.head)}</code> with the real <code>refuse</code>: <span class="bad-t">${esc(d.refused)}</span>. The claim becomes <code>run_failed</code>.` : `<b>controller</b>: fetched the branch; <code>${short(d.head)}</code> is the tip, descends from the base and changes something. <code>${esc(d.branch)}</code> now points at it.`);
    if (name === 'verify') narrate(`<b>src/run.ts</b> → <code>verify()</code>: a fresh checkout of <code>${short(d.head)}</code> with no <code>.git</code>, at <code>${esc(d.worktree)}</code>. The controller runs the checks, not the developer.`);
    if (name === 'review') narrate(`<b>src/run.ts</b> → <code>review()</code>: the prompt for the ${d.role.replace('_', ' ')} holds the ticket, AGENTS.md, the check results, the diff and the evidence. Never the developer's transcript.`);
  };

  function countdown(c, deadlineMs, signal) {
    const end = Date.now() + deadlineMs, clock = c.c.querySelector('.clock');
    const t = setInterval(() => {
      const left = Math.max(0, end - Date.now());
      clock.textContent = `deadline in ${(left / 1000).toFixed(left < 10000 ? 1 : 0)} s`;
      clock.classList.toggle('bad-t', left < 5000);
    }, 100);
    signal.addEventListener('abort', () => clearInterval(t), { once: true });
    return () => clearInterval(t);
  }

  // The runtime's stdout for a reply, so the real parser reads it the way it reads a live run.
  function asRuntime(runtime, text, crash) {
    if (runtime === 'claude') {
      if (crash) return claude.parse(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529 {"type":"overloaded_error"}', api_error_status: 529 }), '', 1);
      return claude.parse(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: crypto.randomUUID() }), '', 0);
    }
    if (crash) return pi.parse('{"type":"session","id":"s1"}\n', 'Error: No API key found for provider anthropic', 1);
    const lines = [{ type: 'session', id: crypto.randomUUID() }, { type: 'turn_end', message: { role: 'assistant', content: [{ type: 'text', text }] } }, { type: 'agent_end' }];
    return pi.parse(lines.map((l) => JSON.stringify(l)).join('\n'), '', 0);
  }

  // One adapter per role. start() shows the reader a card and settles when they (or the
  // autopilot) send a reply; it settles `cancelled` when the controller aborts it at the deadline.
  function adapter(role, runtime) {
    return { name: runtime, start: (req, signal) => (role === 'developer' ? developerTurn(req, signal, runtime) : reviewerTurn(role, req, signal, runtime)) };
  }

  function turn(role) { state.turns[role] = (state.turns[role] ?? -1) + 1; return (preset[role] ?? [])[state.turns[role]] ?? {}; }

  function replyButtons(body) {
    body.insertAdjacentHTML('beforeend', `<div class="row"><button class="primary send">Send reply</button><button class="bad crash">Crash</button><button class="hang">Go silent</button></div>`);
  }
  function settleWith(c, runtime, signal, getText, stop) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome, label, cls) => { if (settled) return; settled = true; stop(); scripted.delete(c); c.body.querySelector('.step-row')?.remove(); c.done(label, cls); resolve(outcome); };
      signal.addEventListener('abort', () => finish({ status: 'cancelled' }, 'deadline: stopped', 'bad'), { once: true });
      c.body.querySelector('.send').addEventListener('click', () => {
        const o = asRuntime(runtime, getText());
        finish(o, o.status === 'completed' ? 'replied' : `parse: ${o.reason}`, o.status === 'completed' ? 'good' : 'bad');
      });
      c.body.querySelector('.crash').addEventListener('click', () => finish(asRuntime(runtime, '', true), 'crashed', 'bad'));
      c.body.querySelector('.hang').addEventListener('click', (e) => { e.target.disabled = true; c.body.querySelector('.send').disabled = true; c.body.insertAdjacentHTML('beforeend', '<p class="small muted">Silent. The controller waits until its deadline, then stops the run.</p>'); });
    });
  }

  async function developerTurn(req, signal, runtime) {
    const script = turn('developer');
    const cycleId = req.cwd.split('/').pop();
    const c = card('agent', `DEVELOPER · ${runtime} · run ${short(req.runId)}`);
    const stop = countdown(c, state.job.deadlineMs, signal);
    c.body.innerHTML = `
      <details><summary class="small">The prompt it was given <span class="tag real">real prompt()</span></summary><pre class="wrap small">${esc(req.prompt)}</pre></details>
      <div class="row"><label>Change</label><select class="change">${Object.entries(CHANGES).map(([k, ch]) => `<option value="${k}">${esc(ch.label)}</option>`).join('')}</select><button class="commit">git commit</button></div>
      <pre class="diff small" hidden></pre>
      <label>Its reply <span class="dim">(ends with the claim: a fenced json block)</span></label>
      <textarea class="reply" rows="6" placeholder="Commit first; the reply fills in."></textarea>`;
    replyButtons(c.body);
    const sel = c.body.querySelector('.change'), reply = c.body.querySelector('.reply');
    if (script.change) sel.value = script.change;
    const commit = () => {
      const ch = CHANGES[sel.value];
      const tipBefore = world.repo.refs.get(cloneRef(cycleId));
      const head = world.repo.commit(cloneRef(cycleId), ch.files, ch.message);
      const d = world.repo.diff(tipBefore, head);
      const pre = c.body.querySelector('.diff');
      pre.hidden = false;
      pre.innerHTML = `<span class="dim">[${esc(`sf/${short(cycleId)}`)} ${short(head)}] ${esc(ch.message)}</span>\n` + (d ? colorDiff(d) : '<span class="dim">(no changes: the tree is the same as before)</span>');
      const base = state.cycle()?.candidate?.base;
      const claimed = script.claimHead === 'base' ? base : head;
      reply.value = script.reply ?? `I implemented the ticket and committed it.\n\n\`\`\`json\n${JSON.stringify({ head: claimed, artifacts: Object.keys(ch.files) })}\n\`\`\``;
    };
    c.body.querySelector('.commit').addEventListener('click', commit);
    const outcome = settleWith(c, runtime, signal, () => reply.value, stop);
    if (autoplay(c)) {
      (async () => {
        if (!await pace(c, 'the developer commits', 1, signal)) return;
        commit();
        if (!await pace(c, script.hang ? 'the developer goes silent' : 'the developer sends its reply', 1.5, signal)) return;
        c.body.querySelector(script.hang ? '.hang' : '.send').click();
      })();
    }
    return outcome;
  }

  async function reviewerTurn(role, req, signal, runtime) {
    const key = role === 'standard_reviewer' ? 'standard' : 'adversarial';
    const script = turn(key);
    const c = card('agent', `${key.toUpperCase()} REVIEWER · ${runtime} · run ${short(req.runId)}`);
    const stop = countdown(c, state.job.deadlineMs, signal);
    const cycle = state.cycle();
    const prev = cycle.history.filter((h) => h.event.type === 'verification').map((h) => h.event.head).filter((h) => h !== cycle.candidate.head).at(-1);
    c.body.innerHTML = `
      <details><summary class="small">The prompt it was given <span class="tag real">real buildPrompt()</span> · ${req.prompt.length.toLocaleString()} characters</summary><pre class="wrap small">${esc(req.prompt)}</pre></details>
      <div class="row"><label><input type="radio" name="v-${req.runId}" value="PASS" checked> PASS</label><label><input type="radio" name="v-${req.runId}" value="FAIL"> FAIL</label>
        <label>reviewed SHA</label><select class="sha"><option value="${cycle.candidate.head}">the candidate ${short(cycle.candidate.head)}</option>${prev ? `<option value="${prev}">the previous candidate ${short(prev)} (stale)</option>` : ''}<option value="">(none)</option></select></div>
      <label>Findings <span class="dim">(one per line: file:line — what is wrong)</span></label>
      <textarea class="findings" rows="3"></textarea>
      <label>Its reply</label>
      <textarea class="reply" rows="5"></textarea>`;
    replyButtons(c.body);
    const q = (s) => c.body.querySelector(s);
    let edited = false;
    const compose = () => {
      if (edited) return;
      const verdict = c.body.querySelector(`input[name="v-${req.runId}"]:checked`).value;
      const findings = q('.findings').value.split('\n').map((s) => s.trim()).filter(Boolean);
      q('.reply').value = `${verdict === 'PASS' ? 'The diff meets every requirement in the ticket and the evidence shows it.' : 'The change does not meet the ticket.'}\n\n\`\`\`json\n${JSON.stringify({ head: q('.sha').value, verdict, findings })}\n\`\`\``;
    };
    c.body.addEventListener('input', (e) => { if (e.target.classList.contains('reply')) edited = true; else compose(); });
    c.body.addEventListener('change', compose);
    if (script.verdict) c.body.querySelector(`input[value=${script.verdict}]`).checked = true;
    if (script.findings) q('.findings').value = script.findings.join('\n');
    if (script.sha === 'previous' && prev) q('.sha').value = prev;
    compose();
    const outcome = settleWith(c, runtime, signal, () => q('.reply').value, stop);
    if (autoplay(c)) (async () => { if (await pace(c, `the ${key} reviewer sends its verdict`, 1.6, signal)) q('.send').click(); })();
    return outcome;
  }

  world.ui.checks = (found, head, deadlineMs) => new Promise((resolve) => {
    const script = turn('checks');
    const c = card('ctl', `CONTROLLER · verify · ${short(head)}`);
    c.body.innerHTML = `<table class="small"><thead><tr><th>check</th><th>command</th><th>binary</th><th>how it behaves</th></tr></thead><tbody>${found.map((f, i) => `
      <tr><td><b>${esc(f.check.name)}</b></td><td><code>${esc((f.check.command ?? []).join(' '))}</code></td>
      <td class="small">${f.missing ? `<span class="pill MISSING">MISSING</span> ${esc(f.missing)}` : `<code>${esc(f.path)}</code>`}</td>
      <td>${f.missing ? '<span class="dim">never runs</span>' : `<select data-i="${i}"><option value="pass">exits 0</option><option value="fail">exits 1</option><option value="timeout">runs past the deadline</option></select>`}</td></tr>`).join('')}</tbody></table>
      <label><input type="checkbox" class="dirty"> a check rewrote a tracked file, as a formatter would</label>
      <div class="row"><button class="primary runchecks">Run the checks</button></div>`;
    for (const s of c.body.querySelectorAll('select')) { const name = found[s.dataset.i].check.name; if (script[name]) s.value = script[name]; }
    if (script.dirty) c.body.querySelector('.dirty').checked = true;
    let ran = false;
    const go = () => {
      if (ran) return;
      ran = true;
      scripted.delete(c);
      c.body.querySelector('.step-row')?.remove();
      const results = [...c.body.querySelectorAll('select')].map((s) => ({ check: found[s.dataset.i].check, behaviour: s.value }));
      c.done('checks ran', '');
      setTimeout(() => evidenceView(c, head), 0);
      resolve({ results, dirty: c.body.querySelector('.dirty').checked });
    };
    c.body.querySelector('.runchecks').addEventListener('click', go, { once: true });
    if (autoplay(c)) pace(c, 'the controller runs the checks', 1).then((ok) => ok && go());
    void deadlineMs;
  });

  function evidenceView(c, head) {
    const dir = `${RUNS}/evidence/${head}`;
    const files = readdirSync(dir).sort();
    c.body.insertAdjacentHTML('beforeend', `<p class="small">Evidence in <code>${esc(dir)}</code>, bound to the SHA:</p>` +
      files.map((f) => `<details><summary class="small mono">${esc(f)}</summary><pre class="small wrap">${esc(readFileSync(`${dir}/${f}`, 'utf8') || '(empty)')}</pre></details>`).join(''));
  }

  // ---- interference: other processes writing to the same store --------------------------------
  function interfere(on) { for (const b of el.querySelectorAll('.interfere button')) b.disabled = !on; }
  $('.i-cancel').addEventListener('click', () => { if (state.cycleId) store.append(state.cycleId, { type: 'cancel' }); narrate('<b>owner</b>: <code>node src/main.ts cancel job.json</code> from another terminal. The running agent is not told; its result will arrive at a settled cycle and change nothing.'); });
  $('.i-base').addEventListener('click', () => {
    const sha = world.repo.commit('main', { 'README.md': world.repo.commits.get(world.repo.resolve('main')).tree['README.md'] + '\nSee also: todo help.\n' }, 'docs: mention help');
    store.append(state.cycleId, { type: 'base_changed', base: sha });
    narrate(`<b>someone</b> merged into main (now <code>${short(sha)}</code>). The candidate was built and verified on the old base, so the cycle cannot carry on silently.`);
  });
  $('.i-head').addEventListener('click', () => {
    const sha = world.repo.write(world.repo.resolve('main'), { 'NOTES.md': 'hand edit\n' }, 'hand edit');
    store.append(state.cycleId, { type: 'head_changed', head: sha });
    narrate(`<b>someone</b> pushed <code>${short(sha)}</code> to the cycle's branch outside a fix run.`);
  });

  // ---- running --------------------------------------------------------------------------------
  const term = $('.term');
  const say = (s) => { term.textContent += s + '\n'; };

  async function go() {
    let job;
    try { job = jobFromForm(); } catch (err) { term.textContent = `$ node src/main.ts job.json\n${err.message}\n`; return; }
    state.job = job;
    state.turns = {};
    state.running = true;
    $('.go').disabled = true;
    $('.owner-actions').innerHTML = '';
    term.textContent = '$ node src/main.ts job.json\n';
    // A run on main after a merge starts from main's new tip: the factory always resolves HEAD.
    try {
      const adapters = { developer: adapter('developer', job.runtime.developer), standard: adapter('standard_reviewer', job.runtime.standard), adversarial: adapter('adversarial_reviewer', job.runtime.adversarial) };
      const open = store.cycles(job.workId).find((c) => !SETTLED.includes(c.stage));
      if (open) throw new Error(`work ${job.workId} already has an open cycle ${open.cycleId}`);
      const r = await run(store, adapters, job, { deadlineMs: job.deadlineMs, runsDir: RUNS, sandbox: { backend: 'bwrap' } });
      print(r, job);
      prView(r.cycle);
    } catch (err) {
      console.error(err);
      say(err.message);
      say('(exit 2)');
    } finally {
      state.running = false;
      interfere(false);
      $('.go').disabled = false;
      ownerActions();
    }
  }

  // The lines src/main.ts#main prints after a run.
  function print(r, job) {
    const { cycle } = r;
    say(`Stage: ${cycle.stage}`); say(`Cycle: ${cycle.cycleId}`); say(`Branch: ${r.branch}`);
    say(`Head: ${cycle.candidate?.head || '(none)'}`); say(`Base: ${cycle.candidate?.base ?? '(none)'}`);
    say(`Worktree: ${r.worktree}`); say('Sandbox: bwrap'); say(`Reviews: standard ${cycle.standard}, adversarial ${cycle.adversarial}`);
    for (const h of cycle.history) {
      const e = h.event;
      if (e.type === 'verification') say(`verification ${e.head.slice(0, 7)}: ${e.checks.map((c) => `${c.name} ${c.result}`).join(', ') || 'no checks'}`);
      if (e.type === 'verdict') {
        const role = h.from === 'STANDARD_REVIEW' ? 'standard_reviewer' : h.from === 'ADVERSARIAL_REVIEW' ? 'adversarial_reviewer' : 'reviewer';
        say(`${role} ${e.head.slice(0, 7)}: ${e.verdict}`);
        for (const f of Array.isArray(e.findings) ? e.findings : []) say(`  - ${f}`);
      }
    }
    if (cycle.escalation) say(`Escalation: ${cycle.escalation}`);
    if (r.error) say(`Error: ${r.error}`);
    if (cycle.stage === 'AWAITING_ACCEPTANCE') {
      say(''); say('To review, accept and merge:');
      say(`  git -C ${job.repo} diff ${cycle.candidate.base}..${cycle.candidate.head}`);
      say(`  node src/main.ts accept job.json ${cycle.candidate.head}`);
      say(`  git -C ${job.repo} merge --no-ff ${cycle.candidate.head}`);
      say('(exit 0)');
    } else say('(exit 1)');
  }

  function ownerActions() {
    const box = $('.owner-actions');
    const c = state.cycle();
    box.innerHTML = '';
    const btn = (label, cls, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.addEventListener('click', fn); box.append(b); };
    if (!c) return;
    if (c.stage === 'AWAITING_ACCEPTANCE') {
      btn(`Accept ${short(c.candidate.head)}`, 'owner primary', () => decide('accept'));
      btn('Request changes', 'owner', () => decide('request_changes'));
      btn('Cancel', 'owner', () => decide('cancel'));
    } else if (c.stage === 'ACCEPTED' && !state.merged.includes(c.cycleId)) {
      btn(`git merge --no-ff ${short(c.candidate.head)}`, 'owner primary', merge);
    } else if (c.stage === 'ESCALATED') {
      btn('Open a child cycle (run again)', 'owner primary', () => { state.parent = c.cycleId; showJob(); say(`\n# parentCycleId: ${c.cycleId} added to job.json`); go(); });
      btn('Cancel', 'owner', () => decide('cancel'));
    } else if (SETTLED.includes(c.stage) || c.stage === 'ACCEPTED') {
      btn('Next ticket on the same repository', 'owner', () => { state.parent = undefined; state.cycleId = undefined; diagram.reset(); board(); showJob(); $('.workId').value = nextWork($('.workId').value); showJob(); });
    }
  }
  const nextWork = (w) => w.replace(/(\d+)$/, (n) => String(Number(n) + 1).padStart(n.length, '0'));

  // What src/main.ts accept and cancel do: refuse rather than send an event apply would escalate on.
  function decide(kind) {
    const c = state.cycle();
    if (kind === 'accept') {
      say(`\n$ node src/main.ts accept job.json ${c.candidate.head}`);
      const after = store.append(c.cycleId, { type: 'accept', head: c.candidate.head });
      say(`Cycle: ${after.cycleId}`); say(`Stage: ${after.stage}`);
      if (after.stage === 'ACCEPTED') { say(''); say('To merge:'); say(`  git -C ${REPO} merge --no-ff ${c.candidate.head}`); }
    } else if (kind === 'cancel') {
      say('\n$ node src/main.ts cancel job.json');
      const after = store.append(c.cycleId, { type: 'cancel' });
      say(`Cycle: ${after.cycleId}`); say(`Stage: ${after.stage}`);
      state.parent = undefined;
    } else {
      say('\n# owner requests changes');
      store.append(c.cycleId, { type: 'request_changes' });
    }
    ownerActions();
    prView(state.cycle());
  }

  function merge() {
    const c = state.cycle();
    const main = world.repo.resolve('main');
    const tree = world.repo.commits.get(c.candidate.head).tree;
    const changes = Object.fromEntries(Object.entries(tree));
    for (const p of Object.keys(world.repo.commits.get(main).tree)) if (!(p in tree)) changes[p] = null;
    const m = world.repo.commit('main', changes, `Merge ${short(c.candidate.head)} (sf/${short(c.cycleId)})`);
    state.merged.push(c.cycleId);
    say(`\n$ git -C ${REPO} merge --no-ff ${c.candidate.head}`);
    say(`Merge made by the 'ort' strategy. main is now ${short(m)}.`);
    ownerActions();
    prView(c, m);
  }

  function prView(cycle, merged) {
    const pr = $('.pr');
    if (!cycle?.candidate?.head) { pr.innerHTML = `<p class="muted small">No candidate: ${esc(cycle?.escalation ?? 'the developer produced no commit the controller accepted')}.</p>`; return; }
    const { head, base } = cycle.candidate;
    if (!world.repo.commits.has(head)) { pr.innerHTML = `<p class="muted small">The head <code>${short(head)}</code> is not a commit in the repository.</p>`; return; }
    const commits = world.repo.log(head).filter((x) => x.sha !== base && !world.repo.isAncestor(x.sha, base));
    const verdicts = cycle.history.filter((h) => h.event.type === 'verdict').map((h) => `<span class="pill ${h.event.verdict}">${h.from === 'ADVERSARIAL_REVIEW' ? 'adversarial' : 'standard'} ${h.event.verdict} · ${short(h.event.head)}</span>`).join(' ');
    pr.innerHTML = `<div class="row"><b class="mono">sf/${short(cycle.cycleId)}</b> → <b class="mono">main</b> <span class="pill ${cycle.stage}">${merged ? 'MERGED' : cycle.stage}</span></div>
      <div class="row small">${verdicts || '<span class="dim">no verdicts</span>'}</div>
      <p class="small">${commits.map((x) => `<code>${short(x.sha)}</code> ${esc(x.message)}`).join('<br>')}</p>
      <pre class="diff small">${colorDiff(world.repo.diff(base, head))}</pre>`;
  }

  $('.go').addEventListener('click', go);
  $('.reset').addEventListener('click', () => location.reload());
}

function colorDiff(d) {
  return d.split('\n').map((l) => `<span class="${l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') || l.startsWith('diff') ? 'hunk' : ''}">${esc(l)}</span>`).join('\n');
}
