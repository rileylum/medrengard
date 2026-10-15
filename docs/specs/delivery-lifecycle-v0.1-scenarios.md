# Delivery lifecycle v0.1 — scenario specifications

Status: DRAFT expected outcomes, **not executed tests or independent review**. Companion: [lifecycle specification](delivery-lifecycle-v0.1.md). IDs are stable seeds for future contract and controller fixtures.

Notation: `(S,A)` = completed standard/adversarial verdict counts. `H1/B1` = exact head/base candidate. Unless stated otherwise: approved context, ACTIVE control, eligible environment, sufficient capacity and no replacement execution used. Every row also requires an append-only event with actor, context and evidence. Missing these prerequisites must block transition, not be assumed in executable fixtures.

## Happy path and bounded reviews

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-01 | Owner creates PREPARING cycle `(0,0)`; work READY promotes to QUEUED; claim captures B1; developer commits H1; pre-review checks PASS; standard PASS; adversarial PASS | DEVELOPING → VERIFYING → STANDARD_REVIEW → ADVERSARIAL_REVIEW `(1,0)` → AWAITING_ACCEPTANCE `(1,1)`. Required human observations then owner decision for H1/B1 give ACCEPTED and PENDING merge handoff; no automatic merge/deploy |
| SC-02 | Standard attempt 1 FAIL on H1/B1 | `(1,0)`, DEVELOPING with findings-scoped fix; H2 independently verified; second standard PASS gives `(2,0)` and adversarial PASS gives `(2,1)`. History retains H1 failure |
| SC-03 | SC-02 but second standard FAIL | ESCALATED `(2,0)`; no third review, adversarial launch or automatic fix |
| SC-04 | Standard PASS then adversarial FAIL | ESCALATED `(1,1)`; no automatic targeted fix or second adversarial run |
| SC-05 | Owner says “fix it” after SC-04, without new cycle/budget authorisation | Remain ESCALATED `(1,1)`; request explicit scope/new-cycle decision. With full authorisation and containment, old cycle SUPERSEDED, child PREPARING/ACTIVE `(0,0)`; recheck readiness before QUEUED and run all gates anew |
| SC-06 | Two dispatchers try to reserve standard attempt 2 after first FAIL and verified fix | One reservation succeeds by state-version/uniqueness guard; loser reloads. Never two active attempts or `(S + reserved) > 2` |

## Evidence, tailoring and authority

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-07 | Developer exits zero/idle, but result or required artifact absent | ESCALATED `(0,0)`; malformed completion is not PASS and not automatically relaunched under Q3 |
| SC-08 | Result claims H1 tests passed; actual candidate H2 or artifact digest/provenance mismatches | Reject claim; ESCALATED, counters unchanged; preserve suspicious input, no standard dispatch |
| SC-09 | UI work requires approved prototype; ticket links only a draft | NEEDS_DESIGN_APPROVAL; never READY or dispatched |
| SC-10 | Trivial docs task has explicit no-UI rationale and applicable approved docs profile | Can become READY without mockups; still requires configured checks/reviews and human acceptance |
| SC-11 | In VERIFYING `(0,0)`, mandatory pre-review security check FAILED; unsolicited reviewer text claims PASS | ESCALATED `(0,0)`; reject unassigned verdict, retain failed check. No standard dispatch, waiver-by-reviewer or complete package |
| SC-12 | Optional-waivable check unavailable; owner grants exact permitted waiver for H1/B1 | Store HUMAN-WAIVED with authority/risk, not PASS; only that check satisfied under profile. Same waiver does not apply to H2 or override a non-waivable invariant |
| SC-13 | QUEUED `(0,0)`; issue asks for forbidden provider/log destination; controller rejects before launch | ESCALATED/PAUSED `(0,0)`; record forbidden dispatch request; no launch, data transfer or policy mutation. Runtime compromise after launch is separately covered by quarantine rules |
| SC-14 | Reviewer marks a prior failing finding rejected, without a new authorised cycle | Update disposition history; do not replace original FAIL or reset counters/resume work automatically |
| SC-15 | AWAITING_ACCEPTANCE `(1,1)`; executable walkthrough instructions and all earlier-phase evidence valid; required human UAT observation still absent | Remain AWAITING_ACCEPTANCE `(1,1)` with incomplete package; no acceptance. Authenticated passing human observation can complete package but still requires separate explicit owner approval |

