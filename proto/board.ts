// Prototype (A-046): `node proto/board.ts <jobs dir>`, run in a herdr pane. One row per job file:
// the cycle's stage from the event store, the live claude agent from herdr, and what needs the
// owner. The board writes no state itself; accept and cancel go through src/main.ts, runs go
// through proto/run.ts in a tab of their own.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { oneLine } from '../src/developer.ts';
import type { Cycle } from '../src/lifecycle.ts';
import { EventStore, SETTLED } from '../src/store.ts';
import { agents, herdr, inHerdr, newTab, type Agent } from './herdr.ts';
import { loadJob, type LoadedJob } from './job.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFRESH_MS = 1500;

interface Row {
  file: string;
  job?: LoadedJob;
  error?: string;
  cycle?: Cycle;
  /** The run the cycle is waiting on, if any, and its agent in herdr. */
  active?: { runId: string; name: string; agent?: Agent; claimed: boolean };
  needs: string;
}

const dir = resolve(process.argv[2] ?? '/var/tmp/software_factory/proto/jobs');
let rows: Row[] = [];
let selected = 0;
let message = '';
const controllers = new Map<string, { tabId: string; paneId: string }>();
const lastStage = new Map<string, string>();

function latestCycle(store: EventStore, l: LoadedJob): Cycle | undefined {
  const all = store.cycles(l.job.workId);
  const open = all.find((c) => !SETTLED.includes(c.stage));
  if (open) return store.load(open.cycleId);
  // Cycle IDs are random and events carry no time; the worktree's age orders them.
  const age = (id: string) => { try { return statSync(join(l.runsDir, id)).mtimeMs; } catch { return 0; } };
  const last = all.sort((a, b) => age(a.cycleId) - age(b.cycleId)).at(-1);
  return last && store.load(last.cycleId);
}

interface RunMeta { runId: string; name: string; tabId: string; cwd: string; started: number; claimed: boolean }

/**
 * Every herdr run of a cycle, oldest first, from the adapter's meta files. The store records only
 * developer runs (the claim event), so reviewer runs are found by their cwd: the worktree is
 * `<runsDir>/<cycleId>`, the verify checkout `<runsDir>/<cycleId>-verify`.
 */
function runsOf(runsDir: string, cycleId: string): RunMeta[] {
  const root = join(runsDir, 'proto');
  if (!existsSync(root)) return [];
  const out: RunMeta[] = [];
  for (const runId of readdirSync(root)) {
    const file = join(root, runId, 'meta.json');
    try {
      const m = JSON.parse(readFileSync(file, 'utf8')) as { name: string; tabId: string; cwd: string };
      if (!m.cwd.startsWith(join(runsDir, cycleId))) continue;
      out.push({ runId, ...m, started: statSync(file).mtimeMs, claimed: existsSync(join(root, runId, 'claim.json')) });
    } catch { /* not a run directory, or half written */ }
  }
  return out.sort((a, b) => a.started - b.started);
}

function needs(cycle: Cycle | undefined, active: Row['active']): string {
  if (active?.agent?.agent_status === 'blocked') return 'APPROVE in agent tab';
  if (active && !active.agent && !active.claimed) return 'agent gone';
  if (active?.agent && !active.claimed && ['idle', 'done'].includes(active.agent.agent_status)) return 'agent waiting on you?';
  if (cycle?.stage === 'AWAITING_ACCEPTANCE') return 'ACCEPT or reject';
  if (cycle?.stage === 'ESCALATED') return 'ESCALATED: decide';
  if (!cycle) return 'not started';
  return '';
}

function refresh(): void {
  const live = new Map(agents().filter((a) => a.name).map((a) => [a.name!, a]));
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  rows = files.map((f): Row => {
    const file = join(dir, f);
    let job: LoadedJob;
    try { job = loadJob(file); } catch (err) { return { file, error: String(err), needs: 'bad job file' }; }
    // Opening the store creates it; a job that never ran has none.
    if (!existsSync(job.db)) return { file, job, needs: needs(undefined, undefined) };
    const store = new EventStore(job.db);
    try {
      const cycle = latestCycle(store, job);
      const latest = cycle && runsOf(job.runsDir, cycle.cycleId).at(-1);
      const active = latest && !latest.claimed && !SETTLED.includes(cycle!.stage)
        ? { runId: latest.runId, name: latest.name, agent: live.get(latest.name), claimed: false }
        : undefined;
      return { file, job, cycle, active, needs: needs(cycle, active) };
    } catch (err) {
      return { file, job, error: String(err), needs: 'store error' };
    } finally {
      store.close();
    }
  });
  for (const r of rows) {
    if (!r.cycle || !r.job) continue;
    const key = r.job.job.workId;
    const prev = lastStage.get(key);
    lastStage.set(key, r.cycle.stage);
    if (prev && prev !== r.cycle.stage && ['AWAITING_ACCEPTANCE', 'ESCALATED'].includes(r.cycle.stage)) {
      try { herdr('notification', 'show', `${key}: ${r.cycle.stage}`, '--sound', 'request'); } catch { /* cosmetic */ }
    }
  }
  selected = Math.min(selected, Math.max(0, rows.length - 1));
}

