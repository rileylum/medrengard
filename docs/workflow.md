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
3. **Independent verification.** The owner's `pre-merge-commit` hook runs `npm test` on the merge result when the owner merges (`scripts/pre-merge-commit`; install once with `ln -s ../../scripts/pre-merge-commit .git/hooks/pre-merge-commit`). The implementer's claim does not count (A-125).
4. **Standard review.** A fresh session with no access to the implementer's conversation. Input: ticket, diff, SHA, test output, AGENTS.md. Output: PASS or FAIL with findings tied to files and lines. First FAIL permits one fix and one more standard review. Second FAIL stops; owner decides.
5. **Adversarial review.** After standard PASS, one fresh session told to break it: run the tests, feed bad inputs, try to advance state without evidence. FAIL stops; owner decides. No automatic retry. With the FAIL, the implementer weighs each finding's risk and recommends a fix ticket, parking, or a merge with the risk accepted (A-042). Damage and leaving the remit come first, malicious code second (A-037); the defences need not be airtight.
6. **Accept and merge.** Owner merges the PR. Append the closing line to the ticket log.
7. **Status.** Update [STATUS.md](STATUS.md): what merged, what is next.

Review tiers (A-125), written from what the owner has chosen since row 9:

| Tier | Applies to | Reviews |
| --- | --- | --- |
| Trust | Seams that hold trust: the store, the controller and engine, the sandbox, grants, git over candidate trees, anything that reads candidate output outside a sandbox | Two standard and one adversarial through `claude -p`, with probes |
| Light | Refactors with no behaviour change, docs, the guide (`learn/`) | One review, in session or through `claude -p` |

The owner may move a ticket to another tier; the ticket records which. A missing test for correct code is a minor finding, not a major one.

Budget per Trust ticket: two standard reviews, one adversarial. Spent budget does not reset. A fix after a terminal FAIL is a new ticket that names the old one. If the owner merges with a FAIL on record (A-018), the finding goes to [work/parked.md](work/parked.md) with the ticket that must pick it up; that ticket is not READY until its done-when list covers it. If the owner accepts a risk instead, it goes to [work/accepted-risks.md](work/accepted-risks.md) with the reason and the event that would reopen it; it gates no ticket.

## Reviews

Reviews run in a fresh session through `claude -p` with the prompt in a file. Do not use the `dispatch` skill: it runs the session in a herdr tab, where the owner can talk to the reviewer, and the review must rest only on the prompt. herdr is used only by the experimental TUI in `proto/` (A-046), never for ticket reviews. The reviewer prompt contains the ticket, the diff against main, the SHA, the test output and AGENTS.md. It must not contain the implementer's reasoning or this conversation. The reviewer returns:

```
Verdict: PASS | FAIL
Reviewed SHA: ...
Findings:
- [severity] file:line — what is wrong, how to reproduce
```

A review that does not name the SHA, or names a different one, is not a verdict.

## What we measure

Per ticket, in the log line: review attempts, confirmed findings, owner interventions. After a few tickets, look at where the time went and automate that step next.
