# Adversarial review — SF-001-review-07 (cycle-07 PAUSED-settlement simplification)

Reviewed: a02c9b010c8888683b43cc2773cc03cde454023b  ·  Base: edaa2cbe661c9d616d92733a2287d86e5107ba7d (resolved merge-base edaa2cbe661c9d616d92733a2287d86e5107ba7d)
Verdict: ship

Ship. This verdict maps to gate PASS for this single adversarial attempt. It is not owner acceptance of SF-001, the full specification or any Q1–Q5 proposal; full-spec approval remains a separate explicit owner gate.

The candidate removes the ACTIVE-preserving recovery exit for ESCALATED delivery and makes the escalated rows origin-agnostic. I tried to break that change and could not support a substantive finding from the supplied text. The traces below are documentation walkthroughs, not executed behaviour.

- **No ACTIVE exit while ESCALATED.**
  - `docs/specs/delivery-lifecycle-v0.1.md:119` keeps the only RECOVERING → ACTIVE transition behind "delivery not ESCALATED/terminal" and "no subsequent pause, escalation or failure blocker".
  - Lines 120–122 now resolve every escalated recovery to ESCALATED/PAUSED, QUARANTINED or an already-authorised cancellation. Those rows are healthy observation, required stop and empty set, for both ACTIVE and PAUSED origin.
  - I found no remaining row, scenario or decision text (SC-61/62/64/65, D-009, §8) that grants ACTIVE to ESCALATED delivery.
- **Origin-gap closure.**
  - Before this change, PAUSED-origin RECOVERING with ESCALATED delivery fell only under the generic paused-observation row, and the empty-set and stop rows were ACTIVE-origin only.
  - The candidate gives PAUSED origin explicit stop, empty-set and healthy rows.
  - It narrows `:123` to non-escalated delivery, so the two paused rows no longer overlap.
- **Mixed siblings (SC-65).**
  - A healthy kept sibling Q coexists with a sibling R that requires a stop.
  - The healthy row's guard excludes pending stop intents.
  - Its effect explicitly defers settlement until all required stops are proven under the stop row.
  - Both rows yield the same ESCALATED/PAUSED outcome, so ordering between "R contained" and "Q healthy" events cannot produce divergent control states.
  - Quarantine on the deadline and the quarantine-exit rule (`:126`) are untouched.
- **Failure precedence.** The uniform paused-execution-failure row (`:117`) still takes precedence under any control state. A crash or timeout of a kept sibling during either-origin recovery records the non-resumable blocker before any settlement. No Q3 path opens, because `:119` and Q3 (`:166`) both exclude escalated or post-pause origins.
- **Budget and authority.**
  - No changed row launches work, consumes or restores an allowance, alters counters or reservations, or resolves blockers.
  - The owner-resume row (`:125`) and the blocker-set restoration rule (`:82`) are unchanged. Restoration still lands in `resume_stage`/PAUSED and needs a separate owner resume.
  - Forcing PAUSED therefore adds no owner action on the dispatch path, consistent with A-007's stated rationale.
- **Scope.** The diff stays within A-007's authorised scope: the exception removal, aligned scenarios, status/§8 history and the acceptance-mapping range. It rewrites no historical verdict or counter.

## Not verified

- **No Git, test or runtime execution.**
  - I had no tools.
  - I did not run `git merge-base` or `git diff`.
  - I relied on the operator-supplied candidate/base SHAs, merge-base and diff text, and could not confirm that the diff or file extracts match the worktree byte-for-byte.
  - No executable controller, schema, fixture or test suite exists, so every conclusion here is a tabletop trace of prose guards. SQLite atomicity, state-version CAS, idempotent replay, OS confinement, process-tree termination, launcher dispatch-key lookup and runtime cancellation are all unproven. Per the spec, these remain later spike and test obligations that block unattended dispatch.
- **Files not supplied.** `docs/STATUS.md`, `docs/reviews/SF-001-cycle-07/README.md` and the earlier cycle ledgers were not provided. I did not check whether the counters and attempt records there agree with §8 and A-007. The original v0.3 DOCX was available only as the supplied extract.
- **Owner pause during RECOVERING (SC-63 "pause commits first").**
  - In this path, a pending safe escalation is afterwards evaluated under the PAUSED sibling rule (`:86`). That rule does not itself repeat the "authenticated current reconciliation evidence" wording that `:104` imposes during RECOVERING.
  - I did not raise this as a finding. `:100` already requires reconciling identity and containment after lost observation for paused work, and the owner-pause row (`:114`) requires ambiguous containment to be reconciled or quarantined.
  - An implementer should still encode "current proof after observation loss" uniformly for both paths. This is a reading of prose, not a confirmed gap.
- **Non-escalated, empty-execution RECOVERING.** `:119` needs a live run or replacement, and `:123` needs a healthy or completed run. Neither covers a non-escalated cycle that enters RECOVERING with no execution. This predates the candidate and is a liveness rather than a safety issue, since RECOVERING forbids dispatch and owner pause (`:114`) offers an exit. I could not determine from the prose whether a controller restart with no runs enters RECOVERING at all.
- **Unexercised mechanism.** The empty-set row's retained "no intervening pause" clause appears unreachable once owner pause exits RECOVERING. I treated it as harmless.