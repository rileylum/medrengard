# SF-001-review-06 — Bounded recovery clarifications

## Authority and scope

A-006, 2026-10-15: owner replied “Yes, please start” to the proposed semantics and maximum **two standard / one adversarial** reviews. Parent SF-001-review-05 remains stopped at standard 2/2 (FAIL, PASS), adversarial 1/1 (FAIL), infrastructure failures 0. Earlier histories remain intact.

Scope: during-recovery safe-sibling decision ordering and current evidence, explicit empty-set exit to ESCALATED/PAUSED, owner-pause guard wording, matching scenarios and audit records. No implementation, new recovery machinery, unrelated policy changes or complete-specification acceptance.

- Cycle comparison base: `bcb001a9bd374768394584270cffffdf8ced9747` (audit tip; design unchanged from parent candidate `ab460b46b2e31bbfe1b33e7878295f4483894aed`).
- Current stage: **ESCALATED**, standard PASS followed by adversarial needs-attention/FAIL; no further fix/review authorised.
- Current counters: standard **1/2 (PASS)**, adversarial **1/1 (FAIL)**, infrastructure failures **0**.
- Review execution deadline: 600 seconds; infrastructure failure stops for owner guidance, without spending a completed verdict or automatically retrying.
- A first standard FAIL permits one bounded correction; second FAIL or adversarial FAIL stops. A new cycle is never automatic.

## Prior finding triage (author analysis, not an independent review)

Owner authorised read-only triage before this revision. Original [report](../SF-001-cycle-05/CHALLENGE.md), [standard result](../SF-001-cycle-05/standard-2-result.json) and [disagreement matrix](../SF-001-cycle-05/escalation.md) remain unchanged.

- **C5A1-F1: unsupported as a behavioural defect.** Owner pause moves RECOVERING to PAUSED; a later recovery event must revalidate its state version. Subsequent paused-origin interruption uses the paused-origin exit. The wording correction improves clarity; it does not retroactively confirm the claimed termination path.
- **C5A1-F2: uncertain, narrowed to decision timing/atomicity.** Current evidence is already required; stale proof does not authorise continuation. The prior text does not explicitly order granting the observation decision against the complementary stop evaluation during recovery. A-006 selects an explicit current-evidence evaluation and atomic outcome, without revoking existing stop intent.
- **C5A1-F3: uncertain, narrowed to empty execution sets.** Restart need not enter RECOVERING, but the broad operational-interruption guard does not exclude it. Valid-completion evidence may cover completed histories, but not clearly a genuinely empty history. A-006 selects a proven-empty exit to PAUSED, not vacuous ACTIVE permission.

These dispositions neither rewrite the adversarial FAIL nor clear the parent escalation. The owner authorised a new bounded revision, not acceptance by override.

## Revision and verification

The draft adds explicit eligibility/transaction ordering and an empty-set transition, aligns SC-61, and adds SC-62–64 for event ordering, pause races and empty recovery. Each preserves no-dispatch, counters, existing failure/containment handling and owner acceptance boundaries.

Author structural checks passed before candidate freeze: `git diff --check`, all local Markdown link targets exist, and SC-01–64 are unique and ordered. These Python/text checks are not executable lifecycle tests or independent verification. Frozen candidate: `09e4328d35a68929d9d07579727a323ee965a105`.

## Standard attempt 1 — PASS

- Candidate above, comparison base `bcb001a9bd374768394584270cffffdf8ced9747`.
- [Exact input](standard-1-prompt.txt), [raw result](standard-1-result.json), [stderr](standard-1-stderr.txt) (empty).
- Fresh tool-disabled Claude Code invocation: `claude --safe-mode --strict-mcp-config --tools '' --no-session-persistence --permission-mode dontAsk --model opus --output-format json -p`, 600-second deadline. Reported model `claude-opus-5-5`, duration 132.954 seconds, cost $0.8760576; valid matching-SHA PASS, no runtime errors or permission denials.
- No blocking findings. Seven non-blocking notes retained in raw output; no design edits after PASS. Review was text/tabletop analysis, not direct Git inspection or executed tests. Reviewer did not receive cycle ledger/author triage; the phrase 'fixes the contradiction' in its pause trace does not change the recorded unsupported disposition of C5A1-F1.
- This PASS permitted the single fresh adversarial review below; prior author reasoning and standard conclusions were excluded from its packet.

## Adversarial attempt 1 — needs-attention / FAIL

- Same frozen candidate and cycle-complete merge-base above. [Exact input](adversarial-1-prompt.txt), [raw result](adversarial-1-result.json), [stderr](adversarial-1-stderr.txt) (empty), [exact CHALLENGE.md](CHALLENGE.md), [workspace provenance](adversarial-workspace.txt).
- Fresh tool-disabled invocation with the same CLI flags and 600-second deadline in a detached worktree. Reported model `claude-opus-5-5`, duration 210.746 seconds, cost $1.0507696; valid matching-SHA needs-attention, mapped to FAIL; no runtime error or permission denial.
- One medium finding, confidence 0.5, local ID C6A1-F1: reverse-order scenario/control-state ambiguity and mixed-sibling stop-completion precedence. Standard review found these sequences non-blocking. Finding remains disputed/uncertain, not automatically confirmed. [Concrete sequences and decision packet](escalation.md).
- The reviewer accepted the empty-set exit and owner-pause correction. No dispatch/counter bypass alleged. No direct Git inspection or executable tests; operator-extracted numbered documents/diff supplied with the adversarial rubric.
- Exact result text saved unchanged in this directory and detached worktree root. Operator verified matching SHA, empty tracked worktree diff (only CHALLENGE.md untracked), unchanged reviewed design artifacts, both JSON verdicts and no errors/permission denials.
- **Stopped immediately.** No candidate edits, no second adversarial attempt, no use of the remaining standard slot to evade this stop, no automatic cycle seven. Owner decision required; full-spec approval still pending.
