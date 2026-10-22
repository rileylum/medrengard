// Fake runtime for the killed-controller prompt test: waits, so a controller that pipes the prompt
// would have died mid-write, then reports the length and SHA-256 of everything on stdin.
import { createHash } from 'node:crypto';
const hash = createHash('sha256');
let length = 0;
setTimeout(() => {
  process.stdin.on('data', (chunk: Buffer) => { length += chunk.length; hash.update(chunk); });
  process.stdin.on('end', () => console.log(`${length} ${hash.digest('hex')}`));
}, 1000);
