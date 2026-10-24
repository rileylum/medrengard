# Scope and milestones after the core refactor

Recorded 2026-10-24 from the owner's discussion of the refactor and request
to document the pathway forward. These are prospective acceptance criteria,
not claims of implemented behavior or approval of every future implementation,
paid run, external action or risk. [core.md](core.md) remains authoritative.

## Starting point

The implementation on `refactor/core` at `7785418` is a **core candidate**.
The simplification run is complete; core v1 and a usable factory are not.
The stop rule measured whether another simplification was justified, not
whether every product requirement was met.

The final suite passed 54/54 tests, but the final adversarial review found an
observer mutation/order defect, subsequently fixed in
[ticket 12](work/12-observer-isolation.md). The refactor removed substantial
capability alongside duplication: provider adapters, CLI and layered config,
durable run adoption, grants, frontends and their tests. A generic JSON
process adapter and a fake code-host proof do not constitute a real factory.
See the [final report](refactor/log.md#final-report--2026-10-24) and
[remaining findings](work/parked.md) for evidence and limitations.

Stop optimizing for source-line reduction. Build one real delivery path and
let its concrete requirements identify the next core changes.

## Development loop

On 2026-10-24 the owner agreed to develop the remaining product by defining a
user journey or agentic workflow, trying to build it on the existing primitives,
and deciding whether any missing support is worth adding. The quoted reply is
in [ticket 12](work/12-observer-isolation.md#log).

For each increment, name the journey and its observable completion criteria,
implement it using the public API, and identify concrete gaps. Prefer workflow
or integration code when that is sufficient; add a core mechanism when the
journey needs it and prove the behavior at the public boundary. Use the working
journey to choose the next increment. The milestones below remain finish lines,
not a requirement to implement all proposed primitives in advance.

## Three completion boundaries

### Core v1

A small, dependable public contract used successfully by real integrations.
Declare this milestone only when:

- The known observer defect has a public-API regression and is fixed.
- A real idea-to-PR path exercises specification approval, isolated development,
  checks, bounded reviews, owner-requested changes and publication.
- The same representative workflow works with two real runtimes and a fake,
  without provider-specific branches in the controller or workflow.
- Owner feedback is durable and reaches the relevant subsequent stage.
- Interruption and escalation have explicit, tested outcomes and an owner
  continuation or abandonment path; no implicit retry or duplicate spend.
- Repeated external commands are handled safely wherever the shipped
  integrations can redeliver them, including decisions bound to their intended
  stage and artifact.
- The shipped integrations use the public API, the invariant tests pass, and
  review finds no unresolved violation of the claimed core contract.

Core v1 freezes a supported contract for this scope, not every possible future
primitive. There is no line-count target. New mechanisms require a concrete
workflow and tests at the public boundary.

### Local factory v1

One owner, one local machine, one active ticket at a time, supported real
runtimes, explicit human approvals, and actual PR publication. The owner can
operate it repeatedly on small real tickets without editing factory internals
or repairing SQLite by hand.

The shipped experience includes setup instructions, useful agent/workflow
defaults, an operator command or similarly small interface, status and
evidence inspection, revision feedback, and a usable failure path. Resource
limits and cleanup fit the declared operating envelope. Automatic stages
advance without manual stage prompting; intentional human gates remain.

Acceptance evidence must include a successful real PR, a review/fix cycle,
owner-requested revision, and interruption/escalation with a documented next
action. Test redelivery and publication reconciliation so an ambiguous host
response does not silently produce duplicate PRs. This is a proposed acceptance
set, not a report that these runs have occurred.

No dashboard, concurrent worker pools, automatic deployment, improvement agent,
plugin marketplace or cross-repository scheduler is required for this release.
Use the factory for its own small implementation tickets once this path works;
repeated manual interventions guide subsequent work.

### Broader factory vision

The [architecture roadmap](architecture/source-v0.3.md#14--revised-implementation-roadmap)
remains the destination: richer discovery/design, review, parallel delivery,
release tracking and improvement feedback. Each becomes a separately bounded
release with outcome-based acceptance criteria. None is a prerequisite for
calling the scoped local factory v1 complete.

## Responsibility boundaries

| Capability | Responsible layer |
| --- | --- |
| Workflow execution, validated claims, artifact retention, SHA/hash binding, budget accounting, event recording/replay and execution boundaries | Core mechanisms |
| Provider invocation, model settings, result parsing and runtime cancellation | Runtime adapters |
| Role instructions, skills and MCP definitions | Agent definitions, applied by runtime integrations |
| Readiness, review counts, approval points, quality profiles and PR rules | Owner workflows with shipped defaults |
| Issues, branch publication, PR creation and reconciliation | Tracker/code-host integrations |
| Operator commands, configuration UX, status, evidence and human interaction | Application using the public API |
| Design Studio, Review Desk, release tracking and improvement analysis | Workflows, integrations and interfaces |

Modules may initially be ordinary TypeScript in this repository. Do not build
a packaging framework or restore the old implementation wholesale. Enforce
shared invariants in the core; an extension cannot bypass them for convenience.
Provider access must establish its network and credential boundary before live
use, while candidate commands remain confined.

## Delivery sequence

| Milestone | Work | Exit evidence |
| --- | --- | --- |
| M1 — Close the refactor | Fix observer mutation/order failure in a follow-up ticket; reconcile current guarantees with prior promises | Regression fails before the fix and passes afterward; full gate and review pass; supported/deferred behavior is explicit |
| M2 — One real delivery path | One provider, small operator interface, durable revision feedback, real PR publication and a usable failure path | Idea to approved spec to checked/reviewed commit to actual PR; no manual advancement between automatic stages |
| M3 — Core v1 | Second provider; interruption, escalation and redelivery mechanisms required by those integrations | Core v1 acceptance criteria above, proven through the public API |
| M4 — Local factory v1 | Defaults, setup/operator documentation, evidence inspection, operating limits and cleanup | Repeatable real small-ticket use with the success/revision/failure evidence above |
| M5 onward — Expanded capabilities | Richer design/review, parallel work, release tracking and improvement feedback | Separate acceptance criteria for each capability, following the architecture roadmap |

M2 may reveal a core change needed before its first run; the sequence does not
require building around a missing invariant. Address safety/resource constraints
when the workload needs them, not only in a final hardening phase.

## Decisions needed at concrete implementation boundaries

1. **Recovery promise.** The historical baseline says a crash never loses paid
   work. Current recovery kills confined processes and escalates pending runs;
   it does not adopt completed-but-unrecorded results. Either restore durable
   result adoption with exact run/evidence identity, or obtain and record an
   explicit revision of that promise. This document does not choose for the
   owner. Do not equate replay with lossless recovery.
2. **First provider and access boundary.** Pi and Claude Code remain the earlier
   stated targets. Select the first implementation and its network/credential
   handling before live runs; follow [live-runs.md](live-runs.md).
3. **Human input and escalation.** Define the smallest durable feedback and
   owner continuation/abandonment contract. Decide stage/subject identity and
   deduplication with the actual command transport, not a speculative bus.
4. **Operating envelope.** Set appropriate resource/spend limits and cleanup
   before unattended or resource-intensive use. Existing output caps and
   deadlines are not memory, disk or monetary budgets.
5. **Compatibility.** Decide historical-log migration only if old work must
   continue. Do not silently claim compatibility or modify historical stores.

Cross-work artifacts and live messaging remain an explicit direction in
[A-144](decisions.md#a-144--2026-10-22--messaging-primitives-a-published-artifact-between-cycles-and-a-live-channel-per-run-open-to-observers).
They are not implemented. Controller-assigned identity, durable recording and
artifact provenance may require core primitives; routing and visibility policy
belong in workflows/extensions. Build these when implementing the linked-work
capability, respecting the provider-access prerequisites and open O-018.

## How this relates to the previous roadmap

The old implementation-plan completion labels describe the old implementation,
not the refactored branch. Re-prove restored capabilities at the new public API.
The architecture's contracts/runtime/thin-slice phases map to M1–M3; useful
quality/review defaults and local operations complete M4. Broader Design Studio,
worker pools, release tracking and improvement remain later milestones.

The one-off refactor prompt has finished. Do not restart its reduction loop or
treat its unattended integration permissions as ongoing authorization. A new
implementation ticket should state its behavior, acceptance evidence and review
plan, referencing this roadmap and the authoritative core contract.
