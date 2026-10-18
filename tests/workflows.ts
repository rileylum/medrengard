// Workflows other than the default, shared by the lifecycle and store tests (09-a).
import type { Cycle, Workflow } from '../src/lifecycle.ts';

/** The scenario table's [standard, adversarial] view of a default-workflow cycle's budgets. */
export const counters = (c: Cycle) => [c.budgets.STANDARD_REVIEW ?? 0, c.budgets.ADVERSARIAL_REVIEW ?? 0];

/** Human acceptance is policy (A-054): the last review's PASS settles the cycle. */
export const noHuman: Workflow = {
  start: 'DEV',
  stages: {
    DEV: { kind: 'agent', role: 'developer', produces: 'commit', transitions: { PASS: 'BUILD' } },
    BUILD: { kind: 'command', transitions: { PASS: 'REVIEW' } },
    REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', budget: 1, transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
  },
};
