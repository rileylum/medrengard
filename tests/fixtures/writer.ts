// Child process for the restart test: commits events one at a time, printing a line after
// each, and never exits on its own. The parent kills it after the second line.
import { EventStore } from '../../src/store.ts';

const store = new EventStore(process.argv[2]);
store.open('c1', 'w1');
store.append('c1', { type: 'claim', runId: 'dev1', base: 'B1', runtime: 'fake' });
console.log('1');
store.append('c1', { type: 'developer_result', runId: 'dev1', head: 'H1', artifacts: ['r'] });
console.log('2');
setInterval(() => {}, 1000);
