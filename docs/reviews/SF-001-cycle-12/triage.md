# SF-001 cycle-12 — bounded author triage

## Authority and evidence boundary

Owner replied “Yes please” to analysis of the three adversarial findings against D-014 only: no specification edits, additional reviews or budget reset. This is author triage, not another independent review or an acceptance decision.

- Frozen candidate: `502f482248ef8ffb3a765def15f43ea94fb32a2d`.
- Cycle base: `7e39957b155422df133b8cac64f3d965d7d77703`.
- Pre-triage audit HEAD: `0305e38cb29a7403eca6768c2bcdc8b372e11e34`.
- Original [standard-2 result](standard-2-result.json), [adversarial result](adversarial-1-result.json), [exact CHALLENGE](CHALLENGE.md) and [escalation packet](escalation.md) remain unchanged.
- Line references below are to the frozen `docs/specs/delivery-lifecycle-v0.2.md`; SC references identify the frozen scenario set.
- Counters remain **standard 2/2 (FAIL, PASS); adversarial 1/1 FAIL; infrastructure failures 0**. Triage cannot convert the FAIL to PASS or authorise cycle-13.

Read the repository instructions, manual procedure, status, active contract/authority records, relevant architecture invariants, frozen normative guards/scenarios and both original reviews. Verified normative bytes against `git show` and compared relevant generic safety rules to the cycle base. No runtime/controller tests exist; traces below are reasoning over documents.

## Summary

| Finding | Triage disposition | Recommended response, not implemented |
| --- | --- | --- |
| C12A1-F1 | The artifact-delay → escalation → child-recovery path is supported. Its claimed contradiction with D-014, timeout semantics and SC-111 is not supported | Keep the selected conservative policy; explicitly demonstrate this cost in a scenario/walkthrough. Do not introduce non-escalating retrieval or an escalation exception without a new owner choice |
| C12A1-F2 | Explicit initial-development escalation disposition is missing; supported precision/scope gap. A mandatory stall or logical contradiction is not established | Ask owner to choose a disposition. Recommend child/cancel for dispatched initial development crossing escalation before candidate adoption, matching correction recovery; this broadens policy and requires approval |
| C12A1-F3 | Generic provenance/conflicting-result guards already oppose silent advancement, so the claimed anomaly-only safety bypass is overstated. The interaction with “diagnostic only/no child effect” and dependency/capability handling needs explicit clarification | Separate immutable counts/history from current trust eligibility. Authenticated proof contradiction should block reliance on affected proofs/capability and dependent active gates, without recounting old output or reopening terminal cycles |

This narrows the report; it does not overturn either original verdict.

## F1 — artifact-retrieval escalation is not a false timeout

### Supported trace

1. A Q6 writer on H1/C=1 has a genuine timely receipt and proposed H2; H2 is not yet accepted as current.
2. The artifact cannot be retrieved. Lines 108/148 require evidence retrieval, and the missing-artifact blocker participates in escalation (132; SC-53).
3. Escalation before candidate adoption creates `correction-recovery-required` in that transaction (96/102). Its guard deliberately does not depend on whether valid completion exists.
4. Later artifact retrieval may resolve its own evidence-retrieval obligation, but cannot clear the independent recovery blocker (136). H2 remains preserved for explicit child work (120). Parent C and other counts remain recorded; there is no same-cycle adoption, refund or hidden retry.

The extra owner intervention is real. However:

- **Escalation is not the same as timeout.** Line 110 prevents a false execution-timeout classification based only on delivery lag. Line 148 explicitly distinguishes evidence retrieval from execution failure. The trace can therefore escalate without declaring that a timely completed execution timed out. No contradiction follows.
- **Evidence validity is not continuation authority.** A-012 expressly chose this distinction, accepted extra intervention/repeated gates, and deferred a more autonomous same-cycle development handoff. Retained H2 can remain usable as child starting material without being adoptable by the interrupted parent.
- **SC-111 has a “no escalation” precondition.** Once missing artifact causes escalation, that success branch no longer applies; its Q6 escalation-wins branch instead requires child recovery. This is not two simultaneous authorised outcomes.
- **Counters are not lost or erased.** The parent retains spent C/S/A and its raw evidence. A separately authorised child repeats gates rather than inheriting old budget/PASS authority. Loss of remaining automatic progress is a cost, not a counter-accounting defect.

The report's extension to *every* transient receipt lookup gap is less precise: the exact timing of RECOVERING versus an escalation blocker matters. The concrete missing-artifact branch already demonstrates the cost; do not turn the conditional lookup claim into a universal new rule during triage.

**Recommendation:** retain D-014. Add explicit positive contrast in a future authorised scenario: receipt plus available validated artifact, no escalation → ordinary once-only handoff; missing-artifact escalation before Q6 adoption → preserve output and require child/cancel even after retrieval. A non-escalating retrieval state or an exception for retrieval-caused escalation would be a genuine new policy choice, not a necessary correction of D-014. This analysis does not authorise either.

## F2 — initial development crossing escalation

### Concrete precision gap

1. Initial DEVELOPING is paused; completion exists but its artifact is not attached.
2. Evidence retrieval escalates and records resume_stage DEVELOPING.
3. Artifact validation resolves that blocker. Unlike Q6, no initial-development recovery blocker or explicit retained-result disposition is listed in 88/90–98.
4. With no remaining blockers, 136 permits restoration to DEVELOPING/PAUSED. The owner-resume row (179) and non-escalated development rule (112) could then apply the preserved result once.

That last reading is plausible: after restoration the delivery is no longer ESCALATED. “NOT a handoff out of ESCALATED delivery” does not necessarily prohibit a later handoff after a legitimate separate restoration. Thus the report overstates the assertion that both readings directly contradict the text. Nor is an inescapable stall established: the generic ambiguity-escalation rule (78) and Q1 child/cancel remain safety exits.

