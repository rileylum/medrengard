# SF-001-review-06 — Bounded recovery clarifications

## Authority and scope

A-006, 2026-10-15: owner replied “Yes, please start” to the proposed semantics and maximum **two standard / one adversarial** reviews. Parent SF-001-review-05 remains stopped at standard 2/2 (FAIL, PASS), adversarial 1/1 (FAIL), infrastructure failures 0. Earlier histories remain intact.

Scope: during-recovery safe-sibling decision ordering and current evidence, explicit empty-set exit to ESCALATED/PAUSED, owner-pause guard wording, matching scenarios and audit records. No implementation, new recovery machinery, unrelated policy changes or complete-specification acceptance.

- Cycle comparison base: `bcb001a9bd374768394584270cffffdf8ced9747` (audit tip; design unchanged from parent candidate `ab460b46b2e31bbfe1b33e7878295f4483894aed`).
- Current stage: preparing candidate for standard review.
- Current counters: standard **0/2**, adversarial **0/1**, infrastructure failures **0**.
- Review execution deadline: 600 seconds; infrastructure failure stops for owner guidance, without spending a completed verdict or automatically retrying.
- A first standard FAIL permits one bounded correction; second FAIL or adversarial FAIL stops. A new cycle is never automatic.

## Prior finding triage (author analysis, not an independent review)

Owner authorised read-only triage before this revision. Original [report](../SF-001-cycle-05/CHALLENGE.md), [standard result](../SF-001-cycle-05/standard-2-result.json) and [disagreement matrix](../SF-001-cycle-05/escalation.md) remain unchanged.

- **C5A1-F1: unsupported as a behavioural defect.** Owner pause moves RECOVERING to PAUSED; a later recovery event must revalidate its state version. Subsequent paused-origin interruption uses the paused-origin exit. The wording correction improves clarity; it does not retroactively confirm the claimed termination path.
- **C5A1-F2: uncertain, narrowed to decision timing/atomicity.** Current evidence is already required; stale proof does not authorise continuation. The prior text does not explicitly order granting the observation decision against the complementary stop evaluation during recovery. A-006 selects an explicit current-evidence evaluation and atomic outcome, without revoking existing stop intent.
- **C5A1-F3: uncertain, narrowed to empty execution sets.** Restart need not enter RECOVERING, but the broad operational-interruption guard does not exclude it. Valid-completion evidence may cover completed histories, but not clearly a genuinely empty history. A-006 selects a proven-empty exit to PAUSED, not vacuous ACTIVE permission.

These dispositions neither rewrite the adversarial FAIL nor clear the parent escalation. The owner authorised a new bounded revision, not acceptance by override.

## Revision and verification

The draft adds explicit eligibility/transaction ordering and an empty-set transition, aligns SC-61, and adds SC-62–64 for event ordering, pause races and empty recovery. Each preserves no-dispatch, counters, existing failure/containment handling and owner acceptance boundaries.

Author structural checks passed before candidate freeze: `git diff --check`, all local Markdown link targets exist, and SC-01–64 are unique and ordered. These Python/text checks are not executable lifecycle tests or independent verification. Exact frozen candidate and review evidence are recorded below when available.
