# 11-e — Runs outlive the controller, and every run records its start

Route: Design. It moves where a run's output and exit code live, adds an event, and has real alternatives (A-122, A-105 item 3). Tier: Trust (2 standard + 1 adversarial through `claude -p`, A-125): the controller, the runtime seam, and candidate output read outside a sandbox.

Goal: a run's stdin, stdout, stderr and exit code live in its own run folder, kept by a supervisor that is not the controller, and every reviewer run is recorded before it starts, so `recover` (11-f) can find what a run left.

Design note: [2026-10-22-runs-outlive.md](../design/2026-10-22-runs-outlive.md).

Done when:
- A run started through `cliAdapter` leaves `<runsDir>/runs/<runId>/` holding `stdin`, `stdout`, `stderr` and `exit`, and no pipe joins the controller and the run. Verified by test with a script runtime.
- A controller process SIGKILLed mid-run leaves the run going; the run finishes and its folder holds its output and exit code; `readRun` on the folder gives what a live controller would have parsed. Verified by test that kills a child node process.
- Under cgroup isolation, a run whose controller is dead stops at its deadline plus grace. Verified by test.
- An output past `maxOutputBytes` stops the run and is `overflow`, live; `readRun` on a folder whose file is past the cap returns `overflow` without reading the whole file. Verified by test.
- `exit` is either absent or holds the whole status: the wrapper writes it by rename. A sandboxed run cannot write in its run folder. Verified by test (a developer script that tries `../runs/<runId>/exit`).
- A reviewer run records `run_started` with its run ID and runtime before the adapter starts; a cycle that no longer takes the run launches nothing. Verified by test, and by a mutant that appends after `start`.
- `apply`: `run_started` in a verdict stage adds the run to `cycle.runs` and keeps the stage; anywhere else it escalates; in ESCALATED or a settled stage it is ignored, as other events are. Verified by test.
- Stores written before 11-e load and replay to the same stages. Verified by the existing fixture tests.
- The existing cancel, scope and overflow tests in `tests/runtime.test.ts` and `tests/cli-adapter.test.ts` pass, changed only where they read a pipe.
- Parked lines, if the owner agrees (design note, question 4): a run ID ending in `.<unit type>` is refused; `spawn.ts` says "fork"; the `checkScopes` error names the `systemd-run --user --scope` workaround when this process is in a session scope. Each verified by test, except the comment.

Constraints: zero dependencies; Node built-ins, `sh`, `systemd-run`; no paid calls. The run folder is never bound into a sandbox.
Non-goals: `recover`, adoption, the "never adopt" setting, stopping a run whose controller died (11-f); liveness under process-group isolation; streaming and usage parsing (Run records row); command stages outliving the controller.
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result.

## Log
- 2026-10-22 — drafted on `feat/11-e-runs-outlive` off main at `6c0fb0a`. Owner chose 11-e as the next ticket: "Yes". Probes before the draft (scratch in `/tmp`, deleted): a scoped run outlives its SIGKILLed controller and a wrapper writes its exit code; `RuntimeMaxSec` stops a scope; a transient service keeps a failed exit status, and one that exits 0 only with `RemainAfterExit=yes`. Not READY until the owner answers the design note's questions and says go.
