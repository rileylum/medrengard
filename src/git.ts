// Sync Git for the controller's own checks: develop's accept runs inside receive, which is
// synchronous. stdio is captured so a failing command surfaces as an Error naming the command,
// never as text on the controller's terminal.
import { execFileSync } from 'node:child_process';

export function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.toString().trim();
    throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${stderr || (err as Error).message}`);
  }
}
