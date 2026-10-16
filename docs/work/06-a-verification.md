# 06-a — Controller runs the repository's checks on the candidate

Route: Design. Where the checks are declared, where they run and where the evidence lives are the seam 06-b (reviewers) and step 7 (the loop) read from.

Goal: a cycle in VERIFYING gets its declared checks run by the controller in a fresh checkout of the candidate SHA, the output and exit code of each stored against that SHA, and one `verification` event that moves it to STANDARD_REVIEW only when every check passed.

## Design note

### Seam

One module, `src/verify.ts`, mirroring `develop`: one function owns the checkout, the runs, the evidence and the event. Callers (step 7's loop, 06-b's prompt builder, the tests) learn one function and one directory layout.

```ts
export interface Check {
  /** Evidence file stem: [A-Za-z0-9_.-], unique within the job. */
  name: string;
  /** argv, run with the candidate checkout as cwd; no shell. */
  command: string[];
}

export interface VerifyOptions {
  /** Per check. A check still running at the deadline is killed and FAILs. */
  deadlineMs: number;
  /** Same directory `develop` used. Default /var/tmp/software_factory/runs. */
  runsDir?: string;
  /** `cgroup` (default) runs each check in a systemd user scope, as the adapters do. */
  isolation?: 'cgroup' | 'process-group';
  /** Per stream per check; over it the check FAILs with the output dropped. Default 8 MiB. */
  maxOutputBytes?: number;
}

export interface Verified {
  cycle: Cycle;
  /** `<runsDir>/<cycleId>-verify`, a detached checkout of the candidate head. Kept for 06-b. */
  worktree: string;
  /** `<runsDir>/evidence/<head>/`, one `<name>.stdout`, `<name>.stderr`, `<name>.exit` per check. */
  evidenceDir: string;
}

/** Run every declared check on the cycle's candidate and record one verification event. */
export function verify(store: EventStore, cycleId: string, job: Job, opts: VerifyOptions): Promise<Verified>;
```

`Job` gains `checks?: Check[]` (Q2). Behind `verify`, in order:

