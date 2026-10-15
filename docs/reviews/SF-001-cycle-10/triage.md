# SF-001 cycle-10 — bounded author triage

## Authority, evidence and limits

Owner replied “yes” to analysis of the three findings only: no specification edits, additional reviews or budget reset. This is author analysis of existing evidence, not a new independent verdict or implementation proof.

- Frozen candidate: `85ccd96acf694c48aec8ea8d8ccdbfa19537d54a`.
- Cycle base: `c81d447e4669911224c0d95419bfdbc89af00f1a`.
- Audit HEAD before triage: `66f97dc4900af101c5299dfd56b25499a7662fef`.
- Original [standard result](standard-1-result.json), [adversarial result](adversarial-1-result.json), [exact report](CHALLENGE.md) and [escalation packet](escalation.md) retained unchanged.
- All specification line references below refer to the frozen `docs/specs/delivery-lifecycle-v0.2.md`; scenario lines refer to its v0.2 scenario companion.
- Counters remain **standard 1/2 PASS; adversarial 1/1 FAIL; infrastructure failures 0**. No unused standard slot can override terminal adversarial failure.

Read the instructions, status, manual procedure, decisions, active contract, architecture baseline, original v0.3 control-plane/review sections, current normative text and both original reports. Compared normative bytes directly to `git show` at the frozen SHA and relevant rules to the cycle base. No controller/runtime exists; these are prose traces, not executed fixtures.

## Summary dispositions

| Finding | Supported conclusion | Qualification |
| --- | --- | --- |
| C10A1-F1 | Different-source Q6 admission after abandonment/discharge needs an explicit rule | Q3 already has an unconditional old-candidate prohibition and explicit precedence. The report overstates the absence of a Q3 answer; relaxing it would be a policy change, not merely filling a blank |
| C10A1-F2 | Stopped dispatched correction writer needs explicit durable disposition before restoration, independent of whether its source failure can be waived | Adjacent/pre-existing, as both reviewers acknowledge. The reported review-origin indefinite stall is not established: current-failure blockers and generic ambiguity escalation constrain it. Verification-origin discharge exposes the narrower gap more clearly |
| C10A1-F3 | Required-stop versus result-fencing boundary needs an explicit accounting rule | Conditional late-result acceptance is not itself contradictory. The missing premise is whether that stop also fences/closes result authority. Both reviewers rate this low; no gate bypass established |

These dispositions narrow the claims; they do not replace the adversarial FAIL with PASS.

## F1 — abandoned episode, restored unchanged candidate, later failure

### Trace against the existing rules

1. On H1, check P produces a waivable candidate defect. Q6 admits E1 with C=1; ordinary check dispatch freezes (230). Assume enough remaining S/A/C capacity and no diagnostic requirement, or an already-complete valid classification protocol.
2. W expires before writer dispatch. E1 becomes ABANDONED_ESCALATION, its C slot remains spent, and P gets a failure blocker (95, 101, 254).
3. Exact permitted FAILED waiver for P plus valid W renewal can discharge both blockers. With all other guards satisfied, restore VERIFYING/PAUSED, then owner resumes (119, 165, 236). This does not revive E1.
4. A different, never-launched required check J can use its initial execution (119, 260). Using J avoids confusing the check name with counter R.
5. If J crashes: Q3 says the old-candidate precedence overrides ordinary eligibility (203). Q6 says “once the correction intent exists” Q3 is ineligible for EVERY execution on that candidate; crash escalates with C retained/R unchanged (230). Nothing says ABANDONED_ESCALATION deletes E1 or lifts that prohibition. The strongest textual reading is therefore **no replacement**, not two equally authorised Q3 outcomes. The general genuinely-new-ACTIVE-failure rule (145) still requires Q3 eligibility.
6. If J instead produces a distinct candidate defect: new-Q6 guards may fit (226–228), but 230 combines unique candidate-bound intent with joining the same *pending* episode. E1 exists but is terminal, and 95/SC-94 forbid re-admission from E1's source failures, not explicitly from J. The text does not clearly choose rejection/escalation versus a new E2/C=2. Joining/reviving E1 or refunding C is already forbidden.

