// Run by tests/kits.test.ts in a child `node --test`: an adapter whose completed outcome has
// `sessionId: undefined`, as claude's parse returns when the reply has no session_id. It keeps the contract.
import { runtimeKit } from '../../src/kits/runtime.ts';

runtimeKit('no-session', () => ({
  name: 'no-session',
  async start() { return { status: 'completed', claim: { head: 'H1', artifacts: [] }, sessionId: undefined }; },
}));
