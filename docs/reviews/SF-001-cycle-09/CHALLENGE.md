# Adversarial review — SF-001-review-09 (A-009 pending-result escalation disposition)

Reviewed: 97b03854f7b73f9070bbb49bef1e82d8548427b4  ·  Base: f613d5707d04dac557da51f57f5d9a10982ca726 (merge-base f613d5707d04dac557da51f57f5d9a10982ca726)
Verdict: needs-attention

The A-009 disposition table handles its own named cases carefully: HELD_PASS, BLOCKED_FAIL, INVALIDATED, DISCHARGED, once-only release and replay. It does not hold up past those cases.

Two reachable sequences leave a restored, owner-resumed cycle sitting in ACTIVE with no permitted way to progress and no blocker to surface it. Implementers would also have to invent semantics the owner has not chosen in order to fill each gap. Both sequences sit on the escalation/restoration paths this revision exists to make explicit. Both are worth blocking on before exact-version approval.

## Findings

### [medium] Reviewer stopped with no verdict leaves no blocker, so restoration strands a dead RESERVED ordinal in ACTIVE — `docs/specs/delivery-lifecycle-v0.2.md:88,113,169-171,197`; `docs/specs/delivery-lifecycle-v0.2-scenarios.md:170`

Confidence: 0.6

**Sequence.** Take SC-90's setup without the late verdict:

1. STANDARD_REVIEW at `(0,0)` with registered reviewer run X holding reserved standard ordinal 1.
2. The owner pauses.
3. Waiver W expires. Delivery escalates and requests a bounded stop of X. SC-90 states that this stop is required.
4. X is terminated with proven containment before producing any verdict.
5. The owner validly renews W on the unchanged H1/B1/profile.

**How the text routes it.**

- The disposition table (`:88-95`) applies only to pending routes and to valid assigned verdicts. Neither exists here, so nothing is recorded for X.
- The uniform paused-execution-failure rule (`:123`, `:129`) covers launch failure, crash, timeout and malformed completion. A controller-requested stop is none of these.
- The only "terminated run leaves an OPEN replacement-required blocker" rule (`:141`) is written for verification checks ("any required check left incomplete"), not review attempts.
- After W is renewed, the blocker-set rule (`:113`) finds no OPEN blockers. Containment is proven and no failed verdict is bypassed, so the cycle restores STANDARD_REVIEW/PAUSED.
- The owner-resume row (`:156`) then returns ACTIVE.

**Why it then has nowhere to go.**

- The reservation is still RESERVED (`:169`) and only one review attempt may be active (`:171`).
- Q3 replacement is ineligible because an escalation intervened (`:197`).
- A same-cycle manual replacement is explicitly forbidden (`:161`, SC-41).
- No row fires an escalation for "ACTIVE review stage with no live reviewer and no verdict".

**Impact.** One of two outcomes follows, and neither is acceptable:

- The cycle silently sits ACTIVE in STANDARD_REVIEW indefinitely, with no blocker visible in the owner's decision inbox. This is an observability/liveness failure.
- An implementer "helpfully" relaunches the reviewer, which bypasses the no-same-cycle-retry and Q3-eligibility rules this spec relies on.

SC-90's closing sentence, "Reviewer stop with NO verdict is not a synthetic PASS and does not satisfy these guards", suggests the author intended restoration to be blocked. However, no normative spec text creates the blocker. This is inference from the written guards. No executable controller exists to confirm the behaviour.

**Recommendation.** In §3 (next to `:88` or `:141`), state that a controller-required stop of a review execution which produces no accepted verdict records an OPEN `review-attempt-terminated` (or `replacement-required`) blocker. That blocker should:

- link to the RESERVED ordinal;
- be non-operationally-resolvable, requiring a child cycle or cancellation (with the reservation becoming CLOSED_UNUSED on finalisation).

Alternatively, if the owner prefers fewer interventions, explicitly permit a keep-observing reviewer for prerequisite-only escalations, mirroring the verification sibling exception, and do not stop it.

Either way, add the no-verdict branch to SC-90 or SC-89 with the expected blocker. Also assert that restoration and resume are refused.

