# Cycle-08 escalation — interrupted result lost on restorable escalation

## Stop and reviewed candidate

- Final candidate: **`f08cc5d8d019999385349b899433c5350465946e`**.
- Correction comparison base: `0d801ac0913ff742c5267971db1e74344b89d87e`; cycle base: `f78184799dcac07b08712cf16bb1a3bdabf91027`.
- Standard **2/2 (FAIL, FAIL)**; adversarial **0/1**, infrastructure failures **0**. No adversarial review permitted after final standard FAIL; no further correction/new cycle authorised.
- [Final raw review](standard-2-result.json), [exact input](standard-2-prompt.txt), [first raw review](standard-1-result.json). All were fresh tabletop text reviews, not executed lifecycle tests or direct reviewer Git inspections.
- Cycle-07's PASS/PASS remains unchanged on its v0.1 candidate, but cannot approve this materially changed v0.2. Neither full specification is owner-accepted. No implementation exists.

## Earlier findings resolved

The final reviewer accepted the bounded corrections to C8S1-F1 (count once, defer quality routing until the named ACTIVE-return/owner-resume transition) and C8S1-F2 (a pending correction makes Q3 ineligible on the old candidate; infrastructure/unresolved-classification failure escalates with C retained and R unchanged). No further changes followed the final FAIL.

## C8S2-F1 — supported on author trace; no fix applied

The new interrupted-result paragraph says pending routes are abandoned on escalation. It does not define a replacement disposition/blocker for each pending result, while the existing blocker-set rules can later restore a cycle whose other operational blockers are resolved.

Concrete sequence from the independent review:

1. STANDARD_REVIEW/ACTIVE has a valid pre-review waiver W and a running reviewer.
2. Owner pauses. Reviewer PASS arrives, consumes its reservation and increments S once; routing is PENDING.
3. W expires, causing ESCALATED/PAUSED with blocker W. The pending PASS route is abandoned.
4. Owner renews W validly on the same candidate. W resolves and no recorded blocker remains, so the existing rule restores STANDARD_REVIEW/PAUSED.
5. Owner resumes. There is no pending route, but the reviewer already completed and its ordinal is consumed. The spec does not say whether to advance, re-review or stall.

The parallel verification sequence has a FAILED test with pending classification, then W expiry/renewal. The raw FAILED result still blocks, but the abandoned route has not become an OPEN blocker. After restoration, automatic correction would contradict the prohibition on an operational escape from ESCALATED, and doing nothing leaves work stuck without a useful blocker. A pending review FAIL similarly needs an explicit terminal-quality disposition.

Author trace agrees this is a reachable lifecycle gap, not an asserted runtime failure. It affects routing and S/C accounting; it does not invalidate the owner's configurable-policy or structured-interface direction.

## Narrow decision/correction proposed — NOT authorised or applied

Recommend a transactionally explicit disposition for every pending result when an escalation interrupts routing:

- Review FAIL: retain count/evidence and create an OPEN non-operationally-resolvable quality blocker; child cycle/cancellation, no automatic correction after restoration.
- Verification FAIL: create an OPEN quality blocker; only the already-approved kinds of waiver or proven known-baseline classification may resolve it without a child. No silent post-escalation Q6 dispatch.
- PASS: retain candidate-bound gate evidence and define whether it can be routed once after full blocker resolution/revalidation. Recommendation is to retain that once-only route rather than spend a second review on an unchanged candidate; alternatively require an explicit child cycle for this case.
- Cover PASS, verification FAIL and review FAIL with unrelated waiver expiry/restoration, replay and candidate/context invalidation in a matching scenario. Preserve counts, no new authority or automatic budget extension.

This requires a separately authorised bounded revision and review budget. It is not a request to approve v0.2 with a known blocking gap or reinterpret the current FAIL as PASS.

## Other retained notes

Reviewer non-blocking items remain in raw results, not silently corrected: Q6 guard timing, pause-race wording, naming Q3-ineligible recovery, structured in-scope finding fields, Q5 status wording, policy-approval regression evidence governance, known-baseline expiry source/B1 comparison wording, template bootstrap labelling and follow-on scenario mapping. A pre-existing review-stage restorable escalation with a stopped verdict-less reviewer also needs explicit treatment before that implementation path. Do not fold these into an unbounded new scope without owner decision.

## Handoff

Next action is owner decision on this narrowly described disposition/transition gap. No further review, correction, new cycle, exact-spec acceptance or implementation is implied by remaining unused adversarial capacity.
