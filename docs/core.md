# Core

The one page of what Medrengard is and what its core must hold. It overrides
`docs/plan.md`, `docs/decisions.md`, `docs/specs/`, `docs/design/` and
`docs/workflow.md` wherever they disagree; those are history.

## What it is

A primitives-first coding harness. The owner defines workflows, agents,
skills, MCP servers, sandboxes and extensions in TypeScript. The core runs
them, records every step, and lets anything observe it. The core holds
mechanism; policy is user code.

The target is to express the factory in `docs/architecture/source-v0.3.md` as
user workflows on these primitives, not as core code. The MVP is idea to PR:
a design stage that turns an idea into an approved spec, the develop and
review loop, and the owner's review-and-iterate at the end. The Design Studio
needs nothing from the core beyond these primitives; the MVP must not rule it
out.

## Primitives

The whole public API, exported from one entry point. Each stays small.

1. **Workflow.** Stages, transitions and budgets, checked before it runs. A
   workflow may end by starting another (a design workflow hands its spec to a
   develop workflow).
2. **Stage kinds.** `agent`, `command` and `human`. Extensions add
   implementations; they never change engine rules.
3. **Artifact.** What a stage produces: a commit, a verdict, or a document
   such as a spec. Each is stored and hashed. Evidence about code binds to a
   commit SHA; evidence about a document binds to its hash. Stages before any
   code exists (design) produce documents, not commits.
4. **Agent.** A runtime adapter, a role's text, skills, MCP servers and a
   sandbox. Runtime, model and role are independent; no vendor in the core.
5. **Runtime adapter.** Start, cancel, result and events. A fake adapter
   passes the same contract suite as a real one.
6. **Event log.** Append-only SQLite and the only record. Replay rebuilds
   state; recovery is replay.
7. **Observation.** Every primitive emits events. Observers subscribe; they
   never change state.
8. **Extension.** A TypeScript module that adds stage implementations,
   runtimes or observers.

## Invariants

No workflow or extension can switch these off.

- Only the controller changes state or spends budget. Agent output is a claim
  until the controller checks it.
- Evidence binds to an exact SHA or hash. A new commit invalidates evidence
  for the old one.
- Anything the controller cannot classify stops and asks the owner. No silent
  recovery, no automatic retry of a quality gate.
- Candidate code runs in a sandbox. Untrusted text (an issue, tool output,
  agent output) never becomes code or config.
- The owner's definitions are trusted TypeScript. Repository-supplied
  definitions are out of scope for now; if added, they are data, never code
  (A-111).

## Policy, not core

These belong to workflows the owner writes, starting with a default workflow
that ships beside the core: roles, review counts and budgets, the ticket
format, the review package, merge and PR rules.

## Cut

`learn/`, `proto/`, and anything that exists only to serve something cut or
something the e2e suite does not need.

## Proof

`tests/e2e/` defines the MVP workflow as user code against the public entry
point only, with stub agents, and proves the cases in source-v0.3 Appendix B
that the MVP covers. Unit tests stay only for genuine branching logic.