### [medium] Verification FAILs that are mid-classification or under a committed Q6 intent while ACTIVE are not "PENDING routes", so escalation can skip them — `docs/specs/delivery-lifecycle-v0.2.md:68,80,84,88,93,113,224`; `docs/specs/delivery-lifecycle-v0.2-scenarios.md:162`

Confidence: 0.5

**Sequence A.**

1. VERIFYING/ACTIVE. Check P returns a valid assertion FAIL.
2. Per `:68`, the delivery "Remain[s] VERIFYING while bounded classification completes". No escalation blocker is created (`:109`: blockers arise only on escalation).
3. Before classification finishes, waiver W expires. This is a context escalation under §5 (`:248`).

The new disposition step is scoped to "every PENDING quality route" (`:88`). PENDING is defined only for results received while control is PAUSED or RECOVERING (`:80`). P's in-flight ACTIVE classification therefore has no defined disposition. The blocker-set rule says "No pending FAIL may be omitted" (`:113`), but "pending" here is ambiguous between the defined PENDING route and any unresolved failure.

If P gets no BLOCKED_FAIL, W renewal empties the blocker set. The cycle restores VERIFYING/PAUSED and the owner resumes ACTIVE. From there, one of two things happens:

- Classification and Q6 admission continue. That is a delayed automatic correction after escalation, which A-009 forbids for escalated verification FAILs (`:93`; decisions A-009 "verification FAIL uses only existing permitted waiver/known-baseline resolutions or child/cancel").
- A FAIL with no route sits sticky in ACTIVE VERIFYING with no exit.

**Sequence B.**

1. A Q6 intent is committed for H1, so C has been incremented. Writer dispatch is frozen while siblings reconcile.
2. W expires.
3. `:224` says new context blockers "abandon automatic correction and escalate with C retained". However, it records no blocker for the abandoned failure. The same paragraph also says PAUSE "retains the intent" and resume "revalidates all guards". That is the opposite treatment.

After W renewal and resume, the same two outcomes apply: either the abandoned episode is revived, or a FAILED H1 sits in ACTIVE VERIFYING with no correction, rerun or escalation path.

SC-87 covers only the PAUSED-pending variant, so neither ACTIVE-origin variant is pinned down. The impact is the outcome A-009 exists to prevent: a failure either lost behind restoration or silently converted into an automatic same-cycle correction after escalation.

**Recommendation.** Define the escalation reconciliation input as every recorded quality outcome not yet APPLIED, DISCHARGED or INVALIDATED. Name these explicitly:

- non-escalated PAUSED/RECOVERING PENDING routes;
- ACTIVE assertion failures awaiting or under §5 classification;
- FAILs whose committed Q6 intent has not yet dispatched a writer.

Map the last two to `BLOCKED_FAIL` / OPEN `verification-failure`, or `review-failure` where the episode originated from a review FAIL. The C slot is retained and not reactivated.

Reconcile `:224`'s "abandon … escalate" with the table, so that abandonment always produces such a blocker. Add ACTIVE-classification and committed-intent variants to SC-87/SC-89.

## Not verified

- **Git inspection.** No Git commands were run. I did not independently confirm that HEAD equals 97b03854 or that the merge-base resolves as stated. The diff, manifest and file contents were taken as supplied by the operator.
- **Audit artifacts.** The excluded audit artifacts (`docs/reviews/SF-001-cycle-09/*`) and `docs/STATUS.md` were not supplied and were not reviewed.
- **Executable evidence.** No executable controller, tests, schema validation or SQLite/process experiments exist. Every conclusion above is a tabletop trace of written guards, not runtime proof.
- **Source of the stop requirement.** Finding 1 assumes the waiver-expiry escalation in STANDARD_REVIEW requires stopping the reviewer. That assumption rests on SC-90's stated setup and the generic escalation row (`:78`), not on an explicit §5 rule.
- **Interpretive alternatives in Finding 2.** If the owner intends "pending FAIL" in `:113` to mean any unresolved failure, Finding 2 narrows to an ambiguity fix. The `:224` "abandon" versus "retain" contradiction would remain either way.
- **Possible pre-existing gap.** I did not determine whether the reviewer-stop gap existed before this diff. It became material here because SC-90 and the restoration and release rules now explicitly exercise that path.
- **Scope of verdict.** A ship verdict would map only to this review's PASS. Nothing here constitutes owner specification approval or implementation authority.