# Current status and session handoff

## Where we are

**SF-001-review-04 authorised by A-004; conservative paused-failure correction prepared for review.**

The owner accepted the specific direction: execution failures while paused escalate and require a new individually authorised cycle/cancellation, not deferred retry. This does not approve the full lifecycle specification or implementation.

Work: [SF-001](work/SF-001.md). [Cycle-04 ledger](reviews/SF-001-cycle-04/README.md). All three earlier cycles retain their exhausted counters and evidence.

## Latest changes

- Replaced post-restoration paused retry references with one immediate failure-blocker/escalation rule.
- Aligned recovery guards, healthy observation-only recovery, owner pause/resume and Q3 eligibility; distinguished infrastructure execution failure from valid quality verdicts.
- Updated SC-61 for failure while ESCALATED/PAUSED and VERIFYING/PAUSED, with Q3 allowance unused or spent. Still 61 scenario IDs.

## Counters and next action

Cycle-04: standard 0/2, adversarial 0/1, infrastructure failures 0. Earlier cycles: each standard 2/2 FAIL, adversarial 0/1; cycle-01 alone had one infrastructure timeout.

**Freeze the corrected design and run fresh-context standard review.** First FAIL permits one bounded correction and final standard attempt; second FAIL escalates. Standard PASS permits one adversarial review; adversarial FAIL stops. Infrastructure failures stop for guidance under the existing manual procedure.

No remote/publication, implementation, dependencies, CI or executable controller tests. Accepted stack/runtime/hosting remain TypeScript + SQLite, Pi and Claude Code, local execution.
