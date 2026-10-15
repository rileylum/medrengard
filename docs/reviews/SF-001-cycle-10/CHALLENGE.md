# Adversarial review: SF-001-review-10 (adversarial attempt 1/1)

Reviewed: 85ccd96acf694c48aec8ea8d8ccdbfa19537d54a  ·  Base: c81d447e4669911224c0d95419bfdbc89af00f1a
Verdict: needs-attention

The cycle-10 text closes both A-010 gaps on the paths it names.

- A required reviewer stop with no verdict now gets an explicit, non-restorable blocker.
- ACTIVE classifications and undispatched Q6 episodes are now dispositioned on escalation.
- C is preserved, intent is not resurrected, and historical H1 failures are not re-blocked.

One new path still lacks a defined outcome. Under §5 or Q4, an abandoned episode's source failure can be discharged and the same old candidate then resumes. The Q6 per-candidate intent rules and the Q3 old-candidate precedence rule both key on "intent exists". Neither says how they apply after abandonment. That leaves the C/R outcome for later failures on that candidate undetermined.

The spec's stated success signal is one unambiguous transition and counter outcome per fixture (spec line 17). AC2/AC4 trace exactly these semantics. The gap is therefore material to the contract, not cosmetic.

AC5–AC7 are unaffected by this diff. AC1 is not regressed. AC2 and AC4 coverage claims for SC-94/95 overstate what the normative text determines.

## Findings

### [medium] An abandoned-then-discharged Q6 episode leaves the old candidate live with undefined correction-intent and Q3 semantics: `docs/specs/delivery-lifecycle-v0.2.md:95,101,230`; `docs/specs/delivery-lifecycle-v0.2-scenarios.md:179`

Confidence: 0.6

**Event sequence** (pinned Cmax=2, Rmax=1, Dmax≥0; FAILED-outcome waiver for P permitted by the profile):

1. H1 is in VERIFYING/ACTIVE. Check P returns a valid assertion FAIL, classified CANDIDATE_DEFECT. Q6 admits intent E1 (C=1) and freezes ordinary dispatch, so check R stays never-launched.
2. Before the writer is dispatched, waiver W expires and the cycle escalates.
3. Per the new row (line 95) and line 101, E1 is marked ABANDONED_ESCALATION, C=1 is retained, and P becomes an OPEN verification-failure blocker.
4. The owner grants an exact permitted FAILED waiver for P. Line 95 says "Permitted verification exception may discharge its own blocker", and SC-94 says the same. The owner then renews W.
5. The blocker set is empty, so the cycle restores to VERIFYING/PAUSED. The owner resumes and R launches its initial execution (line 119). H1 is now the live candidate again.

**Branch (a): R crashes with a transient, contained failure, under ACTIVE with no intervening pause.**
- Line 230 says: "once the correction intent exists, Q3 is ineligible for EVERY execution associated with that candidate."
- E1 still exists (it is abandoned, not deleted). Read literally, the crash escalates with R unused, then needs a child cycle.
- If abandonment ends the precedence, a Q3 replacement is allowed. The spec states neither outcome.

**Branch (b): R returns a valid assertion FAIL, classified CANDIDATE_DEFECT.**
- Line 230 says: "Multiple classified defects for that candidate join the same pending episode … check for that existing intent before applying the new-episode C guard."
- E1 is the existing candidate-bound intent but is not pending. Line 101 says nothing may "revive its intent".
- Possible implementations:
  - join E1, which is forbidden;
  - reject on a per-candidate uniqueness constraint, a "unique candidate-bound correction intent" with no specified fallback;
  - create E2 with C=2, which is not forbidden, since SC-94 only forbids new correction "from same old source".

**Why it matters.** The old-candidate precedence and episode-joining rules were written assuming an intent's candidate is about to be replaced. Cycle-10 adds a path where that candidate survives. Implementers will then pick C/R semantics in code: escalate, replace, reject, or open E2. SF-001's goal (`docs/work/SF-001.md:8`) and AC2 exist to prevent exactly that. SF-002C/D fixtures for SC-94 cannot encode a single expected outcome.

This is not a gate bypass under any reading; the conservative reading over-escalates. It is a correctness and ambiguity defect on the newly authorised path.

**Bounded fix.** Add one normative sentence to the line-230 / line-101 area, with a matching SC-94 branch:

- ABANDONED_ESCALATION closes the intent for old-candidate precedence and joining purposes.
- After its source failures are discharged and the stage is restored, later executions on that candidate follow ordinary Q3 eligibility.
- A newly classified defect from a different source opens a new episode, subject to the normal C guard and with no refund.
- Alternatively, if the owner prefers the conservative choice, declare that an abandoned episode keeps Q3 and Q6 closed for that candidate (later crash or defect escalates for a child). In that case, state that the discharge path still only leads to escalation.

Either choice works. What matters is that one is written down.

### [medium] Escalation during an already-dispatched correction can restore to DEVELOPING with no defined exit: `docs/specs/delivery-lifecycle-v0.2.md:88,119,171`; `docs/specs/delivery-lifecycle-v0.2-scenarios.md:180`

Confidence: 0.5

**Event sequence:**

1. H1 standard FAIL is counted (1,0). Q6 admits E1 with C=1, and the route is marked APPLIED.
2. Old executions reconcile, dispatch commits, and writer X runs in DEVELOPING/ACTIVE. This is SC-95's "dispatch committed first" branch.
3. Waiver W on the still-current H1 expires. Per §5 line 254, the cycle escalates with resume_stage DEVELOPING. Escalation stops active workers (line 78), and X is contained without producing a valid result.

