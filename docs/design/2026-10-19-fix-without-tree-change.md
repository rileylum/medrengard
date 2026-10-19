Branch: feat/07-e-fix-without-tree-change

# A fix run whose findings need no tree change (ticket 07-e)

Status: proposal. No code until the owner approves it.

## Problem

After a standard FAIL, `fix` runs the developer again. `refuse` in `src/developer.ts` accepts the fix claim only if it names a new SHA with a new tree. A developer that cannot or should not change the tree has no claim it can make. Whatever it does is recorded as `run_failed`, so the escalation reads like a developer error.

The live run (A-064) showed it: the reviewer failed `da3bcd2` over a commit message, and the fix run claimed `da3bcd2` again. The cycle escalated with "commit da3bcd2… is the previous candidate, not a new commit".

Facts the design must respect:
- The controller decides state. The developer only claims.
- An accepted fix is a new SHA, so evidence and verdicts stay bound to one commit.
- Since 06-d, the reviewer reads the commits in `base..head`. The history is now part of what is reviewed, as the tree is.
- The fix prompt tells the developer not to amend commits that were already there. Nothing enforces that.
- An escalated cycle has two owner moves: cancel, or a child cycle that starts again from the base (D-016, O-011).

## Cases and outcomes

| Case | What the developer does | Today | Proposed outcome |
| --- | --- | --- | --- |
| 1. Commit metadata finding (message, author) | Adds a commit on top of the previous candidate, same tree, new message | `run_failed`: "no changes against the previous candidate" | **Accepted** as a new candidate if the head descends from the previous candidate. Verification and the second standard review run, and the reviewer judges the new history. |
| 1b. Same tree, history rewritten | Resets and recommits, or amends | `run_failed` | `run_failed`: "commit … has the previous candidate's tree but does not descend from it; rewriting commits is not allowed". |
| 2. Disputed finding, or evidence the reviewer could not see | Claims the previous candidate with a `dispute` reason | `run_failed`: "previous candidate, not a new commit" | New event `dispute`. The cycle escalates with "developer disputes the STANDARD_REVIEW findings on <head>: <reason>". No budget is spent. |
| 3. No commit and no dispute | Claims the previous candidate with no reason | `run_failed` | Still `run_failed`. The reason names the case: "commit <head> is the previous candidate: the fix run made no new commit and gave no dispute". |
| 4. Dispute together with a new commit | `dispute` and a head other than the previous candidate | not possible | `run_failed`: "a dispute must name the previous candidate". A partial fix plus a dispute is something to classify later, not to guess at now. |
| 5. Dispute outside a fix run | A first developer run sends `dispute` | not possible | ESCALATED: "dispute outside a fix run". This is the same rule as any other event a stage does not take. |

Every other refusal in the 07-a test stays as it is: the base, a non-tip, an orphan, a revert to the base's tree, an unknown or short SHA. The 07-a `empty` variant (an empty commit on top of the previous candidate) moves from refused to accepted under case 1. That is the one existing test this design changes, on purpose.

## Interface

- **Claim.** The fix claim gains one optional field: `{"head": "<sha>", "artifacts": [...], "dispute": "<reason>"}`. `toEvent` in `src/controller.ts` turns a claim with `dispute` into a `dispute` event instead of a `developer_result`.
- **Event.** `{ type: 'dispute', runId, head, reason }`. In a commit stage that has a candidate, `apply` escalates the cycle with the reason and marks the run consumed. The store deduplicates it the way it deduplicates `developer_result`.
- **Guard.** In `refuse`, the "no changes against the previous candidate" check becomes an ancestry check. A head with the previous candidate's tree must have the previous candidate as an ancestor. A head with a new tree is judged as today.
- **The reason is developer text.** It passes through `oneLine` and is cut to 2 KiB before it is recorded, so it cannot add lines to the owner's terminal or flood it (07-c).
- **Fix prompt.** Two new rules, so the fix contract hash and `tests/fixtures/prompts/fix.txt` change on purpose:
  - "To fix a commit message or author, add a new commit on top. Do not amend or rewrite the earlier commits."
  - "If you believe a finding is wrong, or it needs a change you must not make, do not commit. Claim your earlier commit and add a `dispute` field with your reason. The owner decides."

## Alternatives

**1. As the ticket states it: accept a same-tree commit only if its message differs, plus a dispute field.** This is the chosen approach, with one change: no "message differs" test. Which messages to compare is unclear (only the new commit's? the whole list?), and the reviewer already judges the history in full. The budget is the brake. An empty commit can win at most one more standard review, and a second FAIL escalates.

**2. Keep the guard and only name the case in the refusal, with a prompt rule saying so.** This is the smallest change. It fixes the misleading reason, but every metadata finding then costs an escalation and a child cycle from the base, which throws the developer's work away (O-011). Case 3 takes this route; cases 1 and 2 do not.

## Cost and risk

- A same-tree fix reruns the checks on a tree they already passed. That is deterministic and cheap, and it keeps evidence bound to the new SHA.
- A developer can now spend the second standard review on a cosmetic commit. Its budget is the same as today's.
- A dispute stops the cycle at once. The owner cannot yet overrule a verdict and continue the same cycle; that would be a new owner move. Until there is one, the dispute only gives the owner a reason to read before cancelling or opening a child cycle.

## Questions for the owner

1. Approve cases 1 to 5 and the interface above?
2. Should a dispute stop the cycle (as proposed), or should the owner be able to overrule the finding and continue the same cycle? Overruling needs a new decision event and is a larger change. I recommend a separate ticket.
3. The dispute reason is cut at 2 KiB. Is that limit right?

## Tests (after approval)

At `fix` with the fixture CLI, observed through the recorded event and the escalation reason:
- case 1: a new commit with a new message and the same tree reaches VERIFYING on the new head;
- case 1b: a reset and recommit with the same tree is refused, naming the rewrite;
- case 2: a dispute escalates with the reason, spends no budget and consumes the run;
- case 3: a claim of the previous head with no dispute is refused, naming the case;
- case 4: a dispute with a new head is refused;
- case 5: a dispute on a first run escalates;
- a dispute reason that holds a newline or is over 2 KiB is one line and cut;
- the fix golden prompt changes only by the two rules.
