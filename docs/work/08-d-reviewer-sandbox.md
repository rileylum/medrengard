# 08-d — Reviewer runs in the sandbox; untracked leftovers

Route: Fast. It reuses 08-c's runtime policy with the cwd read-only (A-038). READY since 08-c's standard PASS (A-038).

Goal: a reviewer run (claude or pi) runs inside bubblewrap with the verify checkout read-only and nothing else of the owner's home but its CLI and configuration. Nothing a check leaves in the checkout reaches the reviewer.

Done when:
- A reviewer spec binds its cwd read-only. Under bwrap a fixture reviewer cannot write the checkout, `/var/tmp` outside its own `/tmp`, or the owner's home. `main.ts` passes the job's sandbox to both reviewer adapters. Verified by test.
- 06-c parked line: `piReviewer` runs `--no-context-files`. Verified by an args test.
- 08-b major (gitlink): a gitlink path in the checkout is emptied after the checks, and anything a check left in it is recorded as `tree: FAIL`. Verified with probe `08-b/probes/adv.mts gitlink` as a test.
- 08-b major (dangling symlink): `removeUntracked` unlinks anything `lstat` says is not a directory. Verified with `adv.mts dangling` as a test.
- 08-b minor (whitespace-led tracked path): the tracked list comes from an untrimmed listing. Verified with `adv.mts leadingws` as a test.
- 08-b minor (deep chain plus locked directory): one `try` around the restore and the removal records the failure instead of throwing. Verified with `adv.mts deeplocked` as a test.
- 08-c adversarial minor (A-039): a directory chain past PATH_MAX left in a run's `/tmp` does not make the adapter's cleanup throw; the run's outcome stands. Verified by test.
- Live: one claude and one pi reviewer under bwrap return a verdict (`RUNTIME_SPIKE=1`, two paid calls).

Constraints: zero dependencies; reuse 08-c's adapter policy.
Non-goals: network filtering by domain; claude's own `CLAUDE.md` discovery beyond what `--restricted` already does.
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — drafted after the owner's “Take all, go” (A-038). Stacked on 08-c.
- 2026-10-16 — Owner: “Merge and park it” (A-039). The 08-c adversarial minor joins the done-when list. Branch `feat/08-d-reviewer-sandbox` off `feat/08-c-developer-sandbox` at `9a1cce7`.
- 2026-10-16 — tests first (`b580729`, red, 8 failing for the stated reasons). `tests/cli-adapter.test.ts`: a reviewer cannot write its cwd and a developer can; a chain past PATH_MAX in the run's `/tmp`. `tests/verify.test.ts`: the four `adv.mts` cases as tests (gitlink filled and untouched, dangling symlinks, a tab-led tracked path through review, deep chain plus locked directory). `tests/review.test.ts`: `--no-context-files`, and the live reviewers run in bwrap. `tests/run.test.ts`: main.ts runs the reviewers in the sandbox, using a stub claude that commits as the developer and writes outside as the reviewer.
- 2026-10-16 — implementation (`4728b79`, `4991a9e`). `cliAdapter` writes the cwd only for the developer role and binds a reviewer's cwd read-only. The run's `/tmp` is removed with `chmod -R u+rwX` and `rm -rf`, which neither throw nor fail on deep chains. `piReviewer` adds `--no-context-files`. `main.ts` passes the job's sandbox to both reviewers. In verify, the tracked list comes from the full `ls-tree -z` format, gitlinks are emptied and any content in one is `tree` dirt, non-directories are unlinked, and a removal that throws is `tree` dirt with its reason.
- 2026-10-16 — live, `RUNTIME_SPIKE=1`, implementer-run, 2 paid calls: the claude reviewer (26.5 s) and the pi reviewer (7.9 s) in bwrap each recorded a verdict for the candidate SHA. Output: `/var/tmp/software_factory/08-d/live-review-1.txt`.
- 2026-10-16 — mutation checks, one replacement each, `src` restored after: 10 run, 9 fail a test. The survivor swaps the controller's untrimmed listing for the trimming helper. It is equivalent: with the full format each record starts with its mode, so a trim cannot reach a path. The comment says so. Script and output: `/var/tmp/software_factory/08-d/mut.py`, `mutations.txt`. lazy-review: nothing to cut.
- 2026-10-16 — Implementer-run `npm test` on `4991a9e`: 215 tests, 191 pass, 19 skipped, 5 todo, 0 fail. Not independent. Output: `/var/tmp/software_factory/08-d/npm-test-final.txt`. Standard review 1 launched on `4991a9e`.
- 2026-10-16 — Standard review 1 on `4991a9e`: PASS, 0 major, 1 minor, 3 notes. Minor: the reviewer-role test probed only the checkout and `/tmp`, not the home, `/var/tmp` or a runsDir sibling the ticket names. Fixed in `687a2c8` by adding those targets for both reviewer roles. Note: a failed `/tmp` removal left no trace. Fixed: `rm`'s error goes to stderr. Note: the bwrap leg of the main.ts test also passed if the reviewer never started. Fixed in `687a2c8` and `64514a0`: the bwrap leg asserts the reviewer's own `touch: ... Read-only file system`, and the `none` leg asserts its exit. Note: the reviewer's mutation checks each failed their test; its `npm test` matched; tree clean. Verdict: `/var/tmp/software_factory/08-d/standard-1.verdict.md`. Implementer-run `npm test` on the fixed tree: 215 tests, 191 pass, 19 skipped, 5 todo, 0 fail. Not independent. Budget: standard 1 of 2 used.
- 2026-10-16 — Adversarial review launched on `64514a0`. Unlike 08-c's, the reviewer gets `--add-dir` on its probe directory, so its file tools can write probes there.
