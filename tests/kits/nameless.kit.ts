// Run by tests/kits.test.ts in a child `node --test`: an adapter with an empty name, which the
// store refuses as an outcome's runtime. The kit must fail it.
import { runtimeKit } from '../../src/kits/runtime.ts';

runtimeKit('nameless', () => ({
  name: '',
  async start() { return { status: 'completed', claim: { head: 'H1', artifacts: [] } }; },
}));
