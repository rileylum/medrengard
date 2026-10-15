# Decision register

Statuses retain the source convention: DECIDED = explicit source direction or recorded owner decision; PROPOSED = recommendation; OPEN = unresolved. Source-decided direction is not approval of a new implementation spec. Owner approval A-001 below accepts the bootstrap approach, stack, initial runtime targets and local hosting. It does not approve a future implementation specification or validate runtime capabilities.

## Carried forward from v0.3

| ID | Status | Direction | Source |
| --- | --- | --- | --- |
| D-001 | DECIDED (source) | Deterministic controller; agents supply reasoning/results, not transition authority | §§1–2, 6 |
| D-002 | DECIDED (source) | Vendor-neutral core; separate role/runtime/model and corporate/personal domains | §§1, 5, 15 |
| D-003 | DECIDED (source; product numerical limits superseded by A-008/D-010) | Source 2+1 and stop-on-adversarial-FAIL retained for manual bootstrap; product now uses approved configurable budgets/correction | §§7, 15; A-008 |
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
| D-008 | DECIDED (A-004) | Conservative paused-execution-failure direction: escalate and require new cycle/cancellation, no deferred retry; detailed transitions remain under review | SF-001 cycle-04 |
| D-009 | DECIDED (A-007) | Escalated recovery settles to PAUSED, preserving permitted healthy observation; remove ACTIVE-preserving recovery exception; detailed transitions remain under review | SF-001 cycle-07 |
| D-010 | DECIDED (A-008 direction) | Owner-approved pinned configuration defines total cycle review/replacement/diagnostic/correction limits; bounded standard/adversarial/verification corrections, both reviews repeat on new candidates | SF-001 v0.2 |
| D-011 | DECIDED (A-008 direction) | Local CLI first; structured version-bound owner decisions, separate design/work authority and controller-derived readiness; future UI/GitHub same boundary | SF-001 v0.2 |
| D-012 | DECIDED (A-008 direction) | Baseline-aware verification: distinguish regressions/new tests from proven unrelated known failures on pinned baseline, retain failure evidence and tracked issues | SF-001 v0.2 |
| D-013 | DECIDED (A-011 direction) | Abandoned candidate retains no automatic Q3/Q6 but may finish eligible checks/gates; stopped dispatched correction without valid completion needs independent child/cancel blocker; physical stop alone does not fence result acceptance | SF-001 cycle-11; detailed guards remain under review |
| D-014 | DECIDED (A-012 direction) | Preserve trustworthy completion recorded while authority was valid, subject to proven ordering/identity; recovery of escalated correction development requires explicit child-cycle authority rather than waiver-dependent same-cycle handoff | SF-001 cycle-12 authorised by A-013; detailed semantics under review |
| D-015 | DECIDED (A-014 direction) | Dispatched initial development interrupted by escalation before candidate adoption also requires explicit child-cycle authority or cancellation; preserve valid material, healthy non-escalated pause and already-adopted candidates | Future bounded SF-001 revision; no cycle-13 authority yet |
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

## Current SF-001 revision awaiting review and exact-version approval

Current draft: [delivery lifecycle v0.2](specs/delivery-lifecycle-v0.2.md), [scenarios](specs/delivery-lifecycle-v0.2-scenarios.md). A-008 accepts walkthrough directions, not the complete revised semantics/default configuration or implementation. Q1/Q2 now allow controller-admitted same-cycle corrections before terminal failure; Q3 uses configured replacement/backoff values with D-008 eligibility unchanged; Q6 defines one shared correction allowance and remaining-path guards. Structured commands, protected policy activation and known-baseline classification require validation. Both review gates, explicit candidate/package acceptance and separate manual merge remain required.

A-012/D-014 subsequently selects retained trustworthy completion evidence and child-cycle recovery for escalated correction development, instead of the draft's waiver-dependent HELD_DEVELOPMENT handoff. A-013 now authorises a bounded cycle-12 revision of that direction. Frozen cycle-11 evidence remains unchanged; exact-version acceptance is still a separate gate.