1. `store.load(cycleId)` must be in VERIFYING with a candidate; anything else throws (controller misuse, like `requireStage`). Check names are validated before anything touches disk.
2. A fresh detached worktree: `git -C repo worktree add --detach <runsDir>/<cycleId>-verify <head>`. If one is already there from an earlier verification of this cycle it is removed first (`git worktree remove --force`). This is how "checks ran independently of the developer" is met: nothing from the developer's working tree, only the commit (Q3).
3. Each check runs through `spawnRuntime` with the checkout as cwd, the deadline, the byte cap and a scope `sf-verify-<runId>`; checks run in order, all of them, so the evidence is complete even when the first fails. `exited` with code 0 is `PASS`; a non-zero exit, a kill at the deadline or an overflow is `FAIL`; a command that never started is `MISSING` (the spec's word for absent evidence).
4. Evidence: `<runsDir>/evidence/<head>/<name>.stdout`, `.stderr` and `.exit` (one line: `exit <code>`, `timeout`, `overflow`, or `missing: <reason>`). Files keyed by SHA, no store change (Q4). The `verification` event carries only name and result, the shape `lifecycle.ts` already has.
5. `store.append(cycleId, { type: 'verification', head, checks })` and return the replayed Cycle. An empty `checks` list still appends and the lifecycle escalates: missing evidence is never PASS.

### Alternatives

Declaration: (1) `Job.checks`, owner-supplied (chosen); (2) a file in the repository read at the candidate SHA, rejected because the developer edits that file; (3) the same file read at the base, deferred until a real repository needs it (O-005).

Location: (1) fresh detached worktree (chosen); (2) the cycle worktree after `git status --porcelain` is empty, rejected because ignored files and `node_modules` the developer left would still be there.

Evidence: (1) files under `runsDir` keyed by SHA (chosen); (2) a new store table, rejected as a schema change for data the controller never replays; (3) output inside the event, rejected because an 8 MiB stream does not belong in the log.

### Parked lines

| Line | How 06-a treats it |
| --- | --- |
| 05-a note, pre-existing commit as head; 05-b notes, symref branch, orphan merge, detached HEAD passing the head guard | Stay parked with a reason: each needs pi's unscoped bash, and developer runs are on scratch repositories only. The fresh checkout here verifies whatever the head is; it does not judge who made it. |
| 02-a note, busy timeout | Not touched: one process on the database. |
| 04-e minor, `.scope` suffix in a run ID | Not picked up: this ticket's only change to `cli-adapter.ts` is exporting `checkScopes`, and `verify` names its scopes `sf-verify-<uuid>`. Stays parked for the reconcile ticket (recorded after standard review 1). |

## Done when

- After a fixture `develop` reaches VERIFYING, `verify` with a check that passes in the checkout (`test -f done.txt`) leaves the cycle in STANDARD_REVIEW, `worktree` is a detached checkout of the head under `<runsDir>/<cycleId>-verify`, the developer's worktree and the repository are untouched, and the three evidence files exist under `<runsDir>/evidence/<head>/`; verified by `tests/verify.test.ts` offline.
- A check with a non-zero exit records `FAIL`, its stdout, stderr and `exit <code>`, and the cycle is ESCALATED; a check that never starts (unknown binary) records `MISSING`; a check still running at `deadlineMs` records `FAIL` with `timeout`; a check past `maxOutputBytes` records `FAIL` with `overflow`; every check runs even after a failure; verified by test.
- An untracked file written into the developer's worktree after the claim is not visible to a check: the checkout is fresh; verified by test.
- A stale `<cycleId>-verify` worktree is replaced, not reused; verified by test.
- No checks declared: the event is appended with zero checks and the cycle is ESCALATED; verified by test.
- `verify` on a cycle that is not in VERIFYING throws and appends nothing; a duplicate or invalid check name throws before any worktree is made; verified by test.
- `npm test` offline spawns neither `claude` nor `pi`; no new live tests.

Constraints: zero dependencies; `spawnRuntime` for the checks, `node:child_process` for Git, `node:fs` for the evidence. `lifecycle.ts`, `store.ts`, `controller.ts`, `adapter.ts` untouched. `develop` unchanged except the `checks` field on `Job`.
Non-goals: reviewer runs and the prompt builder (06-b); reading checks from the repository; deleting worktrees or evidence; the parked head-guard variants; the fix-run loop (step 7).
Verification: `npm test`, run by the owner on the reviewed SHA. `lazy-review` on the diff before the standard review.

## Log
- 2026-10-16 — A-028 "take all". Branch `feat/06-a-verification`.
- 2026-10-16 — tests first (`tests/verify.test.ts`, six tests, red without the module), then `src/verify.ts`; `Job.checks` added; `checkScopes` exported from `cli-adapter.ts`; the `git` helper moved from `developer.ts` to `src/git.ts` for both callers (lazy-review). Deviations from the design note: `VerifyOptions.graceMs` added so the timeout and overflow tests finish quickly; a stale `-verify` directory deleted by hand is pruned before the new checkout. Mutation checks on `37a1940` and `7b25bf6`, one replacement each, restored after: 14 run, all 14 fail a test. Implementer-run `npm test`: 135 tests, 114 pass, 16 skipped (live), 5 todo, 0 fail. Awaiting owner-run tests, then standard review 1.
- 2026-10-16 — owner-run on 5d1a34b: `npm test` 135 tests, 114 pass, 16 skipped, 5 todo, 0 fail. Standard review 1 launched on 5d1a34b.
- 2026-10-16 — Standard review 1 on 5d1a34b: PASS, 0 major, 4 minor (the 04-e `.scope` parked line not mentioned though `cli-adapter.ts` is touched; a later check can rewrite an earlier check's evidence files, same class as the sandbox line; `evidence/<head>/` never cleared so stale files from an earlier verification of the same SHA remain; every test used `process-group` so the default cgroup path was unexercised), 5 notes (`worktree remove --force` failure modes untested; empty evidence dir left if `worktree add` fails; "no shell" wording; the `git` helper move is a neutral refactor; branch HEAD two docs commits above the reviewed SHA). Reviewer ran the verify tests and two mutation checks, tree left clean. Fixed in 4b20fb5: the evidence directory for the head is removed and recreated after the checkout succeeds (also closes the empty-dir note), the first test runs with default cgroup isolation, the stale test asserts stale evidence is gone, the `Check.command` comment says verify adds no shell. Mutation check on 4b20fb5: removing the `rmSync` fails the stale test. Parked: the evidence-writable minor (parked.md, against 06-b or the sandbox ticket); the `.scope` line recorded in the parked-lines table as not picked up. Budget: standard 1 of 2 used. Awaiting owner-run tests on 4b20fb5, then the adversarial review.
- 2026-10-16 — owner-run on 4b20fb5: `npm test` 135 tests, 114 pass, 16 skipped, 5 todo, 0 fail. Adversarial review launched on 4b20fb5.
- 2026-10-16 — Adversarial review on 4b20fb5: FAIL. 1 major, reproduced by probe `/var/tmp/software_factory/06-a/probes/probe.ts` (P1): a symlink committed in the candidate (`mine -> ../<cycleId>`) is checked out by `git worktree add` and points at the developer's worktree, so a check reads untracked files the developer left after the claim and the same SHA verifies PASS or FAIL depending on files in no commit; needs a developer that can make a symlink (pi's unscoped bash; claude's `Write` and `git add` cannot). 2 minor: under the default `cgroup` isolation an unknown binary is `FAIL` with `exit 1` (systemd-run resolves the executable and exits 1), not `MISSING`, so the done-when holds only under `process-group`, which is what the test uses (P2); `git worktree add` runs the repository's `post-checkout` hook and `core.hooksPath` in the shared `.git/config` can name a committed path, so developer code runs as the controller at checkout, outside any scope (P5, pi only). 5 notes: a check that exits 0 leaving a child on its pipe spends the full deadline under `process-group` and 38 ms under `cgroup`; non-UTF-8 output is stored as U+FFFD; a plain directory at `<cycleId>-verify` makes `worktree remove` throw until the owner removes it (stop-and-ask, untested); the deadline holds against a `setsid` TERM-ignoring worker under `cgroup`; code identical to branch HEAD, `npm test` matched the owner, no stray processes or units. Budget: standard 1 of 2, adversarial 1 of 1; the cycle is stopped. Owner decides.