## Candidate changes

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-16 | Standard PASS H1/B1 `(1,0)`; head becomes H2 before adversarial launch | Invalidate H1 evidence, ESCALATED `(1,0)`; no reuse of PASS or automatic second standard review. Owner may authorise new cycle |
| SC-17 | Standard attempt on H1/B1 is running; target base changes to B2; assigned valid PASS arrives | Mark stale and ESCALATED; count historical completed verdict once `(1,0)` but never dispatch adversarial for H1/B2. Duplicate delivery cannot count twice |
| SC-18 | AWAITING_ACCEPTANCE `(1,1)`; head/base moves before owner approval | Approval request/package stale; refuse acceptance for new candidate, preserve old evidence, ESCALATED with counters unchanged |
| SC-19 | ACCEPTED H1/B1 `(1,1)`, PENDING handoff; target tip changes to B2 before merge | Delivery stays ACCEPTED `(1,1)` historically, handoff INVALIDATED; no merge. Owner-authorised revision atomically creates PREPARING child `(0,0)`, transfers work tip and marks handoff REVISED with child link without changing accepted parent; old handoff cannot reactivate |

## Retry, transaction and recovery boundaries

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-20 | Standard launch fails with proven no live process; one retry allowance available | Persist infrastructure event, RECOVERING; after ≥5s and eligibility recheck, new run ID for same logical reservation/candidate. Completed counts unchanged; cycle replacement count becomes 1 |
| SC-21 | Retry from SC-20 fails, or later stage has another recoverable execution failure | ESCALATED; no second automatic replacement. Review counts unchanged unless a valid verdict was completed separately |
| SC-22 | Real test assertion fails versus verifier transport timeout | Assertion failure escalates as quality evidence. Transport timeout may use sole Q3 replacement if safely recoverable; neither is a standard-review verdict |
| SC-23 | Crash before launch-intent transaction commits | No persisted claim/intent or external launch permitted; cycle remains QUEUED `(0,0)`; reconcile and claim once |
| SC-24 | Intent committed; process may have launched; controller crashes before recording handle | Reconcile stable dispatch key. Attach to proven existing run or prove no launch before retrying. If ambiguous, QUARANTINED; never blindly launch replacement |
| SC-25 | Reviewer PASS received; crash during result/counter/state transaction; result delivered again | Transaction either fully committed or rolled back. Unique result key makes replay no-op or applies once. ADVERSARIAL_REVIEW `(1,0)` once, never `(2,0)` |
| SC-26 | ADVERSARIAL_REVIEW `(1,0)`; standard PASS already accepted; same run submits conflicting FAIL | ESCALATED `(1,0)`; contain adversarial run; retain conflict as anomaly and first accepted verdict unchanged. No second count, replacement verdict, automatic fix or acceptance |
| SC-27 | DEVELOPING `(0,0)`; lease expires; termination deadline passes with descendant still able to write | ESCALATED/QUARANTINED `(0,0)`; fence result generation, record failed containment; never reassign branch on lease timeout alone |
| SC-28 | DEVELOPING `(0,0)`; owner cancels; worker ignores stop past finite cancellation deadline | ESCALATED/QUARANTINED `(0,0)` with pending cancel intent; no new writer. Trusted process-tree/write-access containment evidence plus owner acknowledgement then yields CANCELLED/PAUSED; reservations close unused only after result reconciliation |
| SC-29 | Controller restarts with active run still healthy | Reconcile identity, lease and candidate; reattach/observe without extra launch or retry/counter reset. Unsupported lookup leads to quarantine, not optimistic resume |
| SC-30 | VERIFYING `(0,0)`; required check's initial execution not launched because deadline is missing; no ambiguous intent | ESCALATED/PAUSED with unused initial allowance, resume_stage VERIFYING; request configuration. No launch, Q3 consumption, infinite deadline or provider fallback |

