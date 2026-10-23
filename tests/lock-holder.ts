// Ticket 11-f: another live process holding a work's lock, as a controller driving it would.
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

/** Resolves once the child holds `workId`'s lock; it keeps it until killed. */
export function holder(runsDir: string, workId: string): Promise<ChildProcess> {
  const lockTs = join(import.meta.dirname, '..', 'src', 'lock.ts');
  const script = `import { holdWork } from ${JSON.stringify(lockTs)};
holdWork(${JSON.stringify(runsDir)}, ${JSON.stringify(workId)});
process.stdout.write('held\\n');
setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let err = '';
    child.stderr!.on('data', (d) => { err += d; });
    child.stdout!.once('data', () => resolve(child));
    child.once('exit', (code) => reject(new Error(`lock holder exited ${code}: ${err}`)));
  });
}

/** SIGKILLs the child and waits for it to be gone. */
export async function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise((res) => child.once('exit', res));
  child.kill('SIGKILL');
  await gone;
}
