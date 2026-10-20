# sweep-cancel-aborts — `cancel` stops a run in flight

Route: Design. It adds a seam (`RunOptions.signal`) that row 11's recovery and any Ctrl-C handler will build on, and it picks polling over a cross-process notification.

Goal: when the owner cancels a cycle from another terminal, the developer or reviewer run in flight is aborted within about a second, not at its deadline.

Owner's instruction, 2026-10-20: "Once all this research comes back, triage it (merging similar things and organizing it, giving ratings for highest impact) - then create a worktree for each and spin up a sub agent to implement them. I want to come back tomorrow to a number of ready to merge branches, so we should only focus on the high quality and high impact ones. We will then work through them together, deciding if they should be merged or not, or if they need changes before going in - so you will need to explain each to me in plain english and defend the changes." This is the go to build the branch, not approval to merge. Triage item B4; sources: the 2026-10-20 sweep, finding 2, and the architecture report, finding 10.

Done when:
- A developer run that never ends, under a 20 s deadline, is cancelled from a second `EventStore` 0.3 s in. `run` returns well under the deadline (under 3 s after the cancel), the cycle is CANCELLED, the run's outcome is one `run_failed` with reason `cancelled`, and the child process is gone. Verified by test (`tests/run.test.ts`).
- The same for a reviewer run. Verified by test.
- `RunOptions.signal`, when aborted, ends the run in flight the same way: one `run_failed` with reason `cancelled`, which escalates a cycle that is not settled. Verified by test.
- The watch timer never keeps the process alive and is cleared on every exit path: outcome, deadline, settled cycle, signal. Verified by reading (`unref`, and one `finish` that clears both timers), and by `npm test` exiting on its own.

Constraints: zero dependencies; no paid calls. The abort goes through the existing path (`bounded` in `src/controller.ts`, then the adapter's own process-group or scope kill). `apply` is unchanged: the late `run_failed` on a CANCELLED cycle is ignored (SC-19).
Non-goals: a Ctrl-C (SIGINT) handler, and what Ctrl-C should mean (escalate, or leave the cycle to resume): the owner's row-11 call. Aborting a check (command stage) in flight: checks are not paid, and they still run to their end or deadline.
Verification: `npm test`, run by the implementer (not independent); the owner reviews.

## For the owner

**What was wrong.** `node src/main.ts cancel job.json` records CANCELLED in the store. But the process running the job never looks at the store while a CLI run is in flight. It looks only between steps. So a paid `claude` or `pi` run kept going until it finished or hit its deadline. With `deadlineMs: 900000` that is up to 15 minutes of paid work whose result is then thrown away.

**Reproduction.** The sweep's probe (`/var/tmp/software_factory/research-2026-10-20/sweep/probes/cancel-abort.test.ts`): a developer that never ends, a 4 s deadline, a cancel from a second store at 0.5 s. `run` returned after 4045 ms, aborted by the deadline, not by the cancel.

**What the change does.** While a run is in flight, `execute` in `src/controller.ts` reloads the cycle from the store once a second. If the cycle has settled (CANCELLED, ESCALATED or ACCEPTED), it aborts the run through the same path the deadline uses. The adapter then kills the CLI's process group, or its systemd scope. The outcome is recorded as `run_failed` with reason `cancelled`, the way an aborted run is recorded today; `apply` ignores it on a settled cycle. The run's options also take an optional `signal` (an `AbortSignal`). Aborting it ends the run in flight the same way. Nothing sets it yet: it is the hook a Ctrl-C handler would use in row 11.

**Why polling the store, not a notification.** Two alternatives were weighed.
1. *Poll the store* (chosen). The store is already the one place `cancel` writes, so nothing new must be written or cleaned up. A reload replays the cycle's events and costs about 0.07 ms, so once a second is free. The cost is up to one second between the cancel and the abort. It works for any writer of the store, not only `main.ts cancel`.
2. *A cross-process notification*: `cancel` also touches a file (for example `<runsDir>/<cycleId>.cancel`) that the run watches with `fs.watch`, or the run follows the observation stream (`events --follow`). This reacts in milliseconds. But it adds a second channel that can disagree with the store: a cancel written by another tool, or a file left behind by a crash, would be missed or acted on wrongly. `fs.watch` is also unreliable on some file systems. The stream is itself a poll of the same store, so it gains nothing over option 1.

**Why a signal on the options, and what it does not decide.** The architecture report suggested `RunOptions.signal` as the seam for row 11. It costs one field passed through `develop`, `fix` and `review` to `execute`. With it, a Ctrl-C handler can end a run with a recorded outcome instead of leaving it stranded. What it records is `run_failed: cancelled`, which escalates a cycle that is not settled. A handler that wants the cycle left to resume would not use the signal at all. So the signal does not decide Ctrl-C semantics; the owner does, in row 11.

**Risks and what it does not cover.**
- `run` returns as soon as the abort fires, as it does at a deadline. The adapter kills the child in the background: SIGTERM, then SIGKILL after its grace period (5 s), or the whole scope under `cgroup` isolation. The process stays alive until that kill is done.
- A check (command stage) in flight is not aborted. Checks cost no money and are bounded by the deadline.
- A cancel recorded between two steps was already honoured; that is unchanged.
- If the store cannot be read during a poll, the poll skips that tick. The store's failure surfaces when the outcome is recorded.

**Decision for the owner.** Whether `RunOptions.signal` should be added now, or left for row 11. It is three small edits and one test; dropping it leaves the store poll working alone.

## Log
- 2026-10-20 — ticket written from triage item B4 on the owner's go above; branch `feat/sweep-cancel-aborts` from `a3c74ff`.
- 2026-10-20 — tests first in `tests/run.test.ts`. Red on unchanged code: "run returned 19979 ms after the cancel; the deadline is 20 s" (developer), "19986 ms" (standard reviewer), and "run waited for the deadline" (`RunOptions.signal`). Implemented in `548e195`: `execute` passes `bounded` a `settled()` check and the caller's signal; `bounded` polls once a second (timer `unref`'d), and one `finish` clears the deadline, the poll and the signal listener on every exit. `signal` is passed through `develop`, `fix` and `review`. Spec: one Driver bullet. Guide: one paragraph on `learn/controller.html`'s deadline slide; no shim mirrors `bounded`, so `learn/shims/*` are unchanged (the shims' `execute` calls pass no signal, which keeps today's behaviour). Mutants, each caught: the signal dropped from `develop`, from `fix`, from `review`; the poll's cancel removed; `ac.abort()` removed from `stop` (the CLI survives; the test file then never exits, because the live child holds it, so the mutant was ended by killing the two fixture children); the cancel recorded as `timeout`. `npm test`, implementer's run, not independent: 424 tests, 400 pass, 0 fail, 19 skipped, 5 todo. `npm run test:learn`: 6 pass. Lazy review: nothing to cut; the signal seam is in the ticket on purpose, and its `removeEventListener` gained a comment (a job-long signal would collect a listener per run).
- Next: owner to read "For the owner", decide whether to keep `RunOptions.signal`, and run or waive the reviews.