**What the inventory does.**
- Line 88 lists only undispatched episodes and says "Already-dispatched workers retain the existing stop/containment/result rules."
- None of the existing rules create a blocker for a stopped developer. Line 147's replacement-required blocker covers required checks only.
- Line 171's prohibition on resolving an escalated review FAIL explicitly excludes a FAIL that entered "the authorised Q6 correction path".
- Line 119 forbids omitting an "unresolved CURRENT-candidate failure". Whether H1's review FAIL is "unresolved" while its correction is in flight is undefined.

**Two readings follow.**

- **Reading A:** the H1 FAIL is not a blocker.
  1. Renewing W empties the blocker set, and the cycle restores to DEVELOPING/PAUSED. The owner resumes to ACTIVE.
  2. DEVELOPING has only a "result" exit (line 66). Relaunching X is forbidden: there is no same-cycle manual retry (line 171), and Q3 is ineligible after an intervening escalation (line 203). SC-95 says "not a second worker".
  3. The cycle stalls in DEVELOPING/ACTIVE. Q1 revision requires ESCALATED or AWAITING_ACCEPTANCE (line 76), so the only exit is owner cancellation followed by a reopen.
  4. An implementer who instead relaunches X resurrects a correction after escalation, contrary to A-010's no-resurrection intent.
- **Reading B:** the H1 FAIL is an unresolved current-candidate failure. It becomes a review-failure blocker, and a child or cancellation is required.

SC-95 asserts that "existing launched-worker stop/containment rules apply". The spec does not make those rules produce an outcome. The scenario therefore claims AC4 coverage it does not have.

This is adjacent to, not inside, A-010's narrowed "undispatched" gap. The bounded fix may be deferred to a later authorised cycle. If it is, the SC-95 claim and the AC4 mapping should say the dispatched branch is unresolved.

**Bounded fix.** State that when escalation stops a dispatched correction writer without a valid accepted result, the controller does two things in the containment-finalising transaction:
- record an OPEN, non-operationally-resolvable `correction-writer-stopped` blocker, or reuse review-failure / verification-failure for each source failure;
- mark the episode `ABANDONED_ESCALATION`.

Add the corresponding SC-95 branch (child or cancel required, C retained, no relaunch).

### [low] Whether a stopped reviewer's late verdict counts depends on unspecified fencing at stop: `docs/specs/delivery-lifecycle-v0.2.md:88,99,175-177`; `docs/specs/delivery-lifecycle-v0.2-scenarios.md:177`

Confidence: 0.4

**Event sequence:**

1. SC-91: reviewer X is stopped with containment proven. Bounded reconciliation finds no verdict, and `review-reservation-unfulfilled` is committed.
2. A well-formed assigned verdict from X is delivered afterwards, for example produced before termination but carried by a delayed transport.

**The conflict.**
- Line 99 and SC-92 say such a verdict "is still counted/disposed … and held behind that blocker". That consumes the reservation and increments S.
- Line 88 and line 177, plus SC-92's last sentence, say fenced or closed-run output is diagnostic only.
- The spec never says whether a controller-required stop advances the lease generation or closes the run.

Depending on that implementation choice, the same delivery produces different outcomes:
- the parent's S and reservation end as CONSUMED (count +1); or
- they stay RESERVED and later become CLOSED_UNUSED.

No gate is bypassed, because the blocker stays terminal either way. The parent's counter and reservation fixtures diverge, though.

**Bounded fix.** One sentence stating whether stop finalisation fences the run's lease. For example: "required-stop finalisation fences the lease; later output is diagnostic only". Then align SC-92's late-output branch with that rule.

## Not verified

- **Source of truth.** This is a tabletop review of operator-extracted committed text. I did not run `git merge-base`, `git diff` or any file inspection. I trust that the extract matches 85ccd96 and c81d447 and that the scoped diff is complete for normative files. Line numbers come from the extract.
- **Files not reviewed.**
  - the `docs/STATUS.md` and `docs/work/SF-001.md` diffs;
  - `docs/reviews/SF-001-cycle-10/README.md`;
  - omitted `docs/decisions.md` lines 46–64;
  - the excluded historical approval-gate hunk.
  
  Ledger and counter bookkeeping for this cycle was not checked.
- **Author structural checks.** I did not re-verify the claims of 96 ordered unique scenarios, resolving local Markdown targets, whitespace and historical-artifact preservation. They are not runtime proof.
- **Runtime behaviour.** No executable tests exist. None of the SQLite atomicity, CAS, idempotency, OS containment or cancellation claims were exercised, and none can be from these documents.
- **Quarantine-path liveness.** After a reviewer quarantine is acknowledged, line 163 does not say which transaction completes "bounded reconciliation" and records the unfulfilled blocker. Restoration is safely blocked (line 99), but liveness depends on an unspecified actor. Owner cancel or child remains an escape. Not raised as a finding.
- **SC-94 wording.** SC-94 mentions known-baseline discharge for admitted, already-CANDIDATE_DEFECT source failures. I judged the line-272 full guard sufficient to prevent reclassification laundering, but did not trace every classification origin.
- **Rest of the spec.** Pre-existing rows outside the diff were read only as they interact with the changed text. They were not re-reviewed in full.

---

Verdict: **needs-attention**. Findings: 2 medium, 1 low (0 critical, 0 high).
The operator should save the content above as `CHALLENGE.md` at the worktree root. I wrote no file.
This consumes the cycle's single adversarial attempt, so per A-010 and the manual 2+1 rule the cycle stops here for owner guidance.