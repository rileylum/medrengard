// Workflows other than the default, shared by the lifecycle and store tests (09-a).
import type { Cycle, Workflow } from '../src/lifecycle.ts';

/** The scenario table's [standard, adversarial] view of a default-workflow cycle's budgets. */
export const counters = (c: Cycle) => [c.budgets.STANDARD_REVIEW ?? 0, c.budgets.ADVERSARIAL_REVIEW ?? 0];

/** Human acceptance is policy (A-054): the last review's PASS settles the cycle. */
export const noHuman: Workflow = {
  start: 'DEV',
  stages: {
    DEV: { kind: 'agent', role: 'developer', produces: 'commit', roleText: 'You are the developer for the ticket below.', transitions: { PASS: 'BUILD' } },
    BUILD: { kind: 'command', transitions: { PASS: 'REVIEW' } },
    REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 1, transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
  },
};

/** 09-b's second workflow: one review, then a human stage that is not AWAITING_ACCEPTANCE. No default role names. */
export const ownerCheck: Workflow = {
  name: 'owner-check',
  start: 'DEV',
  stages: {
    DEV: { kind: 'agent', role: 'writer', produces: 'commit', roleText: 'You are the writer for the ticket below.', transitions: { PASS: 'CHECK' } },
    CHECK: { kind: 'command', transitions: { PASS: 'REVIEW' } },
    REVIEW: { kind: 'agent', role: 'reviewer', produces: 'verdict', roleText: 'You are the reviewer for the change below.', budget: 1, transitions: { PASS: 'OWNER', FAIL: 'ESCALATED' } },
    OWNER: { kind: 'human', transitions: { PASS: 'ACCEPTED', FAIL: 'ESCALATED' } },
  },
};
