# Medrengard

A primitives-first coding harness. The owner writes workflows, agents and
extensions in TypeScript; the controller validates results, spends budgets
and records events in SQLite. Candidate processes run inside bubblewrap.

The core has one entry point: [`src/index.ts`](src/index.ts). The shipped
[`default workflow`](workflows/default.ts) takes an idea through an approved
specification, development, checks, bounded review, owner revision and a PR
extension. Roles, review limits and PR behavior are workflow code.

## Requirements and checks

Linux, Node 24 or later, Git and bubblewrap with user namespaces available.
There are no npm dependencies.

```sh
npm test
```

Tests use stub agents and real local JSON processes, Git repositories,
bubblewrap and SQLite. They do not call paid model providers.

## Use the primitives

Supply trusted TypeScript definitions to `new Controller(options)`, then:

```ts
controller.open('work-1', 'design', 'Describe the requested change');
await controller.advance('work-1');
const spec = controller.state('work-1');

// After the owner reviews the document, approve its exact hash.
controller.decide('work-1', 'accept', spec.subject!);
await controller.advance('work-1');
```

`Options` supplies workflow definitions, agent definitions, runtime adapters,
extension functions, an event-database path and a working directory. A
repository is needed when development starts, not when a design document is
created. See the executable [MVP workflows](tests/e2e/mvp.test.ts) and the
[default workflow test](tests/default-workflow.test.ts) for complete examples.

An agent defines its runtime, role text, skills, MCP servers and sandbox read
paths. A runtime implements `start`, `cancel`, `result` and `events`.
`commandRuntime(argv)` supplies the local process adapter: it sends a JSON
request plus artifacts through stdin and reads an `{ outcome, artifact }`
JSON result from stdout. It uses `StageContext.execute` for confined execution.
This adapter is not a Claude or Pi integration.

A command stage executes owner-declared argv against the retained commit's
read-only snapshot. An extension stage receives the same subject and artifact
history; a PR extension chooses its review package and filters evidence by
current SHA. Human decisions bind to the current document hash or commit SHA.
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
- Owner modules are trusted host code. Candidate text and output remain data;
  repository-supplied executable definitions are not supported.
- Process execution has no network and provisions no provider credentials.
  There is no built-in code-host client, CLI, daemon or provider adapter.
- Snapshots use stored Git bytes without attributes, filters or LFS conversion.
  Non-UTF-8 paths/links and unsupported entries such as submodules are refused.
- Artifacts and process output are size-bounded; there are no memory/disk
  quotas. Owner decisions have no command-ID deduplication. Old event databases
  are refused rather than migrated, and interrupted runs are not adopted.

See the [threat model](docs/security/threat-model.md),
[parked findings](docs/work/parked.md) and
[accepted risks](docs/work/accepted-risks.md) for the practical limits.

## Project record

[Core contract](docs/core.md) · [Status](docs/STATUS.md) ·
[Refactor log](docs/refactor/log.md) · [Owner decisions](docs/decisions.md) ·
[Architecture](docs/architecture/source-v0.3.md)

The decision register, research and architecture preserve historical direction;
they may describe capabilities absent from the current implementation.
