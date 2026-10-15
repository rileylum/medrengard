// Fake runtime for the pipe-held-open test: spawns a grandchild that keeps stdout for 3 s, then
// exits 0 itself at once.
import { spawn } from 'node:child_process';
// unref, or the live grandchild handle keeps this process alive and it never exits early.
spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: 'inherit' }).unref();
console.log('ready');