## Release and learning

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-31 | Delivery accepted but not merged; agent requests production deploy | No release execution authorised; accepted work is not deployment permission |
| SC-32 | Actual merged candidate exists; configured staging check missing | Release cannot advance to staging-validated/awaiting-release without evidence or authorised applicable exception; delivery counters unchanged |
| SC-33 | Manually authorised deployment fails smoke test | Release FAILED/incident recorded, approved recovery procedure invoked by authorised operator; new tracked fix work, no delivery counter reset |
| SC-34 | Smoke checks pass but intended product outcome not achieved | POST_DEPLOY_VERIFIED is technical status only; record real observation and create discovery/improvement proposal, not fabricated product success |
| SC-35 | Improvement worker proposes weakening review policy to reduce failures | Proposal stored; no direct mutation of governing policy. Requires owner approval and baseline evaluation before promotion |

## Standard-review corrections: additional edge cases

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-36 | First standard FAIL already consumed `(1,0)`; fix is DEVELOPING, but target tip moves B1→B2 before fix dispatch | ESCALATED `(1,0)`; no rebase/fix dispatch; explicit child cycle required |
| SC-37 | Standard attempt 1 on H1/B1 returns valid FAIL after B1→B2 drift | Consume reservation once; ESCALATED `(1,0)` with stale FAIL evidence; no ordinary post-FAIL fix transition |
| SC-38 | ADVERSARIAL_REVIEW `(1,0)` pinned spec v1; owner adopts v2 for this work and withdraws v1 authority | ESCALATED `(1,0)` immediately; contain run and mark context stale. A later valid assigned verdict is historical and consumes its own reservation, never advances v2 |
| SC-39 | STANDARD_REVIEW `(0,0)` pinned eligible profile v1; unrelated profile v2 published without withdrawing v1 authority | Remain STANDARD_REVIEW `(0,0)` on v1; no automatic adoption or evidence relabelling |
| SC-40 | AWAITING_ACCEPTANCE `(1,1)`; earlier-phase waiver expires | ESCALATED/PAUSED `(1,1)`; no acceptance. Owner supplies valid permitted replacement waiver for identical candidate/context, independently checked; resolution returns AWAITING_ACCEPTANCE/PAUSED, then explicit control resume; no execution/budget reset |
| SC-41 | Second standard attempt has no verdict; cycle replacement allowance exhausted; owner fixes runtime and requests another same-cycle launch | Remain ESCALATED `(1,0)` with RESERVED ordinal 2; no manual retry exemption. New Q1 cycle requires containment/result reconciliation; old reservation CLOSED_UNUSED, not returned to budget |
| SC-42 | ACCEPTED H1/B1 `(1,1)`; owner performs manual merge with verified expected target B1 and approved H1 producing M1 | Handoff MERGED; parent remains ACCEPTED `(1,1)`; release starts MERGED with M1 lineage. Require M1 integration evidence before RELEASE_READY; no prod deployment |
| SC-43 | AWAITING_ACCEPTANCE `(1,1)`; authenticated human performs mandatory UAT and reports FAIL | ESCALATED `(1,1)`; preserve observation; no acceptance or same-cycle code fix |
| SC-44 | AWAITING_ACCEPTANCE `(1,1)`; required pre-review test artifact is discovered missing/corrupt after earlier verification | ESCALATED `(1,1)`; invalidate evidence; no approval based on old reviewer PASS |

