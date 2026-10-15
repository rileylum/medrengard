// Fake runtime for the process-group test: spawns a grandchild that shares stdout and, after a
// delay, writes a marker file. Then ignores SIGTERM and idles. argv[2] is the marker path.
import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(process.argv[2])}, "late"), 2500)`], {
  stdio: 'inherit',
});
process.on('SIGTERM', () => {});
console.log('ready');
setInterval(() => {}, 1000);