### Historical v0.1 recommendations (not the current v0.2 policy)

[Delivery lifecycle v0.1](specs/delivery-lifecycle-v0.1.md) and [scenarios](specs/delivery-lifecycle-v0.1-scenarios.md) remain unchanged as cycle-07 reviewed artifacts. Its complete specification was not accepted; the following records its earlier proposals, superseded where A-008/v0.2 explicitly changes them:

- **Q1 / O-002:** explicit owner-authorised child cycle for revisions after terminal failure/final review; immutable old counters; repeat all required gates, including after adversarial failure.
- **Q2 / O-003:** freeze reviewed candidates; unexpected head/base changes escalate rather than automatically spending another review. Valid stale verdicts consume their reserved attempt but cannot advance new code.
- **Q3 / O-004:** one safe automatic replacement execution per cycle, at least five seconds backoff, only for eligible ACTIVE-origin recovery with no intervening pause/escalation. Accepted D-008 excludes failures while paused or delivery escalated from deferred retry; malformed results and actual verification failures escalate. Unknown process containment quarantines. Finite environment-specific deadlines are required before unattended dispatch.
- **Q4 / O-008:** owner is sole initial approval authority; only profile-permitted, candidate-specific check waivers; identity, safety, required independent verdicts and hard limits cannot be waived.

Standard review 1 returned FAIL; bounded corrections clarify cycle creation, recovery/reservation transitions, context validity, evidence phases and merge handoff. Initial owner-only/manual merge authority (part of O-006) is now an explicit proposal requiring approval before SF-002E; no auto-merge is authorised.

P-004 (adversarial review on every change) remains proposed. O-005 quality defaults and runtime-dependent deadline/containment details remain later blocking decisions. Drafting these recommendations does not change the manual procedure's current stop-for-guidance rule on infrastructure failure.

Cycle-02 proposed clarifications (not yet design-approved): Q5 permits bounded, explicit initial-work batches without per-stage owner kicking; revisions remain individually authorised. One atomic work-lineage tip prevents duplicate cycles. Q4 distinguishes BLOCKED and FAILED waiver permission, preserves failed evidence and forbids unregistered rerun PASS from clearing a gate.

Cycle-03 proposed clarification: validated blocker resolutions may accumulate while ESCALATED; only an empty unresolved-blocker set permits stage restoration. Safe, already-running confined verification siblings continue under observation without new dispatch; unsafe context/containment still requires stopping workers. The specific conservative paused-execution-failure direction is now accepted in A-004; other details remain under review.

## Owner approval history

### A-014 — Initial-development child recovery (direction only)

- Owner replied “Yep agree” to the explicit question whether initial development should use the same child-cycle recovery boundary after escalation. The question expressly reserved revision scope and review-budget approval for a separate decision.
- D-015: when escalation interrupts dispatched initial development before candidate adoption, require explicit child-cycle authority or cancellation, as for correction development. Preserve valid completed material without treating it as parent continuation authority. Ordinary healthy non-escalated pause and candidates already adopted before escalation remain unchanged.
- The child must independently satisfy readiness and fresh required verification/review gates; no parent PASS, waiver or budget transfers as authority. Initial development has no correction C slot to consume or refund merely because this boundary applies. Detailed guards/scenarios remain to be reviewed.
- Accepts the additional owner intervention/repeated gates for this initial-development case rather than an implicit same-cycle post-restoration handoff. Does not approve a non-escalating artifact-retrieval exception.
- This reply selects the initial-development direction only. The triage's proposed proof-dependency/capability invalidation clarification still requires bounded revision scope and reviewed semantics; do not infer approval of unspecified trust-recovery mechanisms.
- Frozen design remains `502f482248ef8ffb3a765def15f43ea94fb32a2d`; cycle-12 remains stopped at standard 2/2 (FAIL, PASS), adversarial 1/1 FAIL, infrastructure 0. **No cycle-13 scope/budget, specification edit, new review, implementation, exact-spec acceptance or standing reset is authorised by this reply.**