## Cycle-02 corrections: refinement, lineage and failed evidence

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-45 | PREPARING C1 pins incomplete contract v1 `(0,0)`; owner adopts refined v2 with explicit child scope/budget | Atomically C1 SUPERSEDED and C2 PREPARING/ACTIVE `(0,0)`, unique parent-child link and work tip C2; no edits to v1 or dispatch before readiness |
| SC-46 | Valid finite batch names work W/v1 and its limits; W has no cycle and becomes READY | Controller creates PREPARING then QUEUED without another individual owner action; required design approval still enforced. Batch entry cannot authorise revisions or a second initial cycle |
| SC-47 | W has a DEVELOPING cycle `(0,0)`; second initial authorisation arrives with a different decision ID | Reject new initial creation; original cycle/tip unchanged, no new budget, worker or branch assignment |
| SC-48 | ACCEPTED parent with INVALIDATED handoff `(1,1)`; D-a creates child C2; distinct D-b concurrently targets same parent | One atomic winner sets REVISED/child C2 and work tip C2; loser rejected even with different event ID. Replay D-a returns C2; never C3 or a second live budget |
| SC-49 | W has ACCEPTED/PENDING parent `(1,1)`; another initial authorisation arrives | Reject; handoff and work tip unchanged and live slot retained; no child or parallel delivery |
| SC-50 | VERIFYING check P actually FAILED; profile explicitly permits FAILED-outcome waiver; owner grants exact waiver referencing failure; no other blocker | ESCALATED/PAUSED `(0,0)` resolves to VERIFYING/PAUSED with effective HUMAN-WAIVED and retained FAILED evidence; explicit control resume then normal gate evaluation, no rerun or counter reset |
| SC-51 | Same failure but profile only permits BLOCKED/unavailable waiver | Remain ESCALATED/PAUSED `(0,0)`; reject FAILED waiver; no standard dispatch or policy relaxation |
| SC-52 | Registered check P FAILED on H1/B1; owner reruns it outside controller and supplies PASS | Remain ESCALATED/PAUSED `(0,0)`; unregistered PASS diagnostic only, original failure authoritative; no Q3 exemption or promotion |
| SC-53 | VERIFYING lacks artifact from a registered completed check, no FAILED result; enters ESCALATED; owner retrieves original trusted PASS output | Independently validate same run/candidate and resolve to VERIFYING/PAUSED `(0,0)`; no new execution or replacement allowance consumed; no acceptance without remaining gates |
| SC-54 | Failure P was validly HUMAN-WAIVED; waiver expires in AWAITING_ACCEPTANCE `(1,1)` | ESCALATED/PAUSED `(1,1)` and effective FAILED restored; later PASS cannot clear it. Only renewed exact permitted failure waiver or new child decision can resolve |
| SC-55 | ACCEPTED/PENDING `(1,1)`; owner declines merge; no in-flight merge and containment proven | Handoff CLOSED, acceptance history retained, live slot released; no merge. Later revision must atomically link one child and move CLOSED→REVISED under existing lineage guards |

## Cycle-02 bounded correction: expiry and initial-check blocking

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-56 | Batch grant created C1 PREPARING `(0,0)` before its creation deadline; deadline passes, grant not revoked; work then becomes READY | Derived C1 authority remains valid; controller promotes to QUEUED `(0,0)` without renewal or new child. Unused batch entries cannot create cycles after expiry |
| SC-57 | C1 STANDARD_REVIEW `(0,0)` with derived authority; original batch creation deadline passes, then valid current PASS arrives | ADVERSARIAL_REVIEW `(1,0)` with adversarial reservation; no staleness/escalation from creation deadline alone; explicit revocation would instead use context-invalidation rules |
| SC-58 | SC-30 blocker; owner supplies missing deadline, same approved candidate/profile, no other blocker and no prior launch proven | Resolve to VERIFYING/PAUSED `(0,0)`; owner resumes control; controller registers and launches P's unused initial execution exactly once. Replacement count remains 0; no waiver or child cycle needed |

