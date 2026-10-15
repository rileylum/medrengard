# SF-001-review-05 — Healthy escalated-recovery transition

## Authorisation A-005 — 2026-10-15

The owner replied “Yes” to a new cycle limited to the proposed healthy-reconciliation transition and SC-61 branch, with up to **two standard reviews and one adversarial review**.

- Scope: C4S2-F1. Reconcile a healthy/completed existing run from ACTIVE-origin RECOVERING while delivery remains ESCALATED; restore ACTIVE control, record the result, launch nothing.
- New cycle: SF-001-review-05; parent SF-001-review-04 remains exhausted. All earlier counters, failures, candidates and raw evidence remain unchanged.
- Current counters: standard 1/2 (FAIL), adversarial 0/1, infrastructure failures 0.
- No complete-specification acceptance, implementation, merge/deploy or standing budget reset authorised. A-004's paused-failure direction remains accepted.
- Manual review execution deadline: 600 seconds; infrastructure failures stop for guidance under the existing manual procedure.

## Revision

C4S2-F1 author-confirmed: add one guarded healthy-recovery row, including the escalation-before-default-pause window, and SC-61's matching branch. Only this transition/scenario and steering/audit records are in scope.

## Standard attempt 1 — FAIL; bounded correction prepared

- Candidate `7dde4c1b855ed7f77bd188b4861b908f494f8460`; comparison base `2094188d7ffc760e7736049c2baa4ce6cdc157bb`.
- [Exact input](standard-1-prompt.txt), [raw result](standard-1-result.json). Commit-extracted full documents, source text, actual design diff and prior independent findings; no author reasoning transcript.
- Fresh tool-disabled Claude Code command: `claude --safe-mode --strict-mcp-config --tools '' --no-session-persistence --permission-mode dontAsk --model opus --output-format json -p`, deadline 600 seconds. Reported model `claude-opus-5-5`, duration 128.373 seconds, cost $0.8478576. Valid matching-SHA FAIL, no runtime errors or permission denials. Textual/tabletop review only; no direct reviewer Git inspection or executable tests.
- C4S2-F1 resolved in the safe-sibling case. C5S1-F1 author-confirmed: healthy-recovery guard too broad for stop-required runs and missing complementary termination exit.
- Bounded correction requires recorded safe-sibling keep-observing authority and absence of pending stop; complementary row resumes bounded termination for stop-required/invalid-context work, yielding PAUSED or QUARANTINED with no launch. Clarifies escalation before/during recovery; SC-61 aligned. No additional scenario IDs or unrelated policy changes.
- Author structural checks before `7dde4c1`: local links, 61 unique ordered scenario IDs, `git diff --check`; passed.

Next: freeze correction and run final standard attempt. FAIL stops; PASS permits one adversarial review. Full specification remains unapproved.
