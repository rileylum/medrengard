# 07-e — A fix run whose findings need no change to the tree

Route: Design. The head guard's "new tree" rule (07-a) is deliberate, and there are real alternatives.

Goal: a standard FAIL whose findings the developer cannot or should not fix with a new tree ends in a recorded, classified outcome, not a refused claim that reads like a developer error.

Done when:
- A design note names the cases and the outcome for each, and the owner approves it before code. Cases to cover at least:
  - a finding about commit metadata (message, author), which needs a new commit with the same tree;
  - a finding the developer disputes, or one that is about evidence the reviewer could not see;
  - a fix run that makes no commit at all.
- Each case has a test at `fix` with the fixture CLI, observed through the recorded event and the escalation reason.
- Every fix-claim refusal in `tests/developer.test.ts` still refuses, unless the approved design changes that case.

Constraints: zero dependencies. No paid calls. The controller decides state; the developer may only claim. A fix that is accepted must still be a new SHA, so evidence and verdicts stay bound to one commit.
Non-goals: letting a developer amend or rewrite commits that were already there; reviewer prompt changes, which are 06-d.
Verification: `npm test`, run by the owner.

Two alternatives for the design note to weigh:
1. Accept a new commit with the previous tree when its message differs, and add a claim field that disputes a finding. The dispute escalates to the owner with the developer's reason.
2. Keep the guard, and make the refusal name the case: "no tree change; the finding may need the owner". The fix prompt gains a rule saying so.

Evidence (2026-10-19, owner-run `RUNTIME_SPIKE=1 npm test`, live `main.ts` job): after the 06-d finding above, the fix run claimed `da3bcd2` again; the cycle escalated with "commit da3bcd2… is the previous candidate, not a new commit".

## Log
- 2026-10-19 — drafted after the 09-c live run (A-064). Not READY until the owner says go.
