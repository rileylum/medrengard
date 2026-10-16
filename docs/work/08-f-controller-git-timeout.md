# 08-f — The controller's git cannot hang on what a run left

Route: Fast. Fix ticket for 08-e's adversarial FAIL on `eeffa15` (A-041). Stacked on 08-e.

Goal: no git call the controller makes over a tree that a run or a check wrote can hold the controller past the stage deadline. A call killed at the deadline is a failure with its reason, recorded where any other git failure at that call is recorded.

Done when:
- 08-e adversarial major: a FIFO a check leaves at a gitlink's `vendor/.git/HEAD` records `tree: FAIL` whose evidence names the timeout. `verify` returns, and the gitlink is emptied. Verified by test.
- 08-e adversarial minor: the same test fails when `update-index` is moved out of `treeDiff`'s `try`. Verified by mutation.
- Same hang on the developer side, reproduced by the implementer session while scoping: a FIFO the developer leaves at its clone's `.git/HEAD` blocks `land`'s fetch and `fix`'s git in the clone. With the timeout, `land` refuses the claim naming the timeout and `fix` throws naming it. No process of the killed call survives. Verified by test.
- Each of these calls (`checkoutGit` in verify and review, `land`'s fetch, `cloneGit`) has the stage's `deadlineMs` as its timeout and SIGKILL as its signal.
- 08-e adversarial note: the main.ts reviewer test asserts which CLI ran, so building claude for `runtime: pi` fails it. Verified by mutation.
- Parked 08-d minor (A-040, the next ticket that touches `verify.ts`): `restoreAccess` and `removeUntracked` handle names that are not valid UTF-8. An untracked entry with such a name is removed, and so are the entries after it. A committed directory with such a name verifies. Verified by test.

Constraints: zero dependencies. Untouched: `lifecycle.ts`, `store.ts`, `main.ts`.
Non-goals: a total time budget for a stage's git calls (each call has its own); hostile-check findings as a class (no owner rule, A-041).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — owner: “Option 1 go” (A-041). Branch `feat/08-f-controller-git-timeout` off `feat/08-e-reviewer-sandbox-tests` at `5cb1b05`. While scoping, the implementer session reproduced the developer-side hang: with a FIFO at a clone's `.git/HEAD`, `git fetch` from the clone and `git rev-parse HEAD` in it each ran until `timeout 5` killed them (exit 124).
