// src/lock.ts for the browser. One page is one process, so a work is never held by another: every
// hold succeeds and its release does nothing.
export class Locked extends Error {
  constructor(workId, pid) {
    super(`work ${workId} is held by process ${pid}, which is driving or recovering it`);
    this.workId = workId;
    this.pid = pid;
  }
}
export const holdWork = () => () => {};
export const waitForWork = async () => () => {};
