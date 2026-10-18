// Prototype (A-046): an Adapter that runs claude interactively in a herdr tab, so the owner can
// watch a stage and talk to it. The controller still decides state: the run ends only when the
// agent writes its claim file, and the claim goes through the same execute/receive guards as a
// headless run. Under bwrap the agent gets cliAdapter's policy with three changes for an
// interactive run (see sandboxed()); there is no systemd scope, so cancel closes the tab.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Adapter, RunOutcome } from '../src/adapter.ts';
import type { Role } from '../src/lifecycle.ts';
import { executables, wrap, type Sandbox } from '../src/sandbox.ts';
import { agents, herdr, newTab, readPane } from './herdr.ts';

export interface HerdrOptions {
  workId: string;
  runsDir: string;
  model?: string;
  /** The job's sandbox. `none` runs claude as the owner, unconfined. */
  sandbox: Sandbox;
}

const SHORT: Record<Role, string> = { developer: 'dev', standard_reviewer: 'std', adversarial_reviewer: 'adv' };

/** Deterministic, so the board can find the agent from the run IDs in the store. */
export function agentName(workId: string, role: Role, runId: string): string {
  const slug = workId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 18) || 'w';
  return `${slug}-${SHORT[role]}-${runId.slice(0, 6).toLowerCase()}`;
}

/** Where a run's prompt and claim live: outside the worktree and the verify checkout, which review requires clean. */
export function runDir(runsDir: string, runId: string): string {
  return join(runsDir, 'proto', runId);
}

export function herdrClaude(opts: HerdrOptions, worktree?: string): Adapter {
  return {
    name: 'claude',
    async start(req, signal): Promise<RunOutcome> {
      const dir = runDir(opts.runsDir, req.runId);
      mkdirSync(dir, { recursive: true });
      const promptFile = join(dir, 'prompt.md');
      const claimFile = join(dir, 'claim.json');
      writeFileSync(promptFile, [
        req.prompt,
        '',
        '---',
        'This run is interactive: the owner may talk to you in this terminal, and you may ask them questions here.',
        `When the work is final, write the JSON object from your final json block (the object only, no fence) to ${claimFile} with the Write tool.`,
        'The controller reads that file and nothing else. Write it once, last.',
      ].join('\n'));
      // `//` is the filesystem root in a permission rule; a single `/` is relative to the project (cli-adapter.ts).
      const own = [`Write(/${dir}/**)`, `Edit(/${dir}/**)`];
      const allowed = req.role === 'developer'
        ? ['Read', 'Glob', 'Grep', ...(worktree ? [`Edit(/${worktree}/**)`, `Write(/${worktree}/**)`] : []), ...['add', 'commit', 'status', 'rev-parse', 'diff', 'log'].map((s) => `Bash(git ${s}:*)`), ...own]
        : ['Read', 'Glob', 'Grep', ...own];
      // User settings only: a .claude/settings.json in the candidate would add hooks and allow rules.
      const args = ['--setting-sources', 'user', '--strict-mcp-config', '--add-dir', dir, ...(opts.model ? ['--model', opts.model] : []), '--allowedTools', ...allowed];
      const name = agentName(opts.workId, req.role, req.runId);
      let command: string[];
      try {
        command = opts.sandbox.backend === 'none' ? ['claude', ...args] : sandboxed(opts.sandbox, req.role, req.cwd, dir, args);
      } catch (err) {
        return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
      }
      const { tabId, paneId } = newTab(`${opts.workId} ${SHORT[req.role]}`, req.cwd);
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ workId: opts.workId, role: req.role, name, tabId, paneId, cwd: req.cwd }));
      try {
        // Not `herdr agent start`: it runs the canonical `claude` itself, so nothing could wrap it.
        // herdr detects claude in the pane on its own; the rename gives it the name the board looks for.
        herdr('pane', 'run', paneId, command.map(shellQuote).join(' '));
        if (!(await detected(paneId, signal))) {
          if (signal.aborted) return cancel(tabId);
          return { status: 'failed', reason: `herdr did not detect claude in ${tabId} within 60 s` };
        }
        herdr('agent', 'rename', paneId, name);
        // Claude asks whether to trust a new git clone before it reads input, and draws that
        // dialog after herdr already reports it ready; a prompt sent into the dialog is lost.
        // So: wait out the dialog, send, and send again if the agent's state never moves.
        for (let attempt = 1; ; attempt++) {
          await sleep(2000);
          while (TRUST.test(readPane(paneId))) {
            if (signal.aborted) return cancel(tabId);
            await sleep(1000);
          }
          const before = seq(name);
          herdr('agent', 'prompt', name, `Read ${promptFile} and follow it.`);
          if (await moved(name, before, claimFile)) break;
          if (attempt === 3) return { status: 'failed', reason: `claude in ${tabId} did not start on the prompt` };
        }
      } catch (err) {
        return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
      }
      for (;;) {
        if (signal.aborted) return cancel(tabId);
        if (existsSync(claimFile)) {
          // A half-written file parses on a later poll; a bad one stays for the owner to fix in the tab.
          try { return { status: 'completed', claim: JSON.parse(readFileSync(claimFile, 'utf8')) }; } catch { /* keep waiting */ }
        }
        if (!agents().some((a) => a.name === name)) return { status: 'failed', reason: `claude in ${tabId} exited without writing ${claimFile}` };
        await sleep(1000);
      }
    },
  };
}

