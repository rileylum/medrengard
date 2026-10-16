# 05-b — A developer run cannot strand its cycle or write outside its worktree

Route: Fast. Fix ticket for 05-a's adversarial FAIL on `18421ff` (A-027). Internal, reversible, one obvious design per finding.

Goal: every failure in `develop` before the developer's claim leaves the work item free to run again, and the claude developer grant is exactly the ticket's list, inside the worktree, with nothing joined from the owner's settings.

Done when:
- `develop` with `deadlineMs: 0`, or with an adapter factory that throws, rejects and leaves no open cycle for the work: the next `develop` for the same work item opens and runs; no worktree is left when the factory throws; verified by test.
- `claudeDeveloper(worktree).args` has no `Bash(git log:*)` and no `Bash(git diff:*)`; it carries `--setting-sources project` so the owner's user and local settings (allow rules, hooks) do not join the grant; verified by test on the args, and by the existing live test still reaching VERIFYING under `RUNTIME_SPIKE=1`.
- `EventStore.open` without a parent, for a work item that already has an ESCALATED cycle, throws naming that cycle; with that cycle as the parent it opens; verified by test (the 05-a store test that asserted the opposite is changed).
- A relative `runsDir` is resolved against the process cwd before `mkdir`, `git worktree add` and the returned path, so the repository's working tree stays clean; verified by test.
- `receive` with an `accept` that returns a non-string truthy value records `run_failed` and does not throw; verified by test with `() => 42`.
- The non-empty-diff check reads `git diff --quiet` exit 1 as "changed" and any other non-zero exit as a refusal naming the exit code; verified by test with a head whose object is missing (a worktree whose `.git/objects` entry for the base is removed is enough), or by reading if that cannot be built reliably.
- The one-open-cycle test waits for the first adapter request instead of 100 ms; verified by reading.

Constraints: zero dependencies. `lifecycle.ts`, `adapter.ts` untouched. The 05-a interface (`develop`, `DeveloperAdapter`, `accept`) is unchanged.
Non-goals: a pre-existing commit reachable from the repository tip passing as the head when `job.base` is behind it (parked for step 6, which sees the commits that existed before the run); pi's unscoped bash (recorded limit in 05-a); worktree deletion.
Verification: `npm test`, run by the owner on the reviewed SHA; `RUNTIME_SPIKE=1 node --test tests/developer.test.ts` once, for the claude grant with `--setting-sources`.

## Log
- 2026-10-16 — owner: “option 1 go” (A-027). Branch `feat/05-b-contain-developer-run` stacked on 05-a at `73e0a92`.
