import { readFileSync } from 'node:fs';
import type { Access, Agent, Sandbox, Workflow } from '../src/index.ts';

const example = (name: string) => new URL(`example/${name}`, import.meta.url).pathname;

/** An example agent: its role file followed by the workflow guide every role shares. */
function exampleAgent(role: string, runtime: string, sandbox: Sandbox, skills: string[] = []): Agent {
  const text = `${readFileSync(example(`${role}.md`), 'utf8')}\n${readFileSync(example('guide.md'), 'utf8')}`;
  // The runtime loads plugins from inside the sandbox, so the agent must be able to read them.
  return { runtime, role: text, skills, mcpServers: {}, sandbox: skills.length ? { ...sandbox, read: [...sandbox.read ?? [], ...skills] } : sandbox };
}

/** The shipped planner, with the plan skill as a Claude Code plugin. */
export function examplePlanner(runtime: string, sandbox: Sandbox): Agent { return exampleAgent('planner', runtime, sandbox, [example('plan-skill')]); }
/** The shipped developer: implements the approved plan and leaves the commit to the runtime. */
export function exampleDeveloper(runtime: string, sandbox: Sandbox): Agent { return exampleAgent('developer', runtime, sandbox); }
/** The shipped standard reviewer: checks the change against the plan. */
export function exampleReviewer(runtime: string, sandbox: Sandbox): Agent { return exampleAgent('reviewer', runtime, sandbox); }
/** The shipped adversarial reviewer: looks for concrete reasons not to ship. */
export function exampleAdversarial(runtime: string, sandbox: Sandbox): Agent { return exampleAgent('adversarial', runtime, sandbox); }

/**
 * Idea to PR policy; the owner supplies the agents, the `check` and `pr` extensions, and the access the check needs.
 * A failure that would end the run goes to the owner instead, and budgets are sized so an edge reaches the owner
 * before any budget runs out: at most one develop run, three fixes and three reviews per round.
 */
export function defaultWorkflows(options: { check?: Access } = {}): Workflow[] {
  return [
    { name: 'design', start: 'design', stages: {
      design: { kind: 'agent', agent: 'designer', produces: 'document', access: { workspace: 'repository' }, budget: 1, on: { done: 'approve' } },
      // Each round of owner feedback starts a fresh design run with a new budget.
      approve: { kind: 'human', on: { accept: { workflow: 'develop' }, changes: { workflow: 'design' }, reject: 'ESCALATED' } },
    } },
    { name: 'develop', start: 'develop', stages: {
      develop: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 1, on: { done: 'check' } },
      // A check runs after the develop run and after each of up to three fixes.
      check: { kind: 'command', extension: 'check', access: options.check, budget: 4, on: { PASS: 'standard', FAIL: ['fix', 'fix', 'owner', 'owner'] } },
      standard: { kind: 'agent', agent: 'standard', produces: 'verdict', budget: 2, on: { PASS: 'adversarial', FAIL: ['fix', 'owner'] } },
      fix: { kind: 'agent', agent: 'developer', produces: 'commit', budget: 3, on: { done: 'check' } },
      adversarial: { kind: 'agent', agent: 'adversarial', produces: 'verdict', budget: 1, on: { PASS: 'owner', FAIL: 'owner' } },
      // A new review budget requires the owner's decision on the current SHA.
      owner: { kind: 'human', on: { accept: 'pr', changes: { workflow: 'develop' }, reject: 'ESCALATED' } },
      pr: { kind: 'command', extension: 'pr', produces: 'document', budget: 1, on: { done: 'DONE' } },
    } },
  ];
}
