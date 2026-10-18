// Prototype (A-046): an Adapter that runs claude interactively in a herdr tab, so the owner can
// watch a stage and talk to it. The controller still decides state: the run ends only when the
// agent writes its claim file, and the claim goes through the same execute/receive guards as a
// headless run. Unlike cliAdapter there is no bwrap and no systemd scope: the agent runs as the
// owner with the owner's user settings, so point this at scratch repositories only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Adapter, RunOutcome } from '../src/adapter.ts';
import type { Role } from '../src/lifecycle.ts';
import { agents, herdr, newTab, readPane } from './herdr.ts';

export interface HerdrOptions {
  workId: string;
  runsDir: string;
  model?: string;
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
      const { tabId, paneId } = newTab(`${opts.workId} ${SHORT[req.role]}`, req.cwd);
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ workId: opts.workId, role: req.role, name, tabId, paneId, cwd: req.cwd }));
      try {
        herdr('agent', 'start', name, '--kind', 'claude', '--pane', paneId, '--timeout', '60000', '--', ...args);
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
