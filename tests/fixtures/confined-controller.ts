import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, commandRuntime } from '../../src/index.ts';

const [directory, mode] = process.argv.slice(2);
// A detached spawn calls setsid. Its marker names a host-visible writable path,
// so losing the controller's pipes cannot hide a surviving descendant.
const descendant = `
const fs = require('node:fs');
const [marker, ready] = process.argv.slice(1);
const fields = fs.readFileSync('/proc/self/stat', 'utf8').split(' ');
if (Number(fields[4]) !== process.pid || Number(fields[5]) !== process.pid) throw Error('not a new session');
const attemptAt = Date.now() + 4000;
setTimeout(() => fs.writeFileSync(marker, 'survived'), 4000);
fs.writeFileSync(ready + '.tmp', JSON.stringify({ attemptAt }));
fs.renameSync(ready + '.tmp', ready);
`;
const agent = `
const {spawn} = require('node:child_process');
const {readFileSync} = require('node:fs');
const {workspace} = JSON.parse(readFileSync(0, 'utf8'));
spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, workspace + '/late', workspace + '/ready', process.argv[1]], {detached: true, stdio: 'ignore'});
setInterval(() => {}, 1000);
`;
const controller = new Controller({
  path: join(directory, 'events.sqlite'), directory: join(directory, 'runs'), repository: join(directory, 'repo'),
  deadlineMs: mode === 'deadline' ? 2000 : 30000,
  workflows: [{ name: 'confinement', start: 'develop', stages: {
    develop: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'DONE' } },
  } }],
  agents: { developer: { runtime: 'command', role: '', skills: [], mcpServers: {}, sandbox: { backend: 'bwrap', read: [process.execPath] } } },
  runtimes: { command: commandRuntime([process.execPath, '-e', agent, directory]) },
});
controller.open('work', 'confinement', '');
writeFileSync(join(directory, 'workspace'), controller.state('work').workspace);
const state = await controller.advance('work');
writeFileSync(join(directory, 'result'), JSON.stringify(state));
controller.close();
