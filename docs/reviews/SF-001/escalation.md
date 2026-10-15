# SF-001 — Standard-review budget exhausted

Cycle: SF-001-review-01. Disposition: **ESCALATED**. Candidate: `117d763c9b1d57a1ecb6278a1d88a8480c3bfa83`; base `f9569aa35f68d3e789152febab3489a47f34b1cb`.

## Evidence and authority

The owner explicitly authorised one replacement execution of standard attempt 2 with a 600-second deadline. [Authorisation](standard-2-retry-authorisation.md). It used the unchanged [review packet](standard-2-prompt.txt), whose candidate artifacts were checked against Git before execution. The prior timeout/empty output remains preserved.

[Raw replacement result](standard-2-run-2-result.json): valid JSON, `is_error: false`, completed in 256.071 seconds, one turn, explicit **FAIL**, matching reviewed SHA, no permission denials. Reported model: `claude-opus-5-5`; reported API cost: $0.9731816. No tools enabled; no author reasoning transcript supplied. This is independent textual/tabletop review, not executable testing. The reviewer's inability to independently inspect Git or the later retry authorisation was disclosed; the operator verified those separately.

Completed counters: **standard 2/2 (FAIL, FAIL); adversarial 0/1**. Infrastructure failures: **1** (the earlier timeout). No further review or design fix is authorised in this cycle. No specification approval is inferred.

## Findings requiring owner disposition

The second reviewer marked S1-F1–F7 resolved as originally raised, with related residual issues below. These new findings are reviewer-reported, with disposition **uncertain pending owner triage**; no fixes have been applied. They are concrete enough to justify a narrowly scoped revision recommendation, not an automatic budget reset.

| ID | Severity | Counterexample / unresolved behaviour | Recommended revision scope (not implemented) |
| --- | --- | --- | --- |
| S2-F1 | Medium | PREPARING pins contract v1; refinement produces v2, but no explicit supersession path exists. Initial-cycle owner authorisation also introduces an unlisted gate on every task. | Define pre-readiness refinement/child creation and all-stage applicability. Explicitly choose individual versus batch/policy authorisation without silently adding routine human stage-kicking. |
| S2-F2 | Medium | Two distinct revision decisions against the same INVALIDATED handoff can create two live children; event dedupe alone does not prevent this. | Enforce one live delivery lineage per work, atomically link the replacement child, and reject/no-op subsequent competing authorisations. Include accepted-but-unmerged work in the rule. |
| S2-F3 | Medium | Mandatory check FAIL followed by a permitted waiver or externally produced PASS has conflicting resume rules; external reruns could evade bounds. | Specify failed-check evidence precedence, whether a failure can be waived in-cycle, and how externally produced reruns are authorised/accounted. Distinguish BLOCKED from FAILED explicitly. |

Non-blocking reviewer notes are retained in the raw result: concurrency implications of strict base-drift invalidation; table completeness; adversarial reservation point; declining merge; missing pause/resume/reject scenarios; design-conformance phase; historical snapshot status. They are not extra completed review attempts or approved scope expansions.

## Requested owner decision

Recommended: authorise **SF-001-review-02** as a narrowly scoped revision addressing S2-F1–F3 and directly related scenario clarifications, with **at most two standard reviews and one adversarial review**. Keep SF-001-review-01 and its counters immutable, preserve this rejected candidate, and freeze a new candidate before review. This is a proposal for explicit one-off authorisation under the manual procedure, not approval of draft Q1 or a standing reset policy.

Alternatives: request human triage/rethink before revision, or hold the design. Do not treat disagreement with a finding as an automatic PASS or resume the exhausted cycle.

Until a decision is recorded: no design edits, no third standard review, no adversarial review, and no SF-002 implementation. Audit-only commits may preserve results but do not substitute a new reviewed candidate.