// ---- drawing

const ESC = '\x1b[';
const bold = (s: string) => `${ESC}1m${s}${ESC}0m`;
const dim = (s: string) => `${ESC}2m${s}${ESC}0m`;
const inverse = (s: string) => `${ESC}7m${s}${ESC}0m`;
const colour = (n: number, s: string) => `${ESC}${n}m${s}${ESC}0m`;
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

const STAGE_COLOUR: Record<string, number> = {
  AWAITING_ACCEPTANCE: 32, ACCEPTED: 32, ESCALATED: 31, CANCELLED: 90, DEVELOPING: 36, VERIFYING: 36, STANDARD_REVIEW: 35, ADVERSARIAL_REVIEW: 35,
};
const AGENT_COLOUR: Record<string, number> = { working: 36, blocked: 33, idle: 37, done: 32, unknown: 90 };

function draw(): void {
  const width = process.stdout.columns ?? 100;
  const height = process.stdout.rows ?? 30;
  const out: string[] = [];
  out.push(bold(' software factory') + dim(` — proto board · ${dir}`));
  out.push('');
  out.push(dim(`   ${pad('WORK', 16)} ${pad('STAGE', 20)} ${pad('REV', 4)} ${pad('AGENT', 30)} NEEDS`));
  rows.forEach((r, i) => {
    const work = r.job?.job.workId ?? r.file;
    const stage = r.cycle?.stage ?? (r.error ? 'ERROR' : '—');
    const rev = r.cycle ? `${r.cycle.standard}/${r.cycle.adversarial}` : '';
    const ag = r.active ? `${r.active.agent?.agent_status ?? 'gone'} ${r.active.name}` : '';
    const line = ` ${i === selected ? '>' : ' '} ${pad(work, 16)} ${pad(stage, 20)} ${pad(rev, 4)} ${pad(ag, 30)} ${r.needs}`;
    if (i === selected) out.push(inverse(pad(line, width)));
    // Colour codes would make a cut line's length wrong; a narrow pane gets the plain line.
    else if (line.length > width) out.push(pad(line, width));
    else {
      const s = ` ${' '} ${pad(work, 16)} ${colour(STAGE_COLOUR[stage] ?? 37, pad(stage, 20))} ${pad(rev, 4)} ${colour(AGENT_COLOUR[r.active?.agent?.agent_status ?? 'unknown'] ?? 37, pad(ag, 30))} ${r.needs ? colour(33, r.needs) : ''}`;
      out.push(s);
    }
  });
  if (rows.length === 0) out.push(dim(`   no *.json job files in ${dir}`));
  out.push('');
  out.push(dim('─'.repeat(width)));
  const keys = ' ↑↓ select  ⏎ agent  c controller  r run  d diff  a accept  x cancel  w close finished tabs  q quit';
  const detail = detailLines(rows[selected], width);
  const room = height - out.length - 3;
  out.push(...detail.slice(Math.max(0, detail.length - room)));
  while (out.length < height - 3) out.push('');
  out.push(dim('─'.repeat(width)));
  out.push(pad(keys, width));
  out.push(message ? colour(33, pad(' ' + message, width)) : '');
  process.stdout.write(`${ESC}H${ESC}2J` + out.slice(0, height).map((l) => l).join('\n'));
}

function detailLines(r: Row | undefined, width: number): string[] {
  if (!r) return [];
  const cut = (s: string) => (s.length > width - 1 ? s.slice(0, width - 2) + '…' : s);
  if (r.error) return [colour(31, cut(` ${r.error}`))];
  const l = r.job!;
  const lines = [bold(` ${l.job.workId}`) + dim(`  ${l.path}`), cut(` ticket: ${l.job.ticket.split('\n').find((x) => x.trim()) ?? '(none)'}`)];
  const c = r.cycle;
  if (!c) return [...lines, dim(' press r to start a run')];
  lines.push(cut(` cycle ${c.cycleId}  head ${c.candidate?.head?.slice(0, 10) || '—'}  base ${c.candidate?.base?.slice(0, 10) ?? '—'}`));
  for (const h of c.history) {
    const e = h.event as Record<string, any>;
    let what = e.type as string;
    if (e.type === 'verification') what += ' ' + (e.checks as { name: string; result: string }[]).map((k) => `${k.name}:${k.result}`).join(' ');
    if (e.type === 'verdict') what += ` ${e.verdict} on ${String(e.head).slice(0, 7)}`;
    if (e.type === 'run_failed' || e.type === 'reject_dispatch') what += `: ${oneLine(e.reason)}`;
    if (e.type === 'developer_result') what += ` ${String(e.head).slice(0, 7)}`;
    lines.push(cut(`   ${dim(pad(h.from, 19))} → ${pad(h.to, 19)} ${what}`));
    if (e.type === 'verdict') for (const f of Array.isArray(e.findings) ? e.findings : []) lines.push(cut(`       - ${oneLine(f)}`));
  }
  if (c.escalation) lines.push(colour(31, cut(` escalation: ${oneLine(c.escalation)}`)));
  return lines;
}