**Disposition:** support the Q6 new-source coverage gap and explicit clarification of the retained Q3 restriction. Do not claim current text authorises a replacement or that every counter outcome is unspecified.

### Alternatives requiring an owner decision

- **Recommended bounded conservative direction:** abandonment closes automatic Q3 replacement and further Q6 correction for H1 in this cycle. Preserve C and all evidence. Eligible unused checks and normal gates may still proceed after legitimate discharge/restoration; if they all pass, the cycle need not fail. A later crash escalates without R use; a later defect/review FAIL cannot start another correction. Existing permitted verification exceptions remain available, otherwise child/cancel. This extends the explicit no-new-Q6 restriction to different sources; it is a proposed policy choice, not already approved by A-010.
- **More autonomous alternative:** terminal abandonment ends the old-intent inhibition after full discharge/restoration; only genuinely new source failures may open E2 under remaining C/S/A guards, and new ACTIVE infrastructure failures may use ordinary Q3. This would deliberately relax 230, require episode identity/deduplication and source-lineage rules, and must not recycle E1, resurrect old failures, or bypass D-008.

The recommendation is simpler but costs extra owner intervention and may leave unused budgets. The report's suggestion that the conservative discharge path “still only leads to escalation” is too broad: successful remaining checks/reviews can still complete normally. Do not silently turn valid discharge into immediate terminal failure.

## F2 — writer dispatched before escalation

### What is established and what is not

The cycle base already contains the generic stop rules, required-check incomplete blocker, Q6 abandonment language and review-FAIL/Q6 distinction. Cycle-10 expressly excludes dispatched workers from its new pre-dispatch disposition (88), while SC-95 (scenario line 180) points that race branch at existing rules. This is a pre-existing adjacent obligation, not evidence that cycle-10 newly permits relaunch.

In the report's review-origin trace, H1 has not been replaced by valid H2, so 119's no-omitted-current-failure rule strongly supports retaining the review failure. Line 171's Q6 exception is not permission to forget it. Moreover, generic ambiguity escalation (78) remains an exit; “only cancellation” and indefinite stall are not established. No same-cycle relaunch authority is supplied by containment or W renewal.

A clearer trace uses the standard review's verification-origin U1:

1. P FAIL on H1 admits E1/C=1; old executions reconcile and writer X launches in DEVELOPING.
2. W expires; escalation stores resume_stage DEVELOPING and requires X to stop. X is contained without a valid accepted result or eligible retained completion. Assume no unrelated head/context drift; if drift exists its separate blocker remains.
3. All source verification failures, including P, are legitimately waived; W is renewed. Even treating P as unresolved until this waiver does not settle the missing development-result obligation.
4. The explicit incomplete-required-*check* rule (147) does not name X. Generic result/stop rules (66, 78, 157, 171, 230–232) forbid inventing successful completion or relaunch but do not explicitly record a stopped-development blocker. Restoring DEVELOPING/PAUSED would leave no worker/result to finish its required transition. The correct immediate disposition is not stated independently of P's failure.

**Disposition:** support an explicit pre-restoration stopped-writer obligation. This is a deterministic outcome/coverage gap, not a proven safety bypass or inescapable stall. Standard U1 and adversarial F2 substantially agree on the path; they differ over scope/materiality.

**Recommendation, not adopted:** after bounded containment/completion reconciliation, a dispatched correction writer with no valid result or eligible retained completion gets an operationally non-resolvable incomplete-correction blocker; mark its episode abandoned, retain C, and require child/cancel. Source-failure waivers must not clear that independent blocker. Merely reusing a waivable verification-failure blocker, as one adversarial alternative suggests, is insufficient. Valid available/retained completion must be reconciled first under existing evidence rules; missing proof must not be fabricated. Test both sides of the dispatch CAS, both source types, evidence-arrival ordering, quarantine, replay and partial resolution. Do not alter ordinary healthy owner-pause semantics or re-block completed H2 history.

