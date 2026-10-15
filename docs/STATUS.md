# Current status and session handoff

## Where we are

**SF-001-review-02 authorised (A-002); bounded corrections prepared for independent review. No design approval or implementation yet.**

Accepted direction: manual contracts-first bootstrap, TypeScript + SQLite, Pi and Claude Code, local execution. The owner approved a new 2+1 review cycle for S2-F1–F3; this is not acceptance of the design or a standing reset policy.

Active work: [SF-001](work/SF-001.md). [Cycle-02 ledger](reviews/SF-001-cycle-02/README.md). [Parent exhausted cycle](reviews/SF-001/README.md) retains standard 2/2 FAIL, adversarial 0/1 and one infrastructure timeout.

## Latest changes

- Defined explicit pre-readiness supersession and proposed bounded initial-work batch authority (Q5).
- Added one work-lineage tip, atomic child creation and terminal REVISED/CLOSED handoff outcomes to prevent duplicate cycles.
- Defined failed evidence precedence, outcome-specific waivers and registered external verification so reruns cannot silently clear failures.
- Added SC-45–55 and updated the contract/fixture outline. All remain draft design artifacts.

## Current counters and next action

Cycle-02: standard 0/2; adversarial 0/1; infrastructure failures 0.

**Freeze the revised candidate and obtain fresh-context standard review.** A first FAIL permits one bounded fix and one final standard review; second FAIL escalates. Standard PASS permits one adversarial review; its FAIL escalates. Infrastructure failures stop for guidance under the existing manual procedure.

No remote/publication, implementation, CI or executable controller tests. Parent evidence/counters remain intact. Do not infer final design acceptance from revision authorisation.
