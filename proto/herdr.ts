// Prototype (A-046): the few herdr CLI calls the board and the adapter need. Every call talks to
// the session named by HERDR_SOCKET_PATH, which herdr sets inside its own panes; run these from a
// herdr pane, or export it to point at a test session.
import { execFileSync } from 'node:child_process';

export interface Agent {
  name?: string;
  agent: string;
  agent_status: 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
  cwd: string;
  pane_id: string;
  tab_id: string;
  workspace_id: string;
}

/** The `result` of one herdr command. Throws with herdr's stderr on failure. */
export function herdr(...args: string[]): any {
  try {
    const out = execFileSync('herdr', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    return out.trim() ? JSON.parse(out).result : undefined;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`herdr ${args[0]} ${args[1] ?? ''}: ${(e.stderr || e.message).trim()}`);
  }
}

export function inHerdr(): boolean {
  return process.env.HERDR_ENV === '1' || !!process.env.HERDR_SOCKET_PATH;
}

export function agents(): Agent[] {
  try { return herdr('agent', 'list').agents as Agent[]; } catch { return []; }
}

/** A new unfocused tab in the caller's workspace; returns its tab and root pane IDs. */
export function newTab(label: string, cwd: string): { tabId: string; paneId: string } {
  const ws = process.env.HERDR_WORKSPACE_ID;
  const r = herdr('tab', 'create', ...(ws ? ['--workspace', ws] : []), '--cwd', cwd, '--label', label, '--no-focus');
  return { tabId: r.tab.tab_id, paneId: r.root_pane.pane_id };
}

/** Plain text: `pane read` prints the screen, not JSON. Empty if the pane is gone. */
export function readPane(paneId: string, lines = 40): string {
  try { return execFileSync('herdr', ['pane', 'read', paneId, '--source', 'visible', '--lines', String(lines)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }); } catch { return ''; }
}
