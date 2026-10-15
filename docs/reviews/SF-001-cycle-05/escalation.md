# SF-001-review-05 — Adversarial escalation and reviewer disagreement

Disposition: **ESCALATED after adversarial needs-attention (FAIL)**. Candidate `ab460b46b2e31bbfe1b33e7878295f4483894aed`; standard comparison base `7dde4c1b855ed7f77bd188b4861b908f494f8460`; adversarial merge-base `2094188d7ffc760e7736049c2baa4ce6cdc157bb` (cycle's complete design change).

## Gate evidence

- [Final standard result](standard-2-result.json): **PASS**, no material findings; duration 171.561 seconds, reported model `claude-opus-5-5`, cost $0.9595856.
- [Adversarial report](CHALLENGE.md), [raw result](adversarial-1-result.json), [exact input](adversarial-1-prompt.txt): **needs-attention**, mapped to FAIL. Duration 105.133 seconds, reported model `claude-opus-5-5`, cost $0.7544856.
- Adversarial invocation used a fresh tool-disabled context in a detached worktree at the same candidate. Input contained numbered commit-extracted docs, original source text and actual merge-base design diff; no developer reasoning transcript or prior review conclusions. The adversarial-review skill rubric was supplied, adapted transparently for a design-only textual review.
- Reviewer output preserved exactly as CHALLENGE.md in its worktree and this audit directory. Reviewer had no filesystem tools; operator performed packet extraction and report persistence. No tracked changes or commits in the detached worktree; only CHALLENGE.md untracked.
- Both valid JSON results identify the candidate, have no runtime error/permission denials, and are independent tabletop analysis—not executable checks, direct reviewer Git verification or approval of the full specification.

## Counters and stop

Cycle-05 completed: **standard 2/2 (FAIL, PASS); adversarial 1/1 (FAIL); infrastructure failures 0**. Earlier cycles remain intact. Stop: no fix or second adversarial review is authorised. D-008 remains accepted; full specification approval is pending.

## Findings for triage — not automatically confirmed

The report has no finding IDs, so these local ledger IDs map to its headings without modifying the original report. All dispositions are **uncertain**, pending owner triage. In particular, standard review explicitly considered overlapping cases non-blocking; do not treat either reviewer as infallible.

| ID | Adversarial claim | Severity / confidence | Contrary evidence / triage question |
| --- | --- | --- | --- |
| C5A1-F1 | Stop row names owner pause, potentially terminating a safe sibling instead of retaining observation | Medium / 0.55 | Standard note N2 says the owner-pause event immediately changes RECOVERING→PAUSED, so the stop row's RECOVERING precondition no longer holds. Is there a reachable event ordering where termination actually follows, or is this redundant guard wording? |
| C5A1-F2 | Escalation raised during recovery has no explicit way to record a current keep-observing decision | Medium / 0.45 | Standard note N3 treats unavailable confinement proof as a deterministic conservative stop, and suggests clarifying use of reconciliation evidence. Does the existing rule already determine the outcome, or is a transition-level decision missing? |
| C5A1-F3 | ACTIVE-origin recovery with no live runs has no clear exit | Low / 0.35 | Standard note N4 says restart with no runs/intents need not enter RECOVERING. Does the spec require that transition or is the adversarial trace assuming it? |

## Recommended next action — manual owner triage, not another automatic fix cycle

Resolve these disagreements against concrete guarded event sequences before adding more design text or approving another budget. The findings may justify small clarity edits, or may be rejected as unreachable/speculative; neither outcome should be fabricated by the author.

Owner options:
1. Request a bounded manual triage that classifies the three claims and proposes only warranted corrections, with no additional quality-review run or design edits until scope is agreed.
2. Explicitly authorise a new correction/review cycle with named findings, scope and limits, if the owner accepts the claims.
3. Hold/rethink the design.

Rejecting a finding does NOT automatically rewrite the adversarial FAIL to PASS or accept the specification. Any later disposition, override or new review budget must be explicit and auditable. No new cycle is authorised by this packet.

## Checks and limitations

Before `7dde4c1` and `ab460b4`: local Markdown links, 61 ordered unique scenario IDs and `git diff --check` passed; first-review JSON also checked before the latter. Standard PASS SHA validated before adversarial dispatch; design files unchanged against that SHA. Detached worktree diff empty after review, report the only untracked file. No executable controller/test suite exists. Source diagrams were not supplied to reviewers; source body/table text was. Runtime confinement and cancellation capability remain unproven for production use.