## Cycle-03 correction: multiple blockers and running siblings

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-59 | VERIFYING `(0,0)`; P and R never launched because a shared deadline config is missing; owner supplies it for both check intents | ESCALATED/PAUSED records two OPEN blockers and two unused initial allowances. One validated command resolves both named blockers atomically; with no others, restore VERIFYING/PAUSED. After separate owner control resume, each check launches its own initial execution once; Q3 count remains 0. Replay cannot duplicate resolutions or launches; failed validation for either target rejects the whole command |
| SC-60 | ESCALATED/PAUSED `(0,0)`, resume_stage VERIFYING; Q FAILED (profile permits FAILED waiver), P never launched due to config; owner first grants exact waiver for Q, then fixes P config | First command resolves Q only, preserves its FAILED evidence/effective HUMAN-WAIVED, stays ESCALATED/PAUSED with P OPEN and no launch. Second resolves P and restores VERIFYING/PAUSED; explicit resume permits P's initial launch, not a Q rerun. Reverse order produces the same final blocker set. Concurrent new failures survive CAS/revalidation and prevent resume; no review/Q3 counter changes |
| SC-61 | VERIFYING `(0,0)`; P cannot launch, Q's registered initial check is running with valid authority, unchanged candidate, finite deadline and proved read-only confinement | Escalate/PAUSE with P OPEN; Q continues under observation, retains used initial allowance and original deadline. Q's valid PASS is recorded without delivery advancement or clearing P. Owner fixes P, restoring VERIFYING/PAUSED; after explicit resume P launches once and Q is not rerun. No Q3 allowance consumed. Negative branches: valid Q FAIL adds an OPEN failure blocker, so fixing P alone cannot restore VERIFYING; unsafe context/containment triggers bounded termination/quarantine, never free Q relaunch. If Q crashes/times out while ESCALATED and termination is confirmed, add OPEN replacement-required-during-escalation blocker: resolving P cannot restore VERIFYING; child cycle/cancellation required whether Q3 count is 0 or 1, and that count remains unchanged. No pending Q3 retry survives resume; RECOVERING may establish containment only. If failure occurs only after valid restoration to VERIFYING/PAUSED, ordinary Q3 rules apply; CAS/reconciliation prevents known earlier failures being relabelled |

## SF-001 acceptance mapping

| Criterion | Draft coverage | Outstanding validation |
| --- | --- | --- |
| AC1 identities/states/authority | Spec §§2–3; SC-01, 06, 13, 30, 41, 45–49, 55–61 | Independent transition walkthrough |
| AC2 budgets and revisions | Spec §4 Q1/Q3; SC-02–06, 20–22, 41, 48, 52 | Owner policy decision and independent review |
| AC3 evidence freshness | Spec §§4–5; SC-07–08, 11–12, 16–19, 36–40, 44, 50–54, 58–61 | Schema fixtures and eventual executable assertions |
| AC4 recovery | Spec §§3, 6; SC-23–30, 59–61 | Independent failure analysis; later process/SQLite experiments |
| AC5 approval and release | Spec §§2, 4 Q4, 7; SC-09–15, 31–35, 42–43 | Owner authority/profile decisions; later enforcement tests |
| AC6 alternatives and approval | Spec §4 Q1–Q5 and §8 | Owner approval of reviewed exact version |
| AC7 bounded follow-on work | [Contract backlog](../work/SF-002-outline.md) | Refine into READY contracts only after approval |

## How to turn this into tests

Fixtures should encode initial persisted state, exact incoming command/result, actor/authority, candidate/context, process observations, expected accepted/rejected transition, counters/reservations, emitted intents and retained evidence. Assert forbidden effects as well as next state. Use deterministic clock/IDs for timeouts and replay. Recovery tests must inject crashes on both sides of transaction and external-action boundaries. Tabletop expectations alone cannot prove OS containment, SQLite atomicity or runtime cancellation.
