// Run by tests/kits.test.ts in a child `node --test`: an adapter that throws for the reviewer roles
// the controller sends. The kit must fail it.
import { runtimeKit } from '../../src/kits/runtime.ts';

runtimeKit('reviewer-role', () => ({
  name: 'reviewer-role',
  async start(req) {
    if (req.role === 'standard_reviewer' || req.role === 'adversarial_reviewer') throw new Error('rejects for a reviewer role');
    return { status: 'completed', claim: { head: 'H1', artifacts: [] } };
  },
}));
