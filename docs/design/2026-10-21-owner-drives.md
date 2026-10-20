Branch: feat/11-a2-owner-drives

# An owner command drives the cycle on (ticket 11-a2)

## Problem

`accept` records its event and returns (`src/main.ts`, `src/decide.ts`). When a workflow puts a stage the loop runs after a human stage, such as a grant stage that merges or deploys, nothing ever runs it: the cycle waits at that stage with no command to continue it (10-e reviewer note). A-129 decides that an owner command records its event, then drives the cycle until it stops. 11-d adds five more owner moves (retry, overrule, fix, accept with risk, route) that need the same rule.

Facts the design must respect:
- `apply` is pure. `apply(cycle, event, w).stage` is the stage an event leads to, known before anything is written.
- `drive` (`src/run.ts`) runs `preflight` before its loop, outside the loop's `try`. A throw there leaves the cycle where it is, with no `reject_dispatch`.
- `preflight` needs adapters for every agent role, the sandbox, the grants and the job's checks. Building adapters reads each runtime's module (A-075). Today `accept` reads none of this, and with the default workflow it must not start to: accept then lands on ACCEPTED, which no step acts on.
- The grant stage's head gate already counts an `accept` on the candidate head as that stage's last outcome (`headGate`, `src/verify.ts`).
- No command continues a stranded cycle until 11-f (A-105 item 1, A-129). A cycle left at a stage the loop runs, with nothing running, is stranded.

## Interface

```ts
// src/run.ts
/** What drive needs, built only when an owner's event leads to a stage the loop runs. */
export interface Drivable { adapters: Adapters; job: Job; opts: RunOptions }

/**
 * Record an owner's event on a cycle, then drive it on. When the event leads to a stage the loop
 * runs, `ready()` is called and preflight runs before the event is recorded, so a refusal writes
 * nothing. Otherwise the event is recorded and the cycle returned, with `ready` never called.
 */
export async function decideAndDrive(store: EventStore, cycleId: string, event: Event, ready: () => Promise<Drivable>): Promise<{ cycle: Cycle; driven?: RunResult }>
```

- `acceptCycle` (`src/decide.ts`) keeps its refusals, and gains a twin that returns the event instead of recording it, so `main.ts` can pass it to `decideAndDrive`. `cancelWork` is unchanged: a cancel settles the cycle, so there is nothing to drive.
- `main.ts accept` builds `ready` from the config it already loads (`decisionConfig`): the adapters as the run command builds them, the job from the job file, and `deadlineMs`, `runsDir`, `sandbox`, `workflowDir` and `grants`.
- Output. When nothing was driven, `accept` prints what it prints today, and its exit codes stay. When the cycle was driven, it prints the run command's report (stage, cycle, head, verdicts, escalation, error), then the merge lines if the cycle is ACCEPTED. Exit 0 when the cycle ends ACCEPTED or at a human stage, 1 otherwise, 2 on a refusal.

## Alternatives

1. **`accept` records and returns; a `resume` command continues the cycle.** Rejected: one decision takes two commands, and the `resume` command waits for 11-f, because today it would rerun a stage whose run had started (A-105 item 1).
2. **Record, then call `drive` as it is.** Rejected: a missing grant or an unstartable sandbox fails in `preflight` after the accept is written, and the cycle is stranded at the grant stage until 11-f.
3. **Preflight inside `acceptCycle`.** Rejected: `decide.ts` would need adapters and the sandbox, and every caller of the plain rules would pay for building them.

## Not decided here

- A crash or Ctrl-C while the driven stage runs strands the cycle, as it does for `run` today. 11-f's `recover` reruns a command stage (A-105 item 3).
- The job file's ticket and checks are read again at accept, not taken from the cycle's open row. A-105 item 2 (refuse a changed job) is built with replay (11-c) and recovery (11-f).
- Which command sends `request_changes` stays open (HANDOFF); when one does, it uses `decideAndDrive`.
