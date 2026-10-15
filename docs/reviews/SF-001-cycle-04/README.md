# SF-001-review-04 — Paused-failure policy alignment

## Owner decision A-004 — 2026-10-15

The owner replied “Yes” to approval of the conservative paused-failure rule and a new bounded cycle aligning paused-recovery transitions and SC-61, with at most **two standard reviews and one adversarial review**.

- Cycle: SF-001-review-04; parent SF-001-review-03 remains exhausted.
- Approved policy direction: an execution failure while paused escalates and requires an explicitly authorised new cycle or cancellation, not a deferred in-cycle retry.
- Revision scope: C3S2-F1, consistent paused-recovery guards/effects and SC-61 branches. No implementation or unrelated design expansion.
- This accepts the specific policy direction, NOT the complete lifecycle specification, all other policy proposals, or a standing budget-reset mechanism.
- Current counters: standard 1/2 (FAIL); adversarial 0/1; infrastructure failures 0. Earlier cycles retain their own counters and raw evidence.
- Manual review invocations: fresh context, tools disabled, finite 600-second deadline. Infrastructure failure stops for owner guidance under the existing manual procedure.

## Revision intent

C3S2-F1 is author-confirmed. Replace references to a non-existent paused retry path with one guarded conservative outcome. Distinguish an execution crash/timeout from a valid quality verdict. Record failure blockers immediately, preserve original allowances, reconcile before both stage restoration and owner control resume, and prohibit a paused failure from becoming a retry merely by toggling control ACTIVE.

## Standard attempt 1 — FAIL; bounded correction prepared

- Candidate `f5b2398c841ff82dfa2c64fab2a020a5f90901a4`; comparison base `2004d1d3ece6dbbb97c7796c1481e75f67e627f9`.
- [Exact prompt](standard-1-prompt.txt); [raw result](standard-1-result.json). Git-extracted source/design with prior independent findings, no author reasoning transcript.
- Fresh tool-disabled command: `claude --safe-mode --strict-mcp-config --tools '' --no-session-persistence --permission-mode dontAsk --model opus --output-format json -p`, 600-second deadline. Reported `claude-opus-5-5`, duration 134.666 seconds, cost $0.8319858; valid matching-SHA FAIL, no runtime errors or permission denials.
- C3S2-F1 resolved. C4S1-F1 (ESCALATED/ACTIVE recovery) and C4S1-F2 (valid retained artifact retrieval vs execution failure) author-confirmed as in-scope inconsistencies.
- Bounded correction gives every ESCALATED execution failure the same explicit blocker/outcome, including ACTIVE-origin RECOVERING; distinguishes independently authenticated completed-output retrieval from malformed/no completion. SC-53/61 aligned and Q3 summary updated. No new scenario IDs or implementation.
- Author checks before `f5b2398`: local Markdown links, 61 unique ordered scenario IDs and `git diff --check`; passed. Independent review is textual/tabletop only, not executed lifecycle tests or direct reviewer Git inspection.

Next: freeze correction and run final standard attempt. Second FAIL stops; PASS permits one adversarial review. No full-specification acceptance inferred.
