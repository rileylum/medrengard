# Delivery lifecycle v0.1 — scenario specifications

Status: DRAFT expected outcomes, **not executed tests or independent review**. Companion: [lifecycle specification](delivery-lifecycle-v0.1.md). IDs are stable seeds for future contract and controller fixtures.

Notation: `(S,A)` = completed standard/adversarial verdict counts. `H1/B1` = exact head/base candidate. Unless stated otherwise: approved context, ACTIVE control, eligible environment, sufficient capacity and no replacement execution used. Every row also requires an append-only event with actor, context and evidence. Missing these prerequisites must block transition, not be assumed in executable fixtures.

## Happy path and bounded reviews

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-01 | READY, `(0,0)`; claim; developer commits H1; independent required checks PASS; standard PASS; adversarial PASS | DEVELOPING → VERIFYING → STANDARD_REVIEW → ADVERSARIAL_REVIEW `(1,0)` → AWAITING_ACCEPTANCE `(1,1)`. Owner decision for H1/B1 alone gives ACCEPTED; no automatic merge/deploy |
| SC-02 | Standard attempt 1 FAIL on H1/B1 | `(1,0)`, DEVELOPING with findings-scoped fix; H2 independently verified; second standard PASS gives `(2,0)` and adversarial PASS gives `(2,1)`. History retains H1 failure |
| SC-03 | SC-02 but second standard FAIL | ESCALATED `(2,0)`; no third review, adversarial launch or automatic fix |
| SC-04 | Standard PASS then adversarial FAIL | ESCALATED `(1,1)`; no automatic targeted fix or second adversarial run |
| SC-05 | Owner says “fix it” after SC-04, without new cycle/budget authorisation | Remain ESCALATED `(1,1)`; request explicit scope/new-cycle decision. With full authorisation, old cycle SUPERSEDED, child `(0,0)`; recheck readiness and run all gates anew |
| SC-06 | Two dispatchers try to reserve standard attempt 2 after first FAIL and verified fix | One reservation succeeds by state-version/uniqueness guard; loser reloads. Never two active attempts or `(S + reserved) > 2` |

## Evidence, tailoring and authority

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-07 | Developer exits zero/idle, but result or required artifact absent | ESCALATED `(0,0)`; malformed completion is not PASS and not automatically relaunched under Q3 |
| SC-08 | Result claims H1 tests passed; actual candidate H2 or artifact digest/provenance mismatches | Reject claim; ESCALATED, counters unchanged; preserve suspicious input, no standard dispatch |
| SC-09 | UI work requires approved prototype; ticket links only a draft | NEEDS_DESIGN_APPROVAL; never READY or dispatched |
| SC-10 | Trivial docs task has explicit no-UI rationale and applicable approved docs profile | Can become READY without mockups; still requires configured checks/reviews and human acceptance |
| SC-11 | Required security/a11y/visual check FAILED or absent, despite reviewer saying PASS | Gate blocked; if quality failure/missing evidence discovered in VERIFYING, ESCALATED. Reviewer assertion cannot waive check; no acceptance package marked complete |
| SC-12 | Optional-waivable check unavailable; owner grants exact permitted waiver for H1/B1 | Store HUMAN-WAIVED with authority/risk, not PASS; only that check satisfied under profile. Same waiver does not apply to H2 or override a non-waivable invariant |
| SC-13 | Issue asks worker to change review limits or dispatch corporate material to personal runtime/log sink | Reject permission/policy change; no forbidden dispatch/transfer; quarantine/escalate if attempted execution creates uncertainty |
| SC-14 | Reviewer marks a prior failing finding rejected, without a new authorised cycle | Update disposition history; do not replace original FAIL or reset counters/resume work automatically |
| SC-15 | AWAITING_ACCEPTANCE package lacks executable walkthrough/manual criterion observation | Stay awaiting completion; no inferred owner acceptance. Required evidence failure escalates; human observations must name actual observer and candidate |

## Candidate changes

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-16 | Standard PASS H1/B1 `(1,0)`; head becomes H2 before adversarial launch | Invalidate H1 evidence, ESCALATED `(1,0)`; no reuse of PASS or automatic second standard review. Owner may authorise new cycle |
| SC-17 | Standard attempt on H1/B1 is running; target base changes to B2; assigned valid PASS arrives | Mark stale and ESCALATED; count historical completed verdict once `(1,0)` but never dispatch adversarial for H1/B2. Duplicate delivery cannot count twice |
| SC-18 | AWAITING_ACCEPTANCE `(1,1)`; head/base moves before owner approval | Approval request/package stale; refuse acceptance for new candidate, preserve old evidence, ESCALATED with counters unchanged |
| SC-19 | ACCEPTED H1/B1; branch later changes or merge produces distinct M1 | Changed branch blocks old approval's merge handoff and requires revision. Legitimate recorded merge artifact M1 needs its own integration/release evidence; H1 review is retained as lineage, not relabelled M1 evidence |

