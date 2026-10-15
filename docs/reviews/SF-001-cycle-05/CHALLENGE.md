# Adversarial review — SF-001-review-05 (delivery lifecycle v0.1, healthy escalated-recovery exit)

Reviewed: ab460b46b2e31bbfe1b33e7878295f4483894aed  ·  Base: 2094188d7ffc760e7736049c2baa4ce6cdc157bb (merge-base 2094188d7ffc760e7736049c2baa4ce6cdc157bb)
Verdict: needs-attention

The two new RECOVERING rows close the cycle-04 "stuck in ACTIVE-origin RECOVERING" gap for the simple case. They do not introduce dispatch, budget or acceptance bypasses that I could find. However, row 115's stop triggers conflict with the owner-pause and safe-sibling rules elsewhere in the spec. Row 114's "raised during recovery" branch depends on a keep-observing decision that no transition defines. Both gaps fall inside the exact transition this cycle was authorised to fix. Both decide whether a healthy, confined check is killed. Killing that check forces a new owner-authorised cycle. That conflicts with the spec's own success signal of "one unambiguous expected transition" per fixture (`docs/specs/delivery-lifecycle-v0.1.md:17`).

## Findings

### [medium] Row 115 treats owner *pause* as a termination trigger, contradicting the safe-sibling and owner-pause rules — `docs/specs/delivery-lifecycle-v0.1.md:115`

Confidence: 0.55

**Scenario.**
1. The cycle is in VERIFYING with control ACTIVE. Check P is blocked, so delivery is ESCALATED.
2. Sibling Q has a recorded keep-observing decision and proven read-only confinement.
3. Observation of Q is interrupted, so control moves to RECOVERING with origin ACTIVE (row 109).
4. Before reconciliation completes, the owner pauses.

**Conflicting rules.**
- Row 108 (`:108`) covers "ACTIVE or RECOVERING / owner pauses". Its effect is PAUSED with observations retained. Nothing is stopped.
- Line 86 makes safe siblings continue "under ESCALATED/PAUSED observation". Only "owner cancel" is listed as overriding that exception, not pause.
- Row 116 (`:116`) returns healthy paused-origin observation to PAUSED without stopping anything.
- Row 115, however, lists "owner pause/cancel" among the conditions that require it to "Preserve/resume the durable bounded termination intent; do not treat healthy process status as permission to continue."
- The SC-61 complementary branch (`docs/specs/delivery-lifecycle-v0.1-scenarios.md:111`) names only "pending stop, invalid context or no keep-observing decision". It does not name owner pause. The table row and the scenario therefore disagree.

**Impact.** If an implementer applies row 115, a healthy, confined, permitted check Q is terminated just because the owner pressed pause. Under line 104, a terminated sibling's execution "remains used" and gets an OPEN missing-evidence/replacement-required blocker. That blocker requires a new child cycle or cancellation. A non-destructive operator control would irreversibly cost the cycle and add human intervention. The two rows give different outcomes for the same input, so SF-002D fixtures cannot encode one expected result.

**Recommendation.**
- Remove "owner pause" from row 115's guard, keeping cancel.
- State that an owner pause during ACTIVE-origin RECOVERING is handled by row 108. Under row 108, keep-observing runs continue under the line-86 exception, and the cycle settles PAUSED via row 116 or row 111.
- Add an SC-61 branch asserting that Q is not terminated on owner pause.

### [medium] "Escalation raised during recovery" has no defined way to obtain the keep-observing decision that row 114 requires — `docs/specs/delivery-lifecycle-v0.1.md:114-115`, `:86`

Confidence: 0.45

**What row 114 requires.** Row 114 applies when delivery is ESCALATED "whether raised before or during recovery". It also requires that "each run retained under observation has a recorded keep-observing decision under the safe VERIFYING sibling exception".

**Where that decision comes from.** That decision is defined only at line 86. It is recorded together with "identity/confinement proof" when a safe VERIFYING blocker escalates.

**The gap.** Suppose an interruption puts the cycle in ACTIVE-origin RECOVERING, and then P's launch blocker escalates delivery. At that moment:
- The controller has lost observation of Q, which is the reason it is RECOVERING.
- Recovery may only "record observations and stop workers" (line 45).
- No row defines whether, or on what evidence, a keep-observing decision may be recorded while RECOVERING.

**Two readings, both bad.**
- **(a) No decision can be recorded.** Q "lacks permitted continuation", so row 115 terminates it despite being healthy. Per line 104 that forces a child cycle. The "during recovery" wording in row 114 is then dead text.
- **(b) The decision may be recorded from the last pre-interruption proof.** The confinement proof is then stale exactly when observation was lost. That weakens the "Losing observation alone is not proof of a healthy run" rule at line 100.

**Impact.** The outcome for the same physical state depends on whether the escalation committed before or after the interruption. Either a healthy check is killed, forcing a new cycle, or continuation is authorised on stale proof. This is the exact SC-61 healthy branch this cycle was authorised to make unambiguous.

**Recommendation.** Define the escalated-during-recovery case explicitly. Do one of:
- Require reconciliation to re-establish current identity/confinement proof first, then record the keep-observing decision in the same state-version transaction.
- Or state that escalation raised during RECOVERING never grants continuation, and drop "or during recovery" from row 114.

Then add a scenario for each ordering.

### [low] ACTIVE-origin RECOVERING with ESCALATED delivery and no live runs has no clear exit — `docs/specs/delivery-lifecycle-v0.1.md:113-117`

Confidence: 0.35

**Scenario.**
1. The owner resumes control to ACTIVE while delivery stays ESCALATED, which row 118 permits.
2. All siblings have already completed and their results are recorded.
3. A controller restart is then treated as an operational interruption (row 109, line 223), giving ACTIVE-origin RECOVERING.

**Why no row fires.**
- Row 113 excludes ESCALATED delivery.
- Row 114 needs "authenticated current evidence proves healthy run or valid completion". With no run there is nothing to prove, unless it is read vacuously.
- Row 115 needs "any relevant run" that lacks continuation. That is false with zero runs.
- Row 117 needs exhausted recovery or an invalid result.

The only certain exit is the owner pause in row 108. That means a manual intervention, which is the friction the cycle aims to remove, and an underspecified fixture. This is an inference from the guard wording. An implementer could reasonably read row 114 as vacuously satisfied.

**Recommendation.** Make the zero-run case explicit. For example, add to row 114: "if no runs remain, reconciliation of recorded results suffices; return to the pre-interruption control". Add a matching fixture.

## Not verified

- The cycle-05 ledger (`docs/reviews/SF-001-cycle-05/README.md`), the text of C4S2-F1, and the cycle-05 standard-review findings were not supplied. I could not confirm that the change addresses the finding as originally stated, or that row 115 (a stop path) stays within A-005's scope of "healthy-reconciliation transition and SC-61 branch".
- SF-001 work-record history was omitted. Counters and stage claims in the task contract were taken as supplied.
- No controller, schema or test suite exists. All traces are tabletop reasoning over the supplied numbered extracts. Line numbers refer to those extracts at the reviewed SHA as provided by the operator. No checks were run.
- OS containment, lease and confinement mechanisms, and runtime observation and heartbeat semantics are explicitly deferred (lines 161, 225). They are treated as limitations, not findings.
- I did not re-audit earlier cycles' unchanged rules beyond their interaction with rows 114–115 and SC-61.