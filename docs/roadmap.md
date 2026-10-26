# Scope and milestones after the core refactor

Recorded 2026-10-24 from the owner's discussion of the refactor and request
to document the pathway forward. These are prospective acceptance criteria,
not claims of implemented behavior or approval of every future implementation,
paid run, external action or risk. [core.md](core.md) remains authoritative.

## Starting point

Main is a **core candidate**, not core v1. The refactor removed provider
adapters, the CLI, layered config, durable run adoption, grants and frontends
([final report](refactor/log.md#final-report--2026-10-24)); ticket 12 fixed the
observer defect its final review found; ticket 13 added back a Claude Code
runtime and a small CLI for the first journey's planning phase. Build one real
delivery path and let its requirements choose the next core changes; do not
optimize for line count.

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

## First user journey — agreed 2026-10-24

**Idea → approved plan/spec → implement → check and review/fix → owner
acceptance for publication → PR.** The owner's agreement and documentation
request are recorded in [A-145](decisions.md#a-145--2026-10-24--first-user-journey-with-human-approval-and-feedback).
This is the intended M2 experience; untested behavior below is prospective,
not a claim that the current implementation provides it.

### Scope and experience

Start with one owner, one existing repository and one small change at a time.
Use one provider initially, with separate developer and reviewer runs. A short
document combines the plan and specification; a larger discovery process,
ticket decomposition, multiple concurrent workers and a dashboard are outside
this first journey. The first provider is Claude Code on a subscription token,
driven through a small CLI (A-146).

1. The owner supplies an idea and repository. The planning stage inspects the
   relevant context and proposes intended behavior, acceptance checks, exclusions
   and an implementation outline. Questions address ambiguities that materially
   affect the work.
2. The owner can clarify or request changes to the plan/spec, receive a revised
   version, and explicitly approve its current document hash before development.
3. Development, checks and distinct reviewer runs advance automatically between
   machine stages. Review findings feed a bounded fix/review loop; exhausted
   budgets or unclassified results stop for the owner. Exact counts and failure
   routes belong to the workflow; this journey does not silently authorize
   retrying failed quality gates.
4. The owner receives the result, evidence against the acceptance criteria and
   limitations. The owner can request a revision in ordinary language. The
   feedback is recorded durably and reaches the subsequent developer run;
   changed code is checked and reviewed again before returning to the owner.
5. The owner explicitly approves publication of the current reviewed commit.
   The resulting real PR carries that exact SHA and its relevant evidence.
   Merging the PR remains a separate decision.

Human approval is part of both feedback loops: plan/spec refinement before
implementation, and result revision before publication. Human gates are policy
in the first owner workflow, not new mandatory core stages. The owner should
not have to prompt each automatic stage to begin.

### Failure path and acceptance evidence

When execution stops or the controller restarts, the owner can inspect what
happened and what was retained, then take a supported continuation or
abandonment action. The recovery promise and exact actions still need design;
replay alone does not establish preservation of unrecorded paid work.

Demonstrate a real PR the owner would consider merging, plan/spec feedback
followed by approval of the revised document, a bounded review/fix cycle,
owner-requested result revision followed by renewed review and approval, and
an interruption/escalation path with an explicit next action. Prove feedback
survives restart and reaches the intended stage; stale approval must not approve
a newer document or commit. Publication reconciliation must prevent duplicate
PRs after an ambiguous response. Assess both reliable workflow execution and
whether the delivered change meets its acceptance criteria.

### Progress

- **Phase 1, idea to approved plan:** done in [ticket 13](work/13-phase-1-plan.md).
  Live run 1 took a bolts_n_blades change through a plan, one feedback round, a
  refused stale hash and approval. Agents run headless; the owner acts at the
  workflow's gates through the CLI. Interactive agent sessions in herdr are a
  later slice.
- **Full run:** done in [ticket 14](work/14-full-run.md). Live run 2 took the
  rifle-hit idea from idea to a draft PR on bolts_n_blades with four paid
  Sonnet runs, no manual advancement between automatic stages. Stages declare
  their access, transcripts and event times are kept, and the default routes
  failures to the owner (A-148 to A-150).
- **Still open for M2:** a fix cycle and an owner `changes` round with real
  agents (tested only with stand-ins), and a usable failure path: an
  escalated work cannot yet be continued.
- **Candidates for what follows,** for the owner to order: real small tickets
  through the factory, letting what hurts choose the next work; continuing an
  escalated work (with the recovery promise below); a stall timeout in place
  of the stage deadline, with cleanup of working copies; a second runtime
  (M3); the install script (M4); agents defined once with an access ceiling.
  Destination-specific network was a follow-up of A-146; under the risk
  appetite in A-148 it is for the owner to keep, lower or drop.

## Three completion boundaries

### Core v1

A small, dependable public contract used successfully by real integrations.
Declare this milestone only when:

- The known observer defect has a public-API regression and is fixed. Done
  (ticket 12).
- A real idea-to-PR path exercises specification approval, isolated development,
  checks, bounded reviews, owner-requested changes and publication.
- The same representative workflow works with two real runtimes and a fake,
  without provider-specific branches in the controller or workflow.
- Owner feedback is durable and reaches the relevant subsequent stage. Done for
  design (ticket 13); result revision still to prove.
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
| M1 — Close the refactor (done, ticket 12) | Fix observer mutation/order failure in a follow-up ticket; reconcile current guarantees with prior promises | Regression fails before the fix and passes afterward; full gate and review pass; supported/deferred behavior is explicit |
| M2 — One real delivery path (in progress: planning done, ticket 13) | One provider, small operator interface, durable revision feedback, real PR publication and a usable failure path | Idea to approved spec to checked/reviewed commit to actual PR; no manual advancement between automatic stages |
| M3 — Core v1 | Second provider; interruption, escalation and redelivery mechanisms required by those integrations | Core v1 acceptance criteria above, proven through the public API |
| M4 — Local factory v1 | Defaults, setup/operator documentation, evidence inspection, operating limits and cleanup | Repeatable real small-ticket use with the success/revision/failure evidence above |
| M5 onward — Expanded capabilities | Richer design/review, parallel work, release tracking and improvement feedback | Separate acceptance criteria for each capability, following the architecture roadmap |

M2 may reveal a core change needed before its first run; the sequence does not
require building around a missing invariant. Address safety/resource constraints
when the workload needs them, not only in a final hardening phase.

## Decisions needed at concrete implementation boundaries

1. **Recovery promise.** The original design promised that a crash never loses
   paid work. Current recovery kills confined processes and escalates pending runs;
   it does not adopt completed-but-unrecorded results. Either restore durable
   result adoption with exact run/evidence identity, or obtain and record an
   explicit revision of that promise. This document does not choose for the
   owner. Do not equate replay with lossless recovery.
2. **Provider access boundary.** Claude Code is the first provider, with
   declared all-or-nothing network and a token passed by name (A-146). Narrow
   network to named destinations in the following ticket; Pi or another
   provider is the second runtime for core v1. Follow [live-runs.md](live-runs.md).
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

Completion labels in the old implementation plan describe deleted code.
Re-prove restored capabilities at the new public API.
