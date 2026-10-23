// src/runtime/spawn.ts for the browser. The guide never starts a runtime process; demos that
// show a run use a fake adapter instead. scopePath is pure arithmetic on the cgroup path.
export const scopePath = (unit) => `/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice/${unit}.scope`;
export function spawnRuntime() { throw new Error('no processes in the browser: the guide simulates this run'); }
// A run folder is never written in the browser, so no run has finished there.
export const runFiles = (dir) => ({ stdin: `${dir}/stdin`, stdout: `${dir}/stdout`, stderr: `${dir}/stderr`, exit: `${dir}/exit` });
export const readRun = () => undefined;