// ---- actions

function current(): Row | undefined { return rows[selected]; }

function mainTs(...args: string[]): string {
  const r = spawnSync(process.execPath, [join(ROOT, 'src', 'main.ts'), ...args], { encoding: 'utf8' });
  return `${r.stdout}${r.stderr}`.trim().split('\n').join(' · ');
}

function act(key: string): void {
  const r = current();
  const l = r?.job;
  message = '';
  if (!r || !l) return;
  const c = r.cycle;
  switch (key) {
    case 'return': {
      if (r.active?.agent) { herdr('agent', 'focus', r.active.name); return; }
      const ctl = controllers.get(l.job.workId);
      if (ctl) { herdr('tab', 'focus', ctl.tabId); return; }
      message = 'no live agent for this job';
      return;
    }
    case 'c': {
      const ctl = controllers.get(l.job.workId);
      if (ctl) herdr('tab', 'focus', ctl.tabId);
      else message = 'no controller tab started from this board';
      return;
    }
    case 'r': {
      if (c && !SETTLED.includes(c.stage)) { message = `cycle is ${c.stage}; it is already running or stuck — x cancels it`; return; }
      if (c?.stage === 'ESCALATED' && !l.spec.parentCycleId) { message = `ESCALATED: x cancels it, or set parentCycleId ${c.cycleId} in ${l.path}`; return; }
      const tab = newTab(`${l.job.workId} ctl`, ROOT);
      herdr('pane', 'run', tab.paneId, `node ${join(ROOT, 'proto', 'run.ts')} ${l.path}`);
      controllers.set(l.job.workId, tab);
      message = `started ${l.job.workId} in tab ${tab.tabId}`;
      return;
    }
    case 'd': {
      if (!c?.candidate?.head) { message = 'no candidate yet'; return; }
      const tab = newTab(`${l.job.workId} diff`, l.job.repo);
      herdr('pane', 'run', tab.paneId, `git -C ${l.job.repo} diff --stat --patch ${c.candidate.base} ${c.candidate.head}`);
      herdr('tab', 'focus', tab.tabId);
      return;
    }
    case 'a': {
      if (c?.stage !== 'AWAITING_ACCEPTANCE') { message = 'only an AWAITING_ACCEPTANCE cycle can be accepted'; return; }
      message = mainTs('accept', l.path, c.candidate!.head);
      return;
    }
    case 'x': {
      message = mainTs('cancel', l.path);
      // The run is over for the store; its agent would keep working on nothing.
      if (r.active?.agent) try { herdr('tab', 'close', r.active.agent.tab_id); } catch { /* gone */ }
      return;
    }
    case 'w': {
      if (!c) return;
      let closed = 0;
      for (const run of runsOf(l.runsDir, c.cycleId)) {
        if (run.runId === r.active?.runId) continue;
        try { herdr('tab', 'close', run.tabId); closed++; } catch { /* already closed */ }
      }
      message = `closed ${closed} tab(s)`;
      return;
    }
  }
}

// ---- loop

if (!inHerdr()) {
  console.error('run the board inside herdr: it opens tabs and focuses agents');
  process.exit(2);
}
emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdout.write(`${ESC}?1049h${ESC}?25l`);
const quit = () => { process.stdout.write(`${ESC}?25h${ESC}?1049l`); process.exit(0); };
process.stdin.on('keypress', (_s, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
  if (key.name === 'q' || (key.ctrl && key.name === 'c')) quit();
  if (key.name === 'up' || key.name === 'k') selected = Math.max(0, selected - 1);
  else if (key.name === 'down' || key.name === 'j') selected = Math.min(rows.length - 1, selected + 1);
  else if (key.name) {
    try { act(key.name); } catch (err) { message = err instanceof Error ? err.message : String(err); }
  }
  refresh();
  draw();
});
process.stdout.on('resize', draw);
refresh();
draw();
setInterval(() => { refresh(); draw(); }, REFRESH_MS);