## Retry, transaction and recovery boundaries

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-20 | Standard launch fails with proven no live process; one retry allowance available | Persist infrastructure event, RECOVERING; after ≥5s and eligibility recheck, new run ID for same logical reservation/candidate. Completed counts unchanged; cycle replacement count becomes 1 |
| SC-21 | Retry from SC-20 fails, or later stage has another recoverable execution failure | ESCALATED; no second automatic replacement. Review counts unchanged unless a valid verdict was completed separately |
| SC-22 | Real test assertion fails versus verifier transport timeout | Assertion failure escalates as quality evidence. Transport timeout may use sole Q3 replacement if safely recoverable; neither is a standard-review verdict |
| SC-23 | Crash before launch-intent transaction commits | No persisted claim/intent or external launch permitted; reconcile READY and claim once |
| SC-24 | Intent committed; process may have launched; controller crashes before recording handle | Reconcile stable dispatch key. Attach to proven existing run or prove no launch before retrying. If ambiguous, QUARANTINED; never blindly launch replacement |
| SC-25 | Reviewer PASS received; crash during result/counter/state transaction; result delivered again | Transaction either fully committed or rolled back. Unique result key makes replay no-op or applies once. ADVERSARIAL_REVIEW `(1,0)` once, never `(2,0)` |
| SC-26 | Duplicate wakeups/result deliveries or conflicting second verdict for completed run | Reconcile once logically; no duplicate writer/counter/PR. Conflicting result retained as anomaly and escalated as appropriate, never overwrite accepted verdict |
| SC-27 | Lease expires while worker or descendant can still write | RECOVERING then QUARANTINED if containment unproven; fence result generation but never reassign branch on lease timeout alone |
| SC-28 | Owner cancels; worker ignores stop past finite cancellation deadline | Block further dispatch; QUARANTINED with pending containment, preserve candidate. No new writer until process tree/write access is contained; then record completed cancellation |
| SC-29 | Controller restarts with active run still healthy | Reconcile identity, lease and candidate; reattach/observe without extra launch or retry/counter reset. Unsupported lookup leads to quarantine, not optimistic resume |
| SC-30 | Required execution/lease/cancel deadline missing, or runtime ineligible | Dispatch blocked; request configuration/approval. No default infinite deadline or fallback to another unapproved provider |

## Release and learning

| ID | Setup and stimulus | Expected state, counters and evidence |
| --- | --- | --- |
| SC-31 | Delivery accepted but not merged; agent requests production deploy | No release execution authorised; accepted work is not deployment permission |
| SC-32 | Actual merged candidate exists; configured staging check missing | Release cannot advance to staging-validated/awaiting-release without evidence or authorised applicable exception; delivery counters unchanged |
| SC-33 | Manually authorised deployment fails smoke test | Release FAILED/incident recorded, approved recovery procedure invoked by authorised operator; new tracked fix work, no delivery counter reset |
| SC-34 | Smoke checks pass but intended product outcome not achieved | POST_DEPLOY_VERIFIED is technical status only; record real observation and create discovery/improvement proposal, not fabricated product success |
| SC-35 | Improvement worker proposes weakening review policy to reduce failures | Proposal stored; no direct mutation of governing policy. Requires owner approval and baseline evaluation before promotion |

## SF-001 acceptance mapping

| Criterion | Draft coverage | Outstanding validation |
| --- | --- | --- |
| AC1 identities/states/authority | Spec §§2–3; SC-01, 06, 13, 30 | Independent transition walkthrough |
| AC2 budgets and revisions | Spec §4 Q1/Q3; SC-02–06, 20–22 | Owner policy decision and independent review |
| AC3 evidence freshness | Spec §§4–5; SC-07–08, 11–12, 16–19 | Schema fixtures and eventual executable assertions |
| AC4 recovery | Spec §6; SC-23–30 | Independent failure analysis; later process/SQLite experiments |
| AC5 approval and release | Spec §§2, 4 Q4, 7; SC-09–15, 31–35 | Owner authority/profile decisions; later enforcement tests |
| AC6 alternatives and approval | Spec §4 Q1–Q4 and §8 | Owner approval of reviewed exact version |
| AC7 bounded follow-on work | [Contract backlog](../work/SF-002-outline.md) | Refine into READY contracts only after approval |

## How to turn this into tests

Fixtures should encode initial persisted state, exact incoming command/result, actor/authority, candidate/context, process observations, expected accepted/rejected transition, counters/reservations, emitted intents and retained evidence. Assert forbidden effects as well as next state. Use deterministic clock/IDs for timeouts and replay. Recovery tests must inject crashes on both sides of transaction and external-action boundaries. Tabletop expectations alone cannot prove OS containment, SQLite atomicity or runtime cancellation.
