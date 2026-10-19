// Run by tests/kits.test.ts in a child `node --test`: an adapter whose completed outcome has
// `claim: undefined`. The round trip drops it, so the controller sees no claim. The kit must fail it.
import { runtimeKit } from '../../src/kits/runtime.ts';

runtimeKit('no-claim', () => ({
  name: 'no-claim',
  async start() { return { status: 'completed', claim: undefined }; },
}));
