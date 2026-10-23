# 11-f — Recover: resolve the runs a dead controller left

Route: Design. It adds an adapter method, a lock and a command, and has real alternatives (A-105, A-122). Tier: Trust (2 standard + 1 adversarial through `claude -p`, A-125): the controller, the runtime seam, the store, and candidate output read outside a sandbox.

Goal: `recover <job.json>` finds every started run with no outcome in the work's unsettled cycles and records it as received, failed or still running, without launching a run.

Design note: [2026-10-23-recover.md](../design/2026-10-23-recover.md).

Done when:
- A run that finished after its controller was SIGKILLed is received under its run ID: a reviewer's verdict moves the cycle as a live one would; a developer's claim passes `land` and the head lands on `sf/<cycleId>`. A second `recover` records nothing. Verified by test with a script runtime and a killed child controller, under both isolations.
- With `adopt: false`, the same finished run is `run_failed` and the cycle escalates. Verified by test.
- A running run is reported and left; the cycle is unchanged; with `--stop` the run ends and is `run_failed`. Verified by test under both isolations; under process-group isolation a `setsid` descendant holding `stdout` counts as running.
- A gone run (no `exit`, nothing holding it) is `run_failed` and the cycle escalates; at a commit stage the clone's branch tip is first pinned under `refs/sf-recovery/<runId>`. A claim with no run folder is gone (parked row 26). Verified by test.
- A cycle locked by a live process is skipped and its PID reported; a lock whose holder died, or whose PID was reused, is taken over. `run` and `drive` hold the lock while they drive. Verified by test.
- A cycle the store cannot replay is reported, and the others are still recovered. Cycles at a human stage, ESCALATED or settled are untouched. Verified by test.
- Recover clears `sf-*` units with no tasks: an active one is stopped, a failed one reset, including a scope stopped at its time limit; a unit with tasks is untouched (parked row 21). Verified by test under cgroup isolation.
- `adopt` is read from the personal and job layers, default true; the repository layer is refused. Verified by test in `tests/config.test.ts`.
- The process-group liveness probe (design note) is run before code and its result logged here.

Constraints: zero dependencies; Node built-ins, `systemctl`, `/proc`; no paid calls. Recover never launches a run and never spends budget.
Non-goals: `resume` and the job hash (11-f2); recover across every work in a `runsDir`; relaunching a crashed run; command stages outliving the controller.
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result.

## Log
- 2026-10-23 — drafted on `feat/11-f-recover` off main at `68110a5`. Owner: “Yes start 11-f”. Not READY until the owner answers the design note's questions and says go.
- 2026-10-23 — owner: “Take all your recommendations”. Recover records and never launches; `resume` is 11-f2. A running run is reported, `--stop` ends it. Process-group liveness by the processes holding the run's `stdout`, after a probe. `adopt` in the personal and job layers, default true. A cycle with no job hash resumes with a warning. Parked rows: 21 and 26 here; 48 and 51 in 11-f2; 30 to the next `verify.ts` ticket, 49 to row 12, 50 to the Owner tools row; 46 dropped (`docs/work/parked.md` updated). READY at Trust tier.
