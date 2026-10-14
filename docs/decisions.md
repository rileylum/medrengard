# Decision register

Statuses retain the source convention: DECIDED = explicit source direction or recorded owner decision; PROPOSED = recommendation; OPEN = unresolved. Source-decided direction is not approval of a new implementation spec. Owner approval A-001 below accepts the bootstrap approach, stack, initial runtime targets and local hosting. It does not approve a future implementation specification or validate runtime capabilities.

## Carried forward from v0.3

| ID | Status | Direction | Source |
| --- | --- | --- | --- |
| D-001 | DECIDED (source) | Deterministic controller; agents supply reasoning/results, not transition authority | §§1–2, 6 |
| D-002 | DECIDED (source) | Vendor-neutral core; separate role/runtime/model and corporate/personal domains | §§1, 5, 15 |
| D-003 | DECIDED (source) | At most two standard and one adversarial review per delivery cycle; terminal failures escalate | §§7, 15 |
| D-004 | DECIDED (source) | Explicit human final acceptance and substantive design/governance approval | §§2–3, 10–12 |
| D-005 | DECIDED (source) | Full risk-tailored SDLC; no initial automatic production deployments | §§1, 13, 15 |
| D-006 | DECIDED (source) | Target pools: three developers, 2–3 reviewers, at most one concurrent adversarial run | §§1, 6 |

## Bootstrap and implementation decisions

| ID | Status | Proposal / question | Needed by |
| --- | --- | --- | --- |
| P-001 | DECIDED (A-001) | Use local Markdown contracts and manual single-item stage advancement until a proven controller replaces them | Accepted bootstrap approach |
| P-002 | DECIDED (A-001) | TypeScript core and SQLite local durable state; package manager/toolchain still unset | Project setup / persistence work |
| P-003 | PROPOSED | GitHub Issues/PRs for human records; local work IDs before remote setup | GitHub integration |
| P-004 | PROPOSED | Adversarial review for every change initially, including small changes; no implicit exemptions | First delivery review |
| P-005 | DECIDED (A-001) | Run locally initially; corporate execution remains separately authorised | Initial hosting |
| D-007 | DECIDED (A-001) | Initial runtime targets: Pi and Claude Code; core remains vendor-neutral | Runtime spikes |
| O-001 | OPEN | Validate Pi and Claude Code availability, permissions, cancellation, isolation and structured-result capabilities; selection does not prove support | Runtime spikes |
| O-002 | OPEN | Exact human revision/new-cycle/reset semantics, including overrides after adversarial failure | SF-001 |
| O-003 | OPEN | Head/base change after PASS or during review: evidence invalidation, remaining-budget handling and escalation | SF-001 |
| O-004 | OPEN | Infrastructure retry/restart ceilings and cancellation/lease recovery semantics | SF-001; implementation before unattended operation |
| O-005 | OPEN | Default docs/backend/frontend/infra QA profiles, risk additions and waiver authority | SF-002 |
| O-006 | OPEN | Local hosting accepted; foreground process versus local daemon, initial repository/remote, and merge mechanism remain undecided | Integration design |
| O-007 | OPEN | Maximum outstanding PRs and cost/time/backpressure limits | Before unattended execution |
| O-008 | OPEN | Who approves high-risk design, budget overrides, policy changes and release exceptions? Owner is expected initially, not delegated by assumption | First applicable gate |
| O-009 | OPEN | Staging/deployment ownership, permissions and rollback responsibility | Release integration |
| O-010 | OPEN | Available real-user validation and operational/product feedback, with collection owner and privacy limits | Applicable design/release work |

## SF-001 recommendations awaiting review and approval

Draft: [delivery lifecycle v0.1](specs/delivery-lifecycle-v0.1.md), with [scenario specifications](specs/delivery-lifecycle-v0.1-scenarios.md). None of these proposals has been accepted yet:

- **Q1 / O-002:** explicit owner-authorised child cycle for revisions after terminal failure/final review; immutable old counters; repeat all required gates, including after adversarial failure.
- **Q2 / O-003:** freeze reviewed candidates; unexpected head/base changes escalate rather than automatically spending another review. Valid stale verdicts consume their reserved attempt but cannot advance new code.
- **Q3 / O-004:** one safe automatic replacement execution per cycle, at least five seconds backoff; malformed results and actual verification failures escalate. Unknown process containment quarantines. Finite environment-specific deadlines are required before unattended dispatch.
- **Q4 / O-008:** owner is sole initial approval authority; only profile-permitted, candidate-specific check waivers; identity, safety, required independent verdicts and hard limits cannot be waived.

Standard review 1 returned FAIL; bounded corrections clarify cycle creation, recovery/reservation transitions, context validity, evidence phases and merge handoff. Initial owner-only/manual merge authority (part of O-006) is now an explicit proposal requiring approval before SF-002E; no auto-merge is authorised.

P-004 (adversarial review on every change) remains proposed. O-005 quality defaults and runtime-dependent deadline/containment details remain later blocking decisions. Drafting these recommendations does not change the manual procedure's current stop-for-guidance rule on infrastructure failure.

## Owner approval history

### A-001 — 2026-10-15 — Bootstrap direction

- Authority: owner, in this project conversation: “I'm happy with the approach, the tech stack and I think we should target Pi and Claude Code. It should run locally.”
- Accepted: manual contracts-first bootstrap and opening sequence, TypeScript core, SQLite persistence, Pi and Claude Code as initial targets, local execution.
- Affected baseline: BOOT-001 v0.1 steering packet and SF-001 v0.1 prerequisites; decisions P-001, P-002, P-005 and D-007.
- Alternatives: other stacks/backends and managed hosting are not selected for the initial build. Vendor neutrality remains a constraint; local execution limits initial operational scope but does not prove isolation or unattended safety.
- Consequence: proceed with SF-001 design drafting. No runtime integration, automatic merge/deploy, review-budget override or future specification is approved by implication.
- Still open: runtime capability evidence, package manager/toolchain, local process model and detailed lifecycle policies. No independent review is claimed by this approval.

The finer lifecycle questions should be brought back with concrete alternatives and worked scenarios in SF-001, not presented as a long questionnaire before useful design work.

## Recording a decision

For each accepted choice, add a dated entry with ID, exact question, chosen option, alternatives/trade-offs, owner, approval reference, affected spec/policy version and consequences. Preserve superseded decisions. A future agent must not upgrade PROPOSED to DECIDED merely because code or docs were written using that proposal.
