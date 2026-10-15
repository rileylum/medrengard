# Working agreement

Agreed by the owner on 2026-10-15 (A-017). This is how plan items become code. It is the core lifecycle run by hand until the controller can run it.

## From plan to tickets

Take the next row of [plan.md](plan.md). Break it into tickets that each fit one branch and one review. One plan step may become several tickets; a ticket never spans two steps. Number tickets by plan step: `02-a-...`, `02-b-...`.

Pick a route per ticket:

| Route | When | Ticket needs |
| --- | --- | --- |
| Fast | Internal, no UX, reversible, one obvious design | Goal, done-when checks, constraints, non-goals, verification |
| Design | Fixes a seam others build on, or has real alternatives | Fast fields plus a short design note: the interface, two alternatives, owner approval before code |

Record "not applicable" for design evidence, release impact and outcome signal when they do not apply. Do not invent them.

## Ticket file

`docs/work/NN-slug.md`, about fifteen lines:

```markdown
# NN — Title

Route: Fast | Design. One line on why.

Goal: one sentence.

Done when:
- Observable check; how it is verified.
- ...

Constraints: ...
Non-goals: ...
Verification: command, and who runs it.

## Log
- date — branch, SHA, standard 1 PASS/FAIL, standard 2, adversarial, merged
```

A ticket is READY when the owner has read it and said go.

## Per ticket

1. **Branch.** `feat/NN-slug` off main. One ticket per branch.
2. **Tests first.** Write failing tests from the done-when list, then make them pass. Commit with the ticket number in the message.
3. **Independent verification.** The owner runs `npm test` on the SHA. The implementer's claim does not count.
4. **Standard review.** A fresh session with no access to the implementer's conversation. Input: ticket, diff, SHA, test output, AGENTS.md. Output: PASS or FAIL with findings tied to files and lines. First FAIL permits one fix and one more standard review. Second FAIL stops; owner decides.
5. **Adversarial review.** After standard PASS, one fresh session told to break it: run the tests, feed bad inputs, try to advance state without evidence. FAIL stops; owner decides. No automatic retry.
6. **Accept and merge.** Owner merges the PR. Append the closing line to the ticket log.
7. **Status.** Update [STATUS.md](STATUS.md): what merged, what is next.

Budget per ticket: two standard reviews, one adversarial. Spent budget does not reset. A fix after a terminal FAIL is a new ticket that names the old one.

## Reviews

Reviews run in a fresh session through `claude -p` with the prompt in a file. Do not use the `dispatch` skill; it depends on herdr, which is not part of this setup. The reviewer prompt contains the ticket, the diff against main, the SHA, the test output and AGENTS.md. It must not contain the implementer's reasoning or this conversation. The reviewer returns:

```
Verdict: PASS | FAIL
Reviewed SHA: ...
Findings:
- [severity] file:line — what is wrong, how to reproduce
```

A review that does not name the SHA, or names a different one, is not a verdict.

## What we measure

Per ticket, in the log line: review attempts, confirmed findings, owner interventions. After a few tickets, look at where the time went and automate that step next.