Nevertheless, the inventory's promise of explicit dispositions (84/88), SC-111's “initial escalated development does not gain a new recovery route”, and the lack of a matching initial-development row leave this lifecycle outcome insufficiently explicit for deterministic fixtures. Standard review independently identified the same issue but called it low/mostly pre-existing and deferred it. The disagreement is chiefly scope/materiality, not whether the missing explicit case exists.

### Owner choice needed

- **Recommended:** make an escalation interrupting any dispatched development before candidate adoption require child/cancel, whether initial development or correction. Preserve valid work; do not classify it as failure merely to impose recovery authority. Initial work has no correction C slot to consume/refund. Keep ordinary healthy pause, non-escalated receipt recovery and a candidate already adopted before escalation unchanged. This reduces mode-specific recovery rules but adds intervention for initial work, including artifact-only escalation.
- **Alternative:** explicitly retain and release initial-development completion after full blocker resolution, containment/context validation and separate owner resume, while Q6 correction remains child-only. This reduces manual intervention but maintains two distinct escalation-recovery regimes and needs explicit invalidation/late-result/CAS cases.

Neither choice is silently covered by A-013's correction-focused authority. Recommend resolving the initial-development case before full lifecycle acceptance rather than repeatedly deferring the same scope disagreement. No new behaviour has been adopted here.

## F3 — disproven absence proof: counting versus trust

### Trace the whole specification, not only the anomaly sentence

The report posits that R1's sealed absence justified replacement R2, R2 PASS consumed the ordinal, and a genuine R1 FAIL receipt later disproves that absence.

- Lines 110/114 and SC-107/108/112 forbid late output from recounting the ordinal, reopening closed work or transferring effects into a child. Keeping those accounting boundaries is correct; retroactively overwriting R2's recorded verdict or consuming the same reservation twice is not a fix.
- But **preserving a recorded PASS does not mean continuing to trust it for advancement**. Line 78 requires escalation for ambiguity/safety/context invalidity. Lines 98/118 invalidate affected result routes/provenance. Line 192 explicitly says conflicting results escalate nonterminal cycles while preserving the first accepted result; terminal cycles retain the anomaly and block merge handoff. Line 281 says unexpected/conflicting output triggers escalation, not promotion. Those generic safeguards predate cycle-12.
- For accepted work, the merge-handoff conflict/provenance rows (335/337) also oppose treating dubious evidence as merge authority. Runtime/environment eligibility withdrawal already invalidates affected context (271).

Consequently, the report's assertion that the **only** allowed effect is an anomaly log, with no escalation or invalidation, is not supported by the full text. It has not demonstrated an authorised safety bypass.

### Remaining supported clarification

A forged or unassigned late payload is not equivalent to two independently authenticated records that contradict one another. The latter undermines the supposedly complete proof used to authorise replacement/closure, even if the old verdict can no longer consume an ordinal.

The specification does not explicitly bind this particular contradiction to those generic safety effects, identify which dependent proof/route/capability becomes unusable, or reconcile the broad “never ... affects a child” wording with a child still relying on the same now-untrustworthy capability. Automatic capability invalidation following an authenticated contradiction is not fully described merely by the rule for *missing* capability or later owner withdrawal. That is a worthwhile precision gap, not proof that every old conflicting message must revoke all launchers.

**Recommended direction, not implemented:**

- Authenticate the alleged contradiction against the exact run/generation, source identity and recorded cutoff. Do not let an unsupported worker claim rewrite history or masquerade as proven trust-root failure.
- On an established contradiction, retain both records and counters, but stop using affected completeness/seal proofs and the corresponding capability scope until independently revalidated under authorised rules. Use existing escalation/containment and merge-handoff safety boundaries; quarantine where containment/provenance safety is uncertain.
- Explicitly block advancement based on affected dependent evidence, including live descendant work if it actually relies on that proof/capability. Distinguish that safety check from transferring parent counts or reopening a terminal parent. Do not automatically invalidate unrelated independent evidence or pretend to undo completed merges/deployments.
- Test nonterminal, awaiting-acceptance, accepted-but-unmerged and terminal-parent/live-child cases, alongside forged late output, duplicate accepted receipts, and a legitimately later receipt outside an earlier snapshot cutoff. No re-count, refund, synthetic FAIL/PASS or waiver of provenance.

This is targeted trust-failure handling, not a reason to add another automatic retry or development handoff path.

## Recommended next decision

Ask the owner whether to choose the same child/cancel boundary for **initial** dispatched development interrupted by escalation, alongside keeping D-014's artifact-delay trade-off and making authenticated proof-contradiction safety effects explicit. Initial-development treatment is a substantive scope/policy choice; trust-impact details also need exact reviewed guards. No new direction or review budget is inferred from this triage request.

If a later bounded revision is authorised, limit it to those dispositions, their directly matching scenarios and audit/outline alignment. Preserve all original evidence/counters, same-candidate final review gates, healthy pause and already-adopted-candidate boundaries. Do not use rejected F1 contradiction claims to quietly introduce a non-escalating retrieval subsystem. No implementation before exact-spec approval and separately refined contracts.

## Checks

- Working tree clean at start; frozen spec/scenarios/SF-002 outline byte-identical to reviewed candidate.
- Compared cited generic ambiguity/conflicting-output guards to the cycle base: they predate cycle-12.
- Original result JSON success/full SHA validated; exact fenced CHALLENGE body matches raw adversarial JSON.
- No reviewer invocation, new scenario, normative edit, counter/verdict mutation or new cycle. Only this analysis and audit handoff records change. These are author provenance checks, not executable semantic proof.