### A-013 — 2026-10-15 — Bounded retained-evidence and child-recovery revision

- Owner replied “Yes please” to cycle-12 limited to A-012/D-014, related fencing/replacement/closure ordering and matching scenarios, with at most two standard reviews and one adversarial review.
- Authorises SF-001-review-12, parent cycle-11. Preserve trustworthy pre-expiry completion evidence under explicit provenance/order guards; replace waiver-dependent same-cycle development handoff with child/cancel recovery of escalated dispatched corrections. Ordinary healthy pause, undispatched-correction rules and already-accepted H2 history remain distinct.
- Scope includes direct scenario/outline/audit alignment; no unrelated cleanup or runtime implementation. [Cycle-12 ledger](reviews/SF-001-cycle-12/README.md).
- After terminal cycle-12 adversarial FAIL, owner separately replied “Yes please” to bounded analysis of its three findings only. [Completed author triage](reviews/SF-001-cycle-12/triage.md) preserves the verdicts and spent budget. No design edits/reviews authorised; recommendations about initial-development child recovery and proof-contradiction safety are not accepted policy or cycle-13 authority.
- Prior candidates/verdicts/counters remain immutable. Manual terminal standard/adversarial failure or infrastructure failure stops for guidance; product configuration cannot extend this budget. No complete-spec acceptance, deployment or standing reset authority.

### A-012 — 2026-10-15 — Preserve evidence; conservative development recovery (direction only)

- Owner replied “That sounds good to me” to the recommendation to preserve trustworthy earlier completion records while requiring explicit child-cycle recovery for correction development interrupted by escalation. The recommendation explicitly did not request or grant a new revision authorisation.
- D-014: a trusted, durable launcher record of completion while authority was valid should remain usable as evidence despite later delivery/retrieval after lease expiry. Bind exact run/candidate/authority and prove ordering relative to expiry/fencing. Worker timing claims alone are insufficient; missing trustworthy proof stops for guidance. Precise receipt-admission, replacement-fence and terminal-closure precedence still needs a reviewed specification and eventual runtime capability evidence.
- Evidence preservation is not permission to continue: no silent reopening of cancelled cycles, clearing unrelated blockers, renewing execution authority or replenishing budgets. Do not infer that all late output is admissible.
- Initial recovery of escalated correction development uses an explicitly authorised child cycle, not the draft's H1-waiver-dependent HELD_DEVELOPMENT resume path. Preserve H2/artifacts; a child contract may explicitly name preserved work as its starting point, but must independently meet readiness and every required verification/review gate. Old PASSes or budgets do not transfer as authority. Cancellation remains available. Ordinary healthy non-escalated pause and an H2 already accepted before escalation are not newly reclassified by this direction.
- Trade-offs accepted: durable receipt provenance/order adds implementation obligations; child-cycle recovery adds owner intervention/repeated gates and may leave parent capacity unused. Avoid the artificial H1-defect waiver solely to hand off a correction that already fixes it. A more autonomous same-cycle development handoff is deferred, not silently adopted.
- Affected draft: lifecycle v0.2 at frozen `5c6da6c751e2dc68109ffd44d97472bd028af673` and matching scenarios, to be aligned only in a separately authorised revision. This selects policy direction, not detailed transitions, numerical defaults, full-spec acceptance or implementation.
- Cycle-11 remains stopped: standard 2/2 FAIL/FAIL, adversarial 0/1, infrastructure 0. **No cycle-12 scope/review budget, new review, specification edit, implementation, merge/deployment or standing reset is authorised by this reply.**

### A-011 — 2026-10-15 — Abandonment and stopped-execution boundaries

- Owner replied “yes” to the three recommended directions and a bounded cycle-11 covering them and matching scenarios, with at most two standard reviews and one adversarial review.
- D-013: after abandonment, no further automatic replacement or correction on that candidate in the cycle, even for a different source; retain spent C. Eligible remaining checks/review gates may finish after legitimate discharge/restoration. Trade-off: more owner intervention despite unused capacity. Alternative of re-enabling Q3/new Q6 episodes is not selected.
- A dispatched correction stopped without valid completion requires an independent child/cancel blocker; source-failure waivers cannot clear it. Expand scope beyond cycle-10's undispatched-only correction. Reconcile valid available/retained evidence before declaring completion absent; preserve ordinary healthy pause and accepted H2 history.
- Physical required stop alone does not fence result acceptance. Otherwise-valid late verdicts count once behind existing terminal blockers; explicit fencing/replacement or terminal closure makes later output diagnostic. No process continuation, lease renewal, retry or blocker bypass granted.
- Authorises SF-001-review-11, parent cycle-10, solely these boundaries, matching scenarios and direct audit/outline alignment. [Cycle-11 ledger](reviews/SF-001-cycle-11/README.md). Detailed semantics need fresh reviews and exact-version acceptance.
- Manual 2+1 budget/stop rules remain: terminal standard/adversarial failure or infrastructure failure stops for guidance. Prior histories/counters immutable. No complete-spec acceptance, implementation, deployment or standing reset authority.

### A-010 — 2026-10-15 — Outstanding-obligation disposition correction

- Owner replied “Yes go ahead” to cycle-10 limited to the two narrowed cycle-09 triage gaps and matching scenarios, with at most two standard reviews and one adversarial review.
- Authorises SF-001-review-10, parent cycle-09: required reviewer stop without valid verdict after evidence reconciliation; explicit disposition of ACTIVE failures awaiting classification and admitted-but-undispatched correction episodes. Preserve C, no intent resurrection, ordinary pause/resume unchanged, historical corrected-candidate failures not re-blocked.
- Manual stop rules unchanged: terminal standard/adversarial failure or infrastructure failure stops for guidance. No product-policy loop may extend this budget. Preserve all previous verdicts/counters; no full-spec acceptance, implementation, deployment or standing budget reset.
- [Cycle-10 ledger](reviews/SF-001-cycle-10/README.md). Detailed proposal awaits independent reviews and exact-version owner acceptance.

### A-009 — 2026-10-15 — Pending-result escalation disposition

- Scope authority: owner said “Okay, lets move forward with that” to retaining eligible PASS evidence for once-only routing after revalidation and explicit quality blockers for pending failures, with waiver-expiry/renewal, replay and invalidation scenarios.
- Budget authority: owner replied “confirmed” to the explicit request for cycle-09, at most two standard reviews and one adversarial review under existing manual stop rules.
- Authorised SF-001-review-09, parent cycle-08. Scope solely C8S2-F1 and directly matching spec/scenario/audit alignment; no unrelated cleanup, full-spec approval, implementation or standing budget reset.
- Chosen direction: retain authentic same-candidate PASS routing behind all blockers, no recount or unnecessary re-review; escalated review FAIL cannot be operationally resolved, verification FAIL uses only existing permitted waiver/known-baseline resolutions or child/cancel. Invalidation and terminal states cannot resurrect a result. Detailed semantics require independent review.
- All cycle-08 FAIL/FAIL counters and earlier evidence remain unchanged. Terminal standard/adversarial failure or infrastructure failure stops for owner guidance. [Cycle-09 ledger](reviews/SF-001-cycle-09/README.md).

### A-008 — 2026-10-15 — Walkthrough decisions and bounded v0.2 revision

- Direction authority: owner agreed “Yes that looks good” to approved configuration as policy authority and total-per-cycle review caps, including correction after adversarial FAIL and fresh standard review of changed candidates; “Sounds good” to CLI/structured handoff; “Yes this is correct” to baseline-aware test failures and a shared correction allowance; “yes” to candidate-bound acceptance/separate manual merge. Earlier individual/batch authorisation and automatic in-scope progress were also affirmed during the walkthrough.
- Revision authority: owner replied “yes” to the explicit request for one coherent specification revision covering those decisions, with the existing MANUAL bootstrap budget of at most two standard reviews and one adversarial review. New cycle SF-001-review-08, parent cycle-07.
- D-010: versioned owner-approved configuration is authoritative for product values, without permanent 2+1 ceilings. Pin each cycle; no worker self-authority or silent live-budget edits. Corrections consume a shared total allowance, reviewers retain separate total caps, and each changed candidate repeats verification plus both reviews. Terminal escalation needs owner authority/new cycle. Numerical defaults remain unselected.
- D-011: local CLI first, deterministic structured command boundary, exact identities/versions and owner privilege separation. Design approval, work authorisation and derived readiness are separate; future UI/GitHub uses same semantics. No existing CLI or runtime capability claimed.
- D-012: new/changed tests and regressions return for bounded correction. Eligible equivalent failures on pinned B1 may be tracked as known failures without interruption; never relabel PASS. Inconclusive/flaky, in-scope, worsening, masking or non-waivable failures cannot silently bypass verification. Finite diagnostic accounting is part of the drafted mechanism, not a new unlimited allowance.
- Acceptance remains structured and candidate/package-bound, with manual merge and no initial deployment. D-008/D-009 remain accepted; non-escalated empty-run recovery remains deferred until its implementation path is designed.
- Cycle-07 PASS/PASS remains valid historical evidence on `a02c9b010c8888683b43cc2773cc03cde454023b`, not approval of v0.1 or v0.2. All earlier histories remain unchanged.
- No full-spec acceptance or implementation. Manual cycle-08 still stops on second standard FAIL, any adversarial FAIL or infrastructure failure; the proposed product loops cannot extend this review. [Cycle-08 ledger](reviews/SF-001-cycle-08/README.md).

### A-007 — 2026-10-15 — PAUSED settlement and cycle-07

- Direction authority: owner reply “Lets go with that then” to the recommendation that escalated recovery settles to PAUSED, with safe observation retained and the ACTIVE-preserving exception removed.
- Cycle authority: owner reply “Yes please” to the explicit request for cycle-07 limited to this simplification and affected scenarios, with at most two standard and one adversarial reviews.
- Accepted D-009: successful escalated recovery settles PAUSED regardless of interruption origin; healthy authorised confined checks may continue under observation. Required stops, quarantine, cancellation, result/blocker retention, no dispatch and unchanged counters remain in force. Owner resume and post-blocker-restoration resume requirements are not removed.
- Alternative rejected for this initial design: retaining the ACTIVE-preserving exception with additional timing/precedence distinctions. PAUSED reduces complexity without adding a dispatch-path owner action under the current blocker-restoration rule; interruption origin remains in audit history.
- Authorised SF-001-review-07, parent cycle-06. Earlier candidates, counters and verdicts remain immutable; this direction supersedes the earlier ACTIVE-preserving direction only for the new candidate. C6A1-F1 need not be declared confirmed to make this explicit simplification.
- No full-spec acceptance, implementation, automatic merge/deploy or standing budget reset. Terminal review failure or infrastructure failure stops for owner guidance. [Cycle-07 ledger](reviews/SF-001-cycle-07/README.md).

### A-006 — 2026-10-15 — Bounded recovery clarification cycle

