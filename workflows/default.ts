import { readFileSync } from 'node:fs';
import type { Agent, Workflow } from '../src/index.ts';

const example = (name: string) => new URL(`example/${name}`, import.meta.url).pathname;

/** The shipped planner: its role and the workflow guide, with the plan skill as a Claude Code plugin. */
export function examplePlanner(runtime: string, sandbox: Agent['sandbox']): Agent {
  const role = `${readFileSync(example('planner.md'), 'utf8')}\n${readFileSync(example('guide.md'), 'utf8')}`;
  // The runtime loads the plugin from inside the sandbox, so the planner must be able to read it.
  return { runtime, role, skills: [example('plan-skill')], mcpServers: {}, sandbox: { ...sandbox, read: [...sandbox.read ?? [], example('plan-skill')] } };
}

/** Idea to PR policy; the owner supplies agents, check argv and the pr extension. */
export function defaultWorkflows(check: string[]): Workflow[] {
  return [
    { name: 'design', start: 'design', stages: {
      design: { kind: 'agent', agent: 'designer', produces: 'document', workspace: 'repository', budget: 1, on: { done: 'approve' } },
      // Each round of owner feedback starts a fresh design run with a new budget.
      approve: { kind: 'human', on: { accept: { workflow: 'develop' }, changes: { workflow: 'design' }, reject: 'ESCALATED' } },
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
