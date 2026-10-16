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
