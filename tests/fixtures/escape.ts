// Fake runtime for the cgroup test (03-b finding): a grandchild leaves the process group with
// setsid (Node's `detached`) and would write a marker file 2.5 s later. Then ignores SIGTERM and
// idles. argv[2] is the marker path.
import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(process.argv[2])}, "late"), 2500)`], {
  detached: true,
  stdio: 'ignore',
}).unref();
process.on('SIGTERM', () => {});
console.log('ready');
setInterval(() => {}, 1000);