const TRUST = /trust this folder/i;

/**
 * cliAdapter's policy for this role (src/runtime/cli-adapter.ts), changed in three ways for an
 * interactive run, each found in the 2026-10-18 spike (README):
 * - No `--new-session`: herdr detects an agent only in the pane's foreground process group. That
 *   flag stops the agent pushing input into its terminal with TIOCSTI, which in a herdr pane would
 *   run as the owner once claude exits; so the run is refused unless the kernel blocks TIOCSTI.
 * - claude starts through a symlink named `claude`: herdr matches the process name, and the real
 *   binary is named after its version.
 * - The run directory is writable (prompt and claim), `~/.claude` is a throwaway overlay, and
 *   `~/.claude.json` is a per-run copy: interactive claude writes both, and read-only it cannot
 *   save the trust dialog or its transcript.
 */
function sandboxed(sandbox: Sandbox, role: Role, cwd: string, dir: string, args: string[]): string[] {
  let tiocsti = '1';
  try { tiocsti = readFileSync('/proc/sys/dev/tty/legacy_tiocsti', 'utf8').trim(); } catch { /* kernel before 6.2: TIOCSTI always on */ }
  if (tiocsti !== '0') throw new Error('sandboxed interactive runs need dev.tty.legacy_tiocsti = 0 (sysctl), so the agent cannot type into its pane');
  const found = executables('claude', cwd)[0];
  if (!found) throw new Error('claude not found on PATH');
  const bin = realpathSync(found);
  const home = homedir();
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const writes = role === 'developer';
  const [cmd, wrapped] = wrap(sandbox, {
    cwd, write: [...(writes ? [cwd] : []), dir], read: [dirname(bin), ...(writes ? [] : [cwd])],
    overlay: [join(home, '.claude')].filter((p) => existsSync(p)), network: true, home, tmp,
  }, bin, args);
  const extra = ['--dir', '/run/sf', '--symlink', bin, '/run/sf/claude'];
  const config = join(home, '.claude.json');
  if (existsSync(config)) {
    // A copy, so nothing a run writes there reaches the owner's own claude or the next run.
    const copy = join(dir, 'claude.json');
    copyFileSync(config, copy);
    chmodSync(copy, 0o600);
    extra.push('--bind', copy, config);
  }
  const out = wrapped.filter((a) => a !== '--new-session');
  out.splice(out.indexOf('--remount-ro'), 0, ...extra);
  out[out.indexOf('--') + 1] = '/run/sf/claude';
  return [cmd, ...out];
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Whether herdr sees an agent in the pane within 60 s. */
async function detected(paneId: string, signal: AbortSignal): Promise<boolean> {
  for (let i = 0; i < 60 && !signal.aborted; i++) {
    if (agents().some((a) => a.pane_id === paneId)) return true;
    await sleep(1000);
  }
  return false;
}

function seq(name: string): number {
  try { return herdr('agent', 'get', name).agent.state_change_seq as number; } catch { return -1; }
}

/** Whether the agent changed state (or already wrote its claim) within ten seconds. */
async function moved(name: string, before: number, claimFile: string): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    if (seq(name) !== before || existsSync(claimFile)) return true;
  }
  return false;
}

function cancel(tabId: string): RunOutcome {
  try { herdr('tab', 'close', tabId); } catch { /* already gone */ }
  return { status: 'cancelled' };
}
