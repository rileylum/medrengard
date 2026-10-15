# SF-001-review-04 — Paused-failure policy alignment

## Owner decision A-004 — 2026-10-15

The owner replied “Yes” to approval of the conservative paused-failure rule and a new bounded cycle aligning paused-recovery transitions and SC-61, with at most **two standard reviews and one adversarial review**.

- Cycle: SF-001-review-04; parent SF-001-review-03 remains exhausted.
- Approved policy direction: an execution failure while paused escalates and requires an explicitly authorised new cycle or cancellation, not a deferred in-cycle retry.
- Revision scope: C3S2-F1, consistent paused-recovery guards/effects and SC-61 branches. No implementation or unrelated design expansion.
- This accepts the specific policy direction, NOT the complete lifecycle specification, all other policy proposals, or a standing budget-reset mechanism.
- New counters: standard 0/2; adversarial 0/1; infrastructure failures 0. Earlier cycles retain their own counters and raw evidence.
- Manual review invocations: fresh context, tools disabled, finite 600-second deadline. Infrastructure failure stops for owner guidance under the existing manual procedure.

## Revision intent

C3S2-F1 is author-confirmed. Replace references to a non-existent paused retry path with one guarded conservative outcome. Distinguish an execution crash/timeout from a valid quality verdict. Record failure blockers immediately, preserve original allowances, reconcile before both stage restoration and owner control resume, and prohibit a paused failure from becoming a retry merely by toggling control ACTIVE.

Independent review is pending. No design acceptance or implementation claimed.
