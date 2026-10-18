// node:child_process for src/ modules running in the browser. Nothing is spawned: every probe
// (bwrap, systemd-run) answers as on a machine where it works, and a demo that needs a process's
// answer sets `answer` first. `calls` records what src/ asked to run, for the demos to show.
export const calls = [];
export let answer = () => ({ status: 0, stdout: '', stderr: '', signal: null });
export const setAnswer = (fn) => { answer = fn; };
export function spawnSync(command, args = [], opts = {}) {
  calls.push({ command, args, cwd: opts.cwd });
  const r = answer(command, args, opts);
  const enc = (s) => (opts.encoding ? s : { toString: () => s, trim: () => s.trim() });
  return { pid: 0, signal: null, error: undefined, ...r, stdout: enc(r.stdout ?? ''), stderr: enc(r.stderr ?? '') };
}
export function execFileSync(command, args = [], opts = {}) {
  const r = spawnSync(command, args, { ...opts, encoding: 'utf8' });
  if (r.status !== 0) throw Object.assign(new Error(`${command} exited ${r.status}`), { stderr: r.stderr, status: r.status });
  return r.stdout;
}
export function spawn() { throw new Error('no processes in the browser: the guide simulates this run'); }
export default { spawnSync, execFileSync, spawn };
