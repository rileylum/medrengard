// Sync Git for the controller's own checks: develop's accept runs inside receive, which is
// synchronous. stdio is captured so a failing command surfaces as an Error naming the command,
// never as text on the controller's terminal.
import { execFileSync } from 'node:child_process';

// 64 MiB, not the 1 MiB default: a diff past the default threw ENOBUFS and stranded the cycle in
// review (06-b adversarial). review cuts what it quotes; this only has to be big enough to read.
const MAX_BUFFER = 64 * 1024 * 1024;

export function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER }).trim();
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.toString().trim();
    // The code (ENOBUFS, ENOENT) survives the rewording: review decides on it, not on the text,
    // which is git's stderr whenever there is any (06-c standard review).
    throw Object.assign(new Error(`git ${args.join(' ')} in ${cwd} failed: ${stderr || (err as Error).message}`), { code: (err as { code?: string }).code });
  }
}
