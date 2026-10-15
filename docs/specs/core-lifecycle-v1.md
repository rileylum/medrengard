# Core delivery lifecycle — v1

Status: implementation baseline (A-016). Source: architecture v0.3 §§6–8, 12–13, Appendix A–B. Edge-case semantics are added only when a test or a real incident demands them.

## Principles

1. The controller alone changes state and spends review budget. Agents return results; results are claims until the controller verifies them.
2. Every verdict and every piece of evidence binds to an exact commit SHA. A new commit invalidates evidence for the old one. Budget already spent stays spent.
3. Budget per delivery cycle: two standard reviews, one adversarial review. A FAIL at the limit stops the cycle. Adversarial FAIL stops immediately.
4. Anything the controller cannot classify stops the cycle and asks the owner. There is no automatic retry of a quality gate and no silent recovery path. The owner chooses: new cycle or cancel.
5. Humans accept. No merge or deployment is automatic.

## Identities

| Record | Identity |
| --- | --- |
| Work | stable work ID, contract version |
| Cycle | cycle ID, parent cycle (if revision), work ID, counters `(standard, adversarial)`, append-only event log |
| Candidate | repo, branch, head SHA, base SHA |
| Run | run ID, role (`developer`, `standard_reviewer`, `adversarial_reviewer`), runtime, model, cycle, input candidate |
| Result | run ID, outcome, commit SHA, artifacts, checks, blockers |
| Verdict | run ID, reviewed SHA, `PASS` / `FAIL`, findings |
| Decision | owner action, target cycle, exact SHA where relevant, reference |

One work item has at most one open cycle. A new cycle for the same work names its parent.

## States

`QUEUED → DEVELOPING → VERIFYING → STANDARD_REVIEW → ADVERSARIAL_REVIEW → AWAITING_ACCEPTANCE → ACCEPTED`

Terminal or holding: `ESCALATED`, `CANCELLED`.

| From | Trigger | Guard | To |
| --- | --- | --- | --- |
| QUEUED | scheduler claims | work READY, slot free, no other open cycle for this work | DEVELOPING (run created, base SHA captured) |
| DEVELOPING | developer result | result valid, commit exists, run matches | VERIFYING (candidate frozen) |
| DEVELOPING | invalid result, missing artifact, crash, timeout | — | ESCALATED |
| VERIFYING | all required checks PASS on candidate SHA | checks ran independently of the developer | STANDARD_REVIEW |
| VERIFYING | any required check FAIL or missing | — | ESCALATED |
| STANDARD_REVIEW | verdict PASS on candidate SHA | standard < 2 | ADVERSARIAL_REVIEW; standard += 1 |
| STANDARD_REVIEW | verdict FAIL, standard == 0 | — | DEVELOPING (fix run on findings); standard += 1 |
| STANDARD_REVIEW | verdict FAIL, standard == 1 | — | ESCALATED; standard += 1 |
| ADVERSARIAL_REVIEW | verdict PASS on candidate SHA | adversarial == 0 | AWAITING_ACCEPTANCE; adversarial += 1 |
| ADVERSARIAL_REVIEW | verdict FAIL | — | ESCALATED; adversarial += 1 |
| AWAITING_ACCEPTANCE | owner accepts SHA | SHA is the candidate | ACCEPTED |
| AWAITING_ACCEPTANCE | owner requests changes | — | ESCALATED |
| any non-terminal | candidate SHA changes outside a fix run | — | ESCALATED |
| any non-terminal | verdict for a SHA that is not the candidate | — | record verdict, count it, ESCALATED |
| any non-terminal | duplicate result or verdict (same run ID) | — | no change |
| any non-terminal | owner cancels | — | CANCELLED |
| ESCALATED | owner authorises new cycle | — | child cycle created `(0,0)` with parent link; this cycle stays ESCALATED |

A second developer run after a standard FAIL fixes the listed findings and produces a new candidate SHA. Verification runs again. Both counters carry forward; nothing resets.

## Evidence rules

- A developer result must name the commit. The controller checks the commit exists on the branch and that the diff is non-empty.
- Verification checks are the repository's declared commands, run by the controller, not by the developer. Output and exit code are stored against the SHA.
- A reviewer gets the contract, the diff, the SHA, repository instructions and the verification evidence. It never gets the developer transcript.
- A verdict without a reviewed SHA, or with the wrong SHA, is recorded but cannot advance the cycle.
- Missing evidence is never PASS.

## Recovery

On controller restart, reload every open cycle and reconcile its runs: a run that is still alive is observed; a run that has died without a result is an infrastructure failure. Infrastructure failures do not count as review attempts. The controller may relaunch a failed run once per cycle; the second failure escalates. Everything else escalates to the owner.

## Release handoff

ACCEPTED records the SHA and the owner decision. Merge is a separate owner action recorded against the same SHA. Deployment is out of scope for v1.

## Acceptance tests

`tests/lifecycle.test.ts` is the executable form of this document. Scenario names SC-01 to SC-19 are kept from the earlier design work for continuity.
