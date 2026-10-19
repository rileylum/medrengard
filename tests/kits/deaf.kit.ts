// Run by tests/kits.test.ts in a child `node --test`: an adapter that completes in 200 ms, but
// once aborted never settles. The kit must fail it.
import { runtimeKit } from '../../src/kits/runtime.ts';

runtimeKit('deaf', () => ({
  name: 'deaf',
  start: (_req, signal) => new Promise((resolve) => {
    const done = setTimeout(() => resolve({ status: 'completed', claim: { head: 'H1', artifacts: [] } }), 200);
    signal.addEventListener('abort', () => clearTimeout(done));
  }),
}));
