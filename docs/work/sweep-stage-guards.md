# sweep-stage-guards — Tests for the events a stage does not take

Route: Fast. Tests only, for engine rules the spec already states; no behaviour changes.

Goal: every guard in `apply` that refuses an event the stage's kind does not take, and the three "ignore" branches beside them, is held by a test.

Owner's instruction, 2026-10-20: "Once all this research comes back, triage it (merging similar things and organizing it, giving ratings for highest impact) - then create a worktree for each and spin up a sub agent to implement them. I want to come back tomorrow to a number of ready to merge branches, so we should only focus on the high quality and high impact ones. We will then work through them together, deciding if they should be merged or not, or if they need changes before going in - so you will need to explain each to me in plain english and defend the changes." Triage item B8; source: sweep finding 4.

Done when:
- One table-driven test sends each of `claim`, `developer_result`, `dispute`, `verification`, `verdict`, `accept` and `request_changes` to each default-workflow stage whose kind does not take it, and asserts ESCALATED, an "outside" reason, and no budget spent. Verified by test.
- A claim while a developer run is active is ignored and starts no run. Verified by test.
- `head_changed` naming the candidate head and `base_changed` naming the candidate base are ignored outside a commit stage. Verified by test.
- Each of the nine mutants of sweep finding 4 (`mutants.py` 0 to 7 and 11) is killed. Verified by mutation.
- The spec's "event the stage's kind does not take" row names the test and is no longer a **Proposal**.

Constraints: zero dependencies; `src/` unchanged. If a test exposes a real bug, stop and report it.
Non-goals: a producer for `head_changed` or `base_changed` (owner question below); the `run.ts` step cap and `review.ts` head check mutants (sweep 33, 34).
Verification: `npm test`, run by the owner on the branch SHA.

## For the owner

**What was wrong.** `apply` in `src/lifecycle.ts` refuses an event that arrives in the wrong kind of stage: a verification during a review, an `accept` before the human stage, a verdict during verification, and so on. The sweep deleted each of those checks, one at a time, and every test still passed. So a later edit could remove one by mistake and nothing would notice. Without the verification check, for example, a passing verification that arrives during a review would count as a review PASS and move the cycle on. Three more branches were also unguarded: a second claim while a developer run is active is ignored, and a head or base "change" that names the current head or base is ignored.

**Reproduction.** On `a3c74ff`, delete line 429 of `src/lifecycle.ts` (`if (def?.kind !== 'command') return escalate(...)`) and run `npm test`: 0 failures. The sweep's runner, `/var/tmp/software_factory/research-2026-10-20/sweep/mutants.py`, did this for each guard (`mutants.out`, lines 0 to 7 and 11: SURVIVED).

**What the change does.** It adds tests only. One test walks a table: each event type, sent to each stage of the default workflow that does not take it, must escalate with an "outside" reason and spend no budget. Two small tests pin the claim-already-active ignore and the same-head and same-base ignores. The spec row now names the test.

**Why this approach.** One table covers the whole family in one place, so a new event type or stage kind has an obvious row to add. The cells reach each stage through real events, as the other lifecycle tests do. The one exception: a `developer_result` or `dispute` can only reach the stage check if its run is known and unfinished, which never happens outside a commit stage in normal play, so the test adds such a run to the cycle by hand.

**Risks and what it does not cover.** The table runs under the default workflow only. The engine's guards look at the stage's kind, not its name, so another workflow takes the same paths. The test pins the word "outside" in the reason, not each full message, so rewording a reason keeps it green as long as the word stays.

**Decision for you: `head_changed` and `base_changed` have no producer.** Nothing in `src/` ever records either event. They appear only in `src/lifecycle.ts`, the tests and the guide's simulator. So the spec rules "candidate head changes → ESCALATED" and "target base changes → ESCALATED" never fire in a real run. Reviews are bound to a SHA, so this is not a safety hole for the reviewed code. But if `main` moves after the reviews, nobody tells you at `accept`, and the merge you run combines code that nobody tested together. Should the factory escalate the cycle when the base moves, or only warn at `accept` when the job's base ref no longer points at the recorded base? This branch does not build either.

## Log
- 2026-10-20 — ticket drafted on `feat/sweep-stage-guards` off `a3c74ff`.
