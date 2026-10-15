# Cycle-06 escalation — recovery control outcome

## Stop and evidence

Frozen candidate: `09e4328d35a68929d9d07579727a323ee965a105`; cycle base `bcb001a9bd374768394584270cffffdf8ced9747`.

- Standard attempt 1: **PASS**, no blocking findings ([raw result](standard-1-result.json)).
- Adversarial attempt 1: **needs-attention / FAIL**, one medium finding at confidence 0.5 ([exact report](CHALLENGE.md), [raw result](adversarial-1-result.json)).
- Counters: standard **1/2**, adversarial **1/1**, infrastructure failures **0**. The unused standard attempt does not permit a fix after adversarial failure or another adversarial review.
- No candidate changes after standard PASS; no fix after adversarial FAIL. No specification acceptance or implementation authorisation. All prior cycles remain intact.

## Concrete sequences raised by the reviewer

Local finding ID **C6A1-F1**; the raw report is unchanged. Finding remains uncertain/disputed pending owner disposition, not automatically a confirmed defect.

### A. Escalation commits before interruption

1. VERIFYING/ACTIVE: P cannot launch, Q is a healthy confined sibling.
2. The pre-launch blocker row commits ESCALATED/PAUSED, with Q observed.
3. Observation is interrupted; its origin is PAUSED.
4. Healthy reconciliation returns PAUSED.

The reviewer contrasts this with SC-62's statement that reversing escalation/interruption produces the “same permitted observation outcome” after its forward branch explicitly returns ACTIVE. It also challenges the older “escalation-before-default-pause” phrase because the pre-launch blocker row already commits PAUSED atomically. An owner resume before interruption would instead establish ACTIVE origin, but SC-62's reverse-order sentence does not state that event.

Standard review accepted reverse ordering/current-evidence revalidation and found SC-63's paused-origin handling consistent. The disputed point is whether “same permitted observation outcome” denotes continued observation only or asserts the same control state without the required ACTIVE-origin precondition. The report explicitly says both states remain non-dispatchable; it does not claim a launch or budget bypass.

### B. Required stop finishes while another sibling remains healthy

1. ACTIVE-origin recovery observes safe sibling Q and another sibling S whose confinement cannot be established.
2. Q receives a keep decision; S receives a required stop intent.
3. S's termination/containment is subsequently proven while Q remains live.
4. The stop row says ESCALATED/PAUSED. The reviewer argues that if S's intent is now treated as fulfilled rather than pending, the healthy row also permits ACTIVE.

Standard review traced this mixed set and selected the stop row through completion, yielding PAUSED with Q observed. The adversarial claim depends on how stop-intent fulfilment and the control transition are committed. The specification's transaction rules may constrain that ordering; neither reviewer executed an implementation. No author disposition of this branch has been substituted for either independent verdict.

## What did pass the adversarial challenge

The report says the empty-set exit and removal of owner-pause wording hold up. Its remaining concern is control-state determinism, not dispatch authority, counter reset, containment bypass or full-spec approval.

## Decision boundary

A-006 explicitly required stopping on terminal failure rather than automatically starting cycle seven. This packet fulfils that stop: no new revision or review is authorised.

Suggested next action: owner decides how to resolve the remaining ACTIVE-versus-PAUSED semantics, using these two concrete sequences. Options include a narrowly specified precedence clarification or separately considering whether the ACTIVE-preserving exception is worth retaining. The latter would be a substantive design choice, not an editorial fix. Neither option is implemented or budgeted here. Rejecting a finding alone does not transform the recorded adversarial FAIL into PASS.
