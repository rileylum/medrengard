// Run by tests/kits.test.ts in a child `node --test`: an adapter whose claim has a null prototype,
// as `Object.create(null)` gives. It is plain data, and the controller accepts it.
import { runtimeKit } from '../../src/kits/runtime.ts';

runtimeKit('null-proto', () => ({
  name: 'null-proto',
  async start() { return { status: 'completed', claim: Object.assign(Object.create(null), { head: 'H1', artifacts: [] }) }; },
}));
