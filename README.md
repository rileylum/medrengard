# Medrengard

A primitives-first coding harness. The owner writes workflows, agents and
extensions in TypeScript; the controller validates results, spends budgets
and records events in SQLite. Candidate processes run inside bubblewrap.

The core has one entry point: [`src/index.ts`](src/index.ts). Beside it ship
a Claude Code runtime ([`extensions/claude-code`](extensions/claude-code/index.ts)),
a CLI ([`cli/medrengard.ts`](cli/medrengard.ts)) and the
[default workflow](workflows/default.ts), all importing only the core's entry
point. The default takes an idea through an approved specification,
development, checks, bounded review, owner revision and a PR extension; its
example planner role, guide and plan skill are in
[`workflows/example`](workflows/example). Roles, review limits and PR
behavior are workflow code.

## Requirements and checks

Linux, Node 24 or later, Git and bubblewrap with user namespaces available.
There are no npm dependencies.

```sh
npm test
```

Tests use stub agents and real local JSON processes, Git repositories,
bubblewrap and SQLite. They do not call paid model providers.

## Run it

A factory is a directory, outside this checkout, whose `factory.ts`
default-exports `{ options, workflow }`: the controller `Options` and the name
of the workflow `start` opens. It is trusted code. With the core at
`.medrengard/` and the token exported (the planner's sandbox declares
`env: ['CLAUDE_CODE_OAUTH_TOKEN']`), run from the factory directory:

```sh
export CLAUDE_CODE_OAUTH_TOKEN=...   # e.g. from a mode-600 file outside the factory
node .medrengard/cli/medrengard.ts start "<idea>"
node .medrengard/cli/medrengard.ts show <work>
node .medrengard/cli/medrengard.ts decide <work> <outcome> <hash> ["feedback"]
```

`start` and `decide` advance automatic stages and print the work's stage, the
current hash and plan, and the feedback so far. Outcomes are the workflow's
edge names, such as `accept` or `changes`.

## Use the primitives

Supply trusted TypeScript definitions to `new Controller(options)`, then:

```ts
controller.open('work-1', 'design', 'Describe the requested change');
await controller.advance('work-1');
let spec = controller.state('work-1');

// Ask for a revision of that exact document; the feedback reaches the next run.
controller.decide('work-1', 'changes', spec.subject!, 'Keep the knife sounds');
await controller.advance('work-1');
spec = controller.state('work-1');

// Approve the revised document's hash.
controller.decide('work-1', 'accept', spec.subject!);
await controller.advance('work-1');
```

`Options` supplies workflow definitions, agent definitions, runtime adapters,
extension functions, an event-database path, a working directory and the
owner repository. A repository is needed by stages that produce commits or
declare `workspace: 'repository'`, as the default's `design` does; such a
stage reads the work's clone, writable only when it produces a commit. See the
executable [MVP workflows](tests/e2e/mvp.test.ts) and the
[default workflow test](tests/default-workflow.test.ts) for complete examples.

An agent defines its runtime, role text, skills, MCP servers and sandbox. The
sandbox declares read paths, `network` (the host network, off by default) and
`env` (names of variables copied from the controller's environment, absent
unless declared). A runtime implements `start`, `cancel`, `result` and
`events`. `commandRuntime(argv)` supplies a generic local process adapter: it
sends a JSON request plus artifacts through stdin and reads an
`{ outcome, artifact }` JSON result from stdout. `claudeCodeRuntime` runs
headless `claude -p` with read-only tools and turns its final message into a
document. Both use `StageContext.execute` for confined execution.

A command stage executes owner-declared argv against the retained commit's
read-only snapshot. An extension stage receives the same subject and artifact
history; a PR extension chooses its review package and filters evidence by
current SHA. Human decisions bind to the current document hash or commit SHA,
and their optional feedback is recorded and passed to the next agent run.
The default workflow grants a fresh 2+1 review budget only after the owner's
`changes` decision starts another revision.

`observe` subscribes to immutable events without mutation authority. `events`
reads the log, and `state` replays it. After a crash, `recover` escalates pending
work without starting another run or spending budget again. Close the
controller with `close()` when finished.

## Boundaries

- Accepted commits are retained outside candidate-writable storage. New
  commits invalidate evidence for previous SHAs.
- Unknown outcomes, invalid artifacts and interrupted runs escalate. Failed
  gates cannot rerun on the same subject without an owner decision.
- Owner modules, including `factory.ts`, are trusted host code. Candidate text
  and output remain data; repository-supplied executable definitions are not
  supported.
- Network is all-or-nothing per agent, under a risk the owner accepted for
  phase 1 (A-146).

See the [threat model](docs/security/threat-model.md) for who gets network and
credentials and for the practical limits, with the
[parked findings](docs/work/parked.md) and
[accepted risks](docs/work/accepted-risks.md).

## Project record

[Core contract](docs/core.md) · [Status](docs/STATUS.md) ·
[Roadmap](docs/roadmap.md) · [Live runs](docs/live-runs.md) ·
[Refactor log](docs/refactor/log.md) · [Owner decisions](docs/decisions.md) ·
[Architecture](docs/architecture/source-v0.3.md)

The decision register, research and architecture preserve historical direction;
they may describe capabilities absent from the current implementation.
