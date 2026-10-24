import type { Workflow } from '../src/index.ts';

/** Idea to PR policy; the owner supplies agents, check argv and the pr extension. */
export function defaultWorkflows(check: string[]): Workflow[] {
  return [
    { name: 'design', start: 'design', stages: {
      design: { kind: 'agent', agent: 'designer', produces: 'document', budget: 1, on: { done: 'approve' } },
      approve: { kind: 'human', on: { accept: { workflow: 'develop' }, reject: 'ESCALATED' } },
    } },
    { name: 'develop', start: 'develop', stages: {
      develop: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'check' } },
      check: { kind: 'command', command: check, budget: 2, on: { PASS: 'standard', FAIL: 'ESCALATED' } },
      standard: { kind: 'agent', agent: 'standard', produces: 'verdict', budget: 2, on: { PASS: 'adversarial', FAIL: ['fix', 'ESCALATED'] } },
      fix: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'check' } },
      adversarial: { kind: 'agent', agent: 'adversarial', produces: 'verdict', budget: 1, on: { PASS: 'owner', FAIL: 'ESCALATED' } },
      // A new review budget requires the owner's decision on the current SHA.
      owner: { kind: 'human', on: { accept: 'pr', changes: { workflow: 'develop' } } },
      pr: { kind: 'command', extension: 'pr', produces: 'document', budget: 1, on: { done: 'DONE' } },
    } },
  ];
}
