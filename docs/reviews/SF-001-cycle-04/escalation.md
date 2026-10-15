# SF-001-review-04 — Final standard review escalation

Disposition: **ESCALATED**. Candidate: `2094188d7ffc760e7736049c2baa4ce6cdc157bb`; base: `f5b2398c841ff82dfa2c64fab2a020a5f90901a4`.

## Evidence and limits

[Exact final-standard prompt](standard-2-prompt.txt); [unaltered result](standard-2-result.json). Fresh tool-disabled Claude Code tabletop review, reported model `claude-opus-5-5`, duration 227.677 seconds, API cost $0.9061736. Valid matching-SHA FAIL, no runtime error or permission denial. No executable tests or direct reviewer Git inspection.

Cycle-04: **standard 2/2 (FAIL, FAIL), adversarial 0/1, infrastructure failures 0**. Earlier cycles/history unchanged. No further design correction or adversarial run performed.

A-004 still accepts D-008, the conservative paused-execution-failure direction; this FAIL does not rescind that owner decision. The complete specification is not accepted.

## C4S2-F1 — Medium, reviewer-reported; pending owner triage

Both C4S1-F1 (failed ESCALATED/ACTIVE recovery) and C4S1-F2 (valid retained evidence retrieval vs execution failure) are resolved as raised. The remaining counterexample is the HEALTHY counterpart of the first:

1. Delivery ESCALATED, control ACTIVE (owner previously resumed control; no dispatch is allowed while delivery remains ESCALATED).
2. Observation of an already-running confined check is interrupted; control enters RECOVERING with origin ACTIVE.
3. Reconciliation proves the run healthy or validly completed.
4. Existing live-run recovery requires non-escalated delivery; paused-origin observation recovery requires PAUSED origin; failure/quarantine paths do not apply.

No guarded row chooses the resulting control state. The reviewer explicitly says the ambiguity does not permit dispatch, retries or budget changes; its impact is control-state determinism/owner authority and AC1/AC4 completeness.

## Recommended owner triage and bounded correction — NOT AUTHORISED

Recommend one explicit healthy-reconciliation row: ACTIVE-origin RECOVERING + ESCALATED delivery + authenticated healthy/completed run + no established failure → ACTIVE, delivery still ESCALATED, record completion if present, launch nothing. This preserves the interrupted ACTIVE control state without allowing execution. State its application to both owner-resumed control and the escalation-before-default-pause window, and extend SC-61's healthy branch.

If the owner approves further work, proposed scope is C4S2-F1's single row and SC-61 branch, under a new explicitly budgeted cycle SF-001-review-05 (at most two standard and one adversarial reviews). Do not interpret this recommendation as authorisation. Alternatives are owner-led triage or holding the design; no failed verdict is converted to PASS.

Non-blocking reviewer note worth considering in triage: a failure of one run must not release an existing quarantine caused by another run; existing quarantine-exit authority/evidence must still apply. This is not automatically expanded revision scope.

## Check provenance

Before `f5b2398`: local links, 61 ordered unique scenario IDs, `git diff --check` passed. Before `2094188`: same checks plus valid first-review FAIL JSON passed. These are author structural checks only. No implementation, runtime adapter, CI or external publication.
