# SF-001-review-08 — Walkthrough policy revision (v0.2)

## Authority A-008 — 2026-10-15

Owner agreed to the configurable-policy, bounded-correction, baseline-aware verification and structured-CLI handoff directions during the acceptance walkthrough, then replied “yes” to a coherent revision with the existing manual budget of **at most two standard and one adversarial reviews**. This manual budget is NOT governed by the more permissive product policy being drafted. Infrastructure failure stops for owner guidance; first standard FAIL permits one bounded fix, second standard FAIL or adversarial FAIL stops. No automatic extra cycle.

- Parent: cycle-07, standard 1/2 PASS, adversarial 1/1 PASS, infrastructure failures 0, candidate `a02c9b010c8888683b43cc2773cc03cde454023b`. Parent full specification was not accepted. Its evidence remains unchanged.
- Cycle base: `f78184799dcac07b08712cf16bb1a3bdabf91027`.
- Current stage: bounded correction after standard attempt 1 FAIL, preparing attempt 2. Counters: standard **1/2 (FAIL)**, adversarial **0/1**, infrastructure failures **0**.
- Review execution deadline: 600 seconds. No implementation, dependency installation, runtime capability claim, external publication, merge/deploy or full-spec acceptance authorised.

## Scope and artifacts

New [v0.2 specification](../../specs/delivery-lifecycle-v0.2.md) and [v0.2 scenarios](../../specs/delivery-lifecycle-v0.2-scenarios.md) preserve v0.1 files unchanged. Scope includes policy authority and pins, total S/A budgets, shared correction accounting, bounded diagnostic comparison of H/B1, known failures/issues, structured owner commands and separate acceptance/merge. Align follow-on outline, source-direction annotations and session records. Preserve accepted D-008/D-009 recovery constraints; no unrelated recovery redesign.

Concrete default values, owner-authentication mechanism, quality comparison protocols, runtime/SQLite/containment proofs and non-escalated empty-run recovery entry/exit remain later readiness obligations. Drafted accounting/command semantics require independent review before exact-version approval.

## Validation

Author structural checks passed before freeze: `git diff --check`, local Markdown targets, ordered unique SC-01–82 for v0.2 and SC-01–65 for retained v0.1, unchanged v0.1/cycle-07 evidence against the cycle base. Scenarios are tabletop expectations, not executable lifecycle tests or independent verification. First frozen candidate: `0d801ac0913ff742c5267971db1e74344b89d87e`.

## Standard attempt 1 — FAIL; bounded correction

- [Exact input](standard-1-prompt.txt), [raw result](standard-1-result.json), [stderr](standard-1-stderr.txt) (empty). Candidate above, cycle base above.
- Fresh tool-disabled command: `claude --safe-mode --strict-mcp-config --tools '' --no-session-persistence --permission-mode dontAsk --model opus --output-format json -p`; deadline 600 seconds. Reported `claude-opus-5-5`, duration 192.112 seconds, cost $1.3879018. Valid matching-SHA FAIL, no runtime error/permission denial.
- C8S1-F1 author-confirmed missing/contradictory interrupted quality-result routing. Chose explicit pending-quality results: count verdict once, no dispatch while paused/recovering, then controller ACTIVE-origin return or owner resume revalidates/routes without recount. Escalated delivery and execution-failure rules remain unchanged. SC-83/84 cover both verdicts and assertion failures.
- C8S1-F2 author-confirmed Q3/Q6 precedence conflict. Selected the conservative existing Q6 outcome explicitly: pending correction forbids old-candidate replacement; even contained infrastructure failure or unclassifiable late failure escalates with C retained, no R use. SC-69/82 aligned, SC-85 added. No evidence discarded just because a new candidate is planned.
- Non-blocking notes remain deferred; diagnostic replacement now explicitly launches after committing ACTIVE as part of F1's corrected row.
- Reviewer flagged omitted steering files in the supplied diff. Direct Git validation confirmed they exist and changed in candidate; first packet's actual diff was path-scoped and its heading insufficiently explicit. [Validation/complete manifest](standard-1-diff-provenance.txt). No missing candidate files. Next packet includes full changed-file manifest and explicitly scoped normative/steering diff, not misleadingly a complete diff. Raw review packets/results excluded from reviewer diff to avoid irrelevant transcript duplication.
- Review was tabletop analysis, not direct reviewer Git inspection or executed tests. One bounded correction and final standard attempt remain authorised; no adversarial review before PASS.
