# 07-a — Fix run after a standard FAIL

Route: Design. The second developer run reshapes `src/developer.ts`, the seam the step 7 loop and the reconcile ticket call. Approved A-032.

Goal: a cycle that a standard FAIL sent back to DEVELOPING gets one more developer run on its own worktree and branch, prompted with the findings, and reaches VERIFYING only on a new commit that passes the same head guard as the first run.

## Design note

### Seam

`src/developer.ts` exports a second entry point beside `develop`, the same shape as `verify` and `review`: everything it needs is in the store or under `runsDir`, so the loop, a restarted controller and the tests call it with nothing held in memory.

```ts
/** Run the developer again on the cycle's worktree after a standard FAIL. Returns the replayed Cycle and where its branch lives. */
export function fix(store: EventStore, adapter: DeveloperAdapter, cycleId: string, job: Job, opts: DevelopOptions): Promise<Developed>;
```

Behind it, in order:

1. `store.load(cycleId)`: the stage must be DEVELOPING with a candidate whose head is set (a second run, not a first) and no developer run still active; anything else throws before a run starts. The last `verdict` event must be a FAIL for the candidate head; its `findings` (possibly empty) are the fix list. Nothing is appended on a throw: the cycle was already mid-life, and a cancel here would hide a controller bug.
2. The worktree is `<runsDir>/<cycleId>` on `sf/<cycleId>`, as `develop` left it. It must exist, be on that branch, and have the candidate head at its tip; a moved tip throws (the spec's "candidate SHA changes outside a fix run" is for the owner, not for a run to paper over). Untracked and modified files the developer left are allowed: the head guard judges the commit, not the tree.
3. Prompt: `develop`'s prompt plus one section after the ticket: "A review of your commit `<head>` FAILED. Fix these findings, then commit:" and the findings, one per line. Same rules, same claim fence.
4. `execute(store, cycleId, developer, { role: 'developer', prompt, cwd: worktree }, { deadlineMs, base: candidate.base, accept })`. `apply` records the claim as a second developer run on the open cycle; `developer_result` moves it to VERIFYING with the new head and counters untouched.

**Head guard.** `refuse` as today (full SHA, branch tip, descended from the base, non-empty diff against the base) plus two rules: the head must differ from the previous candidate head, or there is no new candidate SHA for verification to bind to; and its tree must differ from the previous candidate's (standard review 1), or an empty commit on top of the failed candidate would spend the second verification and the last standard review on the diff that already failed. Descent from the previous head is not required: an amended commit is still the developer's work against the base, and the reviewers judge `base..head`. `develop` and `fix` share the guard and the prompt builder; `develop` is otherwise unchanged.

### Alternatives

Seam: (1) `fix` beside `develop` with the findings read from the store (chosen); (2) `fix(..., findings: string[], ...)` with the loop passing them, rejected because the store already holds them and a caller could pass findings for the wrong verdict; (3) a `mode` on `develop`, rejected because the two differ in what they open, guard and prompt, and `develop`'s cancel-on-throw is wrong for a cycle that already has a candidate.

Head guard: (1) new head differs from the old (chosen); (2) new head descends from the old, rejected because an amend is a legitimate fix and the diff reviewed is against the base either way.

### Parked lines

None fall on `developer.ts` beyond the 05-b notes (`name` check, `runsDir` escaping), left parked.

## Done when

- After a fixture `develop`, `verify` and a `verdict fail` review, `fix` with the fixture `commit` case moves DEVELOPING to VERIFYING on a new head: `candidate.head` differs from the FAIL's head, `candidate.base` is unchanged, `standard` is 1, a second developer run is on `runs` with `input` naming the old candidate, and the branch tip in the repository is the new head; both `claude` and `pi` fixtures; verified by test in `tests/developer.test.ts`.
- The fix prompt carries the ticket, the failed head and each finding from the verdict event; verified by test through the fake adapter's request.
- A fix claim naming the previous head, or an empty commit on top of it, is refused (`run_failed`, ESCALATED, reason names the head); the first run's refusals (the base itself, not the tip, not descended, a revert whose diff against the base is empty, unknown, abbreviated) hold on the fix run too; verified by test, each rule on the fix path.
- `fix` throws and appends nothing when the cycle is QUEUED, VERIFYING, a review stage, ESCALATED or CANCELLED, when the cycle is in DEVELOPING with a developer run still active, or when the worktree is missing, its branch tip is not the candidate head, or its HEAD is detached or on another branch; verified by test. The guard that the last verdict is a FAIL for the candidate head is verified by reading: DEVELOPING with a candidate head arises only from that verdict, so the store cannot reach the throw.
- `tests/review.test.ts` "after a standard FAIL and a fix run" drives the fix through `fix`, not through `execute` by hand; the existing assertions hold.
- `npm test` offline spawns neither `claude` nor `pi`; no new live test (07-b's end-to-end run covers the real CLIs).

Constraints: zero dependencies; `execute`, `lifecycle.ts`, `store.ts`, `verify.ts`, `review.ts` unchanged; `develop`'s behaviour unchanged (its tests do not change).
Non-goals: the loop (07-b); findings formatting beyond one line each; descent from the previous head; worktree cleanup.
Verification: `npm test`, run by the owner on the reviewed SHA. `lazy-review` on the diff before the standard review.

## Log
- 2026-10-16 — drafted with 07-b for the step 7 question round.
- 2026-10-16 — question round: owner “Take all recommendations” (A-032). READY. Branch `feat/07-a-fix-run` off main.
- 2026-10-16 — tests first (`tests/developer.test.ts`: four new tests through a `failed()` helper that takes the fixture through develop, verify and a `verdict fail` review; the `tests/review.test.ts` fix-run test now calls `fix`; all red), then `fix` in `src/developer.ts`: loads the cycle, requires DEVELOPING with a candidate head, no active developer run and a last verdict FAIL for that head, requires the worktree on `sf/<cycleId>` with the candidate at its tip, prompts with the findings after the ticket, and calls `execute` with the shared `refuse` plus one rule (the head must differ from the previous candidate). The fixture's `base` variant claims the worktree HEAD, which in a fix run is the previous candidate; the test expects that. Mutation checks on c5322f6, one replacement each, restored after: 7 run, 6 fail a test; the survivor is the last-verdict guard, unreachable through the store (done-when wording updated). lazy-review: nothing to cut. Implementer-run `npm test`: 155 tests, 132 pass, 18 skipped (live), 5 todo, 0 fail. Awaiting owner-run tests on c5322f6, then standard review 1.
- 2026-10-16 — owner-run on c5322f6: `npm test` 155 tests, 132 pass, 18 skipped, 5 todo, 0 fail. Standard review 1 launched on c5322f6.
- 2026-10-16 — Standard review 1 on c5322f6: FAIL. 1 major (done-when 3 claimed the base and empty-diff rules tested on the fix path; the fixture's `base` variant exercises the previous-candidate rule instead, `empty` was omitted, and an `--allow-empty` commit on the failed candidate was accepted by design, reaching VERIFYING with the tree that had just failed), 1 minor (`fix` checked the branch tip but not that the worktree's HEAD is on the branch: a detached or switched worktree spent the run on a claim refused as not the tip), 3 notes (same-tree fix as designed; the done-when wording fix sat in the docs commit above the code SHA; the refusal test's name). Fixed in 6261150: `refuse` on a fix run also refuses a head whose tree equals the previous candidate's (`git diff --quiet previous head`, a design deviation from A-032's "differs from the previous head" only, recorded here); `fix` requires `symbolic-ref HEAD` to be the cycle's branch; the refusal test covers `empty` (same tree), a fake adapter claiming the base itself, a reverting adapter (empty diff against the base), a detached worktree and a switched one. Mutation checks on 6261150: same-tree, on-branch, empty-vs-base and base-claim rules each fail a test when removed. Implementer-run `npm test`: 155 tests, 132 pass, 18 skipped, 5 todo, 0 fail. Budget: standard 1 of 2 used; the next standard FAIL stops the ticket. Awaiting owner-run tests on 6261150, then standard review 2.
- 2026-10-16 — owner-run on 6261150: `npm test` 155 tests, 132 pass, 18 skipped, 5 todo, 0 fail. Standard review 2 launched on 6261150.
- 2026-10-16 — Standard review 2 on 6261150: PASS, 0 major, 0 minor, 4 notes (ticket wording at the code SHA lagged the docs commit; the same-tree refusal goes beyond A-032's guard and needs the owner to see it; "appends nothing" was asserted on only some of the throw paths and ADVERSARIAL_REVIEW was not driven; all standard 1 findings confirmed closed, mutation checks and `npm test` matched). Test-only change in 76a84cd: every `fix` throw path asserts the event count is unchanged, and ADVERSARIAL_REVIEW is driven through a fixture PASS review. Budget: standard 2 of 2 used. Awaiting owner-run tests on 76a84cd and the owner's word on the same-tree rule, then the adversarial review.