- Authority: owner reply “Yes, please start” to the proposed cycle with explicitly described semantics and a maximum of two standard reviews and one adversarial review.
- Authorised: SF-001-review-06, parent cycle-05; all previous verdicts, candidates, counters and evidence remain immutable. This is not a rerun within cycle-05 or reuse of its standard PASS.
- Selected semantics for this revision: evaluate during-recovery sibling continuation from authenticated current reconciliation evidence; atomically record the keep-observing decision and control outcome; unknown proof retains conservative stop/quarantine handling and fresh health never revokes a required stop. A proven empty execution set after reconciliation exits ESCALATED recovery to PAUSED, retaining blockers/counters and launching nothing.
- Additional scope: remove misleading owner-pause wording from the stop guard, preserve the unsupported behavioural-finding disposition, and add matching scenarios. No unrelated recovery redesign or new machinery.
- Limits: at most two completed standard and one adversarial review; infrastructure failure stops for guidance. Terminal failure stops for a concrete counterexample/owner decision, not automatic cycle seven.
- No full-specification acceptance, SF-002 implementation permission, merge/deploy or standing budget reset. [Cycle-06 ledger](reviews/SF-001-cycle-06/README.md).

### A-005 — 2026-10-15 — Healthy escalated-recovery revision

- Authority: owner reply “Yes” to a new cycle limited to the healthy-reconciliation transition and SC-61 branch, with up to two standard and one adversarial reviews.
- Authorised: SF-001-review-05; parent cycle-04 and earlier exhausted histories remain immutable.
- Scope: C4S2-F1. Add a guarded ACTIVE-origin RECOVERING → ACTIVE observation-only exit while delivery remains ESCALATED; no dispatch, budget consumption or implied acceptance.
- No full-specification acceptance, implementation or standing review reset. [Cycle-05 ledger](reviews/SF-001-cycle-05/README.md). Existing manual infrastructure-failure stop rule applies.


### A-004 — 2026-10-15 — Conservative paused failure and cycle-04

- Authority: owner reply “Yes” to approval of the conservative rule and a new bounded cycle aligning paused-recovery transitions and SC-61, with up to two standard and one adversarial reviews.
- Accepted direction D-008: execution failure while paused escalates and requires an individually authorised new cycle or cancellation, not a deferred same-cycle retry. This includes the restored VERIFYING/PAUSED case.
- Authorised: SF-001-review-04, limited to C3S2-F1, consistent paused-recovery guards/effects and SC-61. Parent cycles remain exhausted and immutable.
- Alternative rejected for this initial design: durable pending-retry machinery after owner resume. Conservative handling is simpler but can increase human interventions.
- This is not acceptance of the full lifecycle specification, other Q1–Q5 proposals, implementation permission or a standing reset policy. [Cycle-04 ledger](reviews/SF-001-cycle-04/README.md).


### A-003 — 2026-10-15 — SF-001 multi-blocker revision cycle

- Authority: owner reply “Yes” to the explicit proposal for another bounded cycle limited to C2S2-F1 and its three scenarios, with at most two standard and one adversarial reviews.
- Authorised: SF-001-review-03; parent cycle-02 and earlier cycle-01 remain exhausted with immutable counters/history.
- Scope: multi-blocker resolution and sibling verification execution behaviour. No specification acceptance, implementation or general reset policy authorised.
- [Cycle-03 ledger](reviews/SF-001-cycle-03/README.md). Existing manual infrastructure-failure stop rule remains in force.


### A-002 — 2026-10-15 — SF-001 bounded revision cycle

- Authority: owner reply “Yes” to the explicit proposal to address S2-F1–F3 and their scenarios in a new cycle with at most two standard and one adversarial reviews.
- Authorised: SF-001-review-02; parent SF-001-review-01 remains exhausted with immutable counters/history.
- Scope: pre-readiness refinement/initial authority, duplicate-cycle prevention, failed-check waiver/rerun semantics and directly related scenarios.
- No design acceptance, general review reset policy or implementation permission. Existing manual infrastructure-failure stop rule remains in force.
- Exact scope/budget and future review evidence: [cycle-02 ledger](reviews/SF-001-cycle-02/README.md).


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