This requires explicitly broadening a future revision beyond A-010's undispatched-only scope. Deferring it is possible only with an honest unresolved dispatched-path coverage/implementation gate, not a claim that SC-95 settles its outcome. For full lifecycle acceptance, recommend resolving it rather than repeating that scope disagreement.

## F3 — physical stop versus authority to accept a result

Lines 99/SC-92 accept only an **otherwise valid assigned** late result. Lines 88/175–177 exclude fenced/closed output and retain reservations until consumption or terminal reconciliation. These statements can coexist: the missing fact is whether required-stop finalisation itself changes the acceptance fence. Section 6 (304) separates lease fencing from filesystem containment but does not define that stop event's lease mutation.

The same stopped-process trace can therefore produce different accounting if implementations choose different fencing semantics. The terminal unfulfilled-review blocker remains either way; no gate advancement, retry or budget refund follows. Standard L2 and adversarial F3 agree on this low-severity precision issue.

**Recommended clarification, not adopted:** physical containment/required stop alone does not close result-acceptance authority. Otherwise-valid assigned late verdicts consume once behind the existing terminal blocker until explicit fencing/replacement or terminal closure; those explicit fences still make later output diagnostic. This matches the existing reservation-survives-escalation and late-counting language with less behavioural change than fencing all output at stop. It grants neither process continuation nor restoration. Alternative: fence at required-stop finalisation, but align late-result examples and retained-completion reconciliation rather than silently discarding already-authenticated evidence.

Acceptance fixtures should name the fence state and source of retained completion, cover verdict-before-stop, retained receipt awaiting attachment, genuinely late output, explicit prior fencing and cancel/child closure, and assert exact reservation/count outcomes. Bound reconciliation through explicit existing configured deadline/source rules; do not invent concrete duration defaults here.

Standard L1's accepted-results-only lookup would already violate 99's requirement to reconcile independently authenticated retained completion evidence. A stronger reconciliation-bound/source clarification is reasonable, but that example is not an authorised shortcut in the current text. L3 wording and U2 diagnostic continuation remain original reviewer notes; triage does not silently authorise unrelated cleanup or redesign.

## Proposed next decision — no new cycle yet

Ask the owner whether to authorise one bounded revision adopting the three recommended directions above, their directly matching scenarios and audit/outline alignment, with **at most two standard reviews and one adversarial review**. Keep prior evidence/counters, terminal/infrastructure stop rules, D-008/D-009, configurable product limits, ordinary pause and historical corrected-candidate treatment intact. No implementation or complete-spec acceptance is implied.

Before freezing any authorised candidate, trace the whole narrow matrix: pending/dispatched/completed correction × escalation/ordinary pause × retained/missing/late result × same/different source × pass/fail/crash after restoration, plus replay and waiver revocation. These are author checks, not extra independent reviews. Do not claim a passing prose review proves SQLite/OS/adapter behaviour.

## Checks performed

- Working tree was clean at triage start; normative spec/scenarios/outline byte-identical to the frozen candidate.
- `git show`/cycle diff confirmed cited Q3 precedence, ambiguity escalation and incomplete-check rules predate cycle-10.
- Original result JSON success/full candidate SHA validated; CHALLENGE exactly equals raw adversarial result text.
- Final author checks passed: `git diff --check`, all local Markdown links, 96 ordered unique scenario IDs, frozen normative byte equality, every original cycle-10 evidence file unchanged against the pre-triage audit commit, and exact allowed audit-only changed/untracked file set.
- No reviewer invocation, design change, new scenario, counter mutation or authority-policy edit. Only this analysis and audit handoff records change.
