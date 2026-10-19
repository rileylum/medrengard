// Run by tests/kits.test.ts in a child `node --test`: an adapter whose completed outcome has
// `sessionId: undefined`, as claude's parse returns when the reply has no session_id, and a claim
// field set to undefined. The round trip drops both, and the controller accepts it.
import { runtimeKit } from '../../src/kits/runtime.ts';

runtimeKit('no-session', () => ({
  name: 'no-session',
  async start() { return { status: 'completed', claim: { head: 'H1', artifacts: [], dispute: undefined }, sessionId: undefined }; },
}));
