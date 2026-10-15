# SF-001-review-08 — Walkthrough policy revision (v0.2)

## Authority A-008 — 2026-10-15

Owner agreed to the configurable-policy, bounded-correction, baseline-aware verification and structured-CLI handoff directions during the acceptance walkthrough, then replied “yes” to a coherent revision with the existing manual budget of **at most two standard and one adversarial reviews**. This manual budget is NOT governed by the more permissive product policy being drafted. Infrastructure failure stops for owner guidance; first standard FAIL permits one bounded fix, second standard FAIL or adversarial FAIL stops. No automatic extra cycle.

- Parent: cycle-07, standard 1/2 PASS, adversarial 1/1 PASS, infrastructure failures 0, candidate `a02c9b010c8888683b43cc2773cc03cde454023b`. Parent full specification was not accepted. Its evidence remains unchanged.
- Cycle base: `f78184799dcac07b08712cf16bb1a3bdabf91027`.
- Current stage: drafting/checking v0.2 candidate. Counters: standard **0/2**, adversarial **0/1**, infrastructure failures **0**.
- Review execution deadline: 600 seconds. No implementation, dependency installation, runtime capability claim, external publication, merge/deploy or full-spec acceptance authorised.

## Scope and artifacts

New [v0.2 specification](../../specs/delivery-lifecycle-v0.2.md) and [v0.2 scenarios](../../specs/delivery-lifecycle-v0.2-scenarios.md) preserve v0.1 files unchanged. Scope includes policy authority and pins, total S/A budgets, shared correction accounting, bounded diagnostic comparison of H/B1, known failures/issues, structured owner commands and separate acceptance/merge. Align follow-on outline, source-direction annotations and session records. Preserve accepted D-008/D-009 recovery constraints; no unrelated recovery redesign.

Concrete default values, owner-authentication mechanism, quality comparison protocols, runtime/SQLite/containment proofs and non-escalated empty-run recovery entry/exit remain later readiness obligations. Drafted accounting/command semantics require independent review before exact-version approval.

## Validation

Author structural checks passed before freeze: `git diff --check`, local Markdown targets, ordered unique SC-01–82 for v0.2 and SC-01–65 for retained v0.1, unchanged v0.1/cycle-07 evidence against the cycle base. Scenarios are tabletop expectations, not executable lifecycle tests or independent verification. Frozen candidate and reviews are recorded below when available.
