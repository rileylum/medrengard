Branch: feat/11-e-runs-outlive

# Runs that outlive the controller (ticket 11-e)

## Problem

A run's output reaches the controller only through pipes (`src/runtime/spawn.ts`, `spawnRuntime`). The child is spawned `detached` into its own scope, so a controller killed by SIGKILL or Ctrl-C leaves the run going, but it writes into a pipe nobody reads: the claim, the exit code and the paid tokens are lost. A-122 decides that a run's output and exit code go to files kept by a supervisor that is not the controller, so `recover` (11-f) can watch, receive or escalate it. A-105 item 3 decides that every run, reviewers included, records `run_started`; today only a developer run is recorded before it starts (its `claim`), and a reviewer's run ID first appears with its verdict.

Facts the design must respect, probed on this machine on 2026-10-22 (systemd user manager, cgroup v2):
- A `systemd-run --user --scope` run spawned `detached` with its stdout on a file kept running after the node process that started it was SIGKILLed, and a wrapper inside the scope wrote the command's exit code to a file (`out=done exit=5`).
- `-p RuntimeMaxSec=2` on a `--scope` kills the scope at 2 s; `systemctl --user show` reports `Result=timeout`. So a deadline can hold with no controller.
- A transient service (`systemd-run --user --unit=…`, no `--scope`) keeps `ExecMainStatus` after a failing exit until `reset-failed`; one that exits 0 is unloaded at once unless `RemainAfterExit=yes`. This answers A-122's "unverified".
- bwrap runs with `--die-with-parent`; its parent is whatever spawns it inside the scope, not the controller.
- Every adapter the registry builds is a `cliAdapter`: claude, pi and extension runtimes. Test doubles are in-process adapters and cannot outlive anything.

## Interface

```ts
// src/layout.ts
/** <runsDir>/runs/<runId>/: what a run left. Not bound into any sandbox. */
export const runDir: (runsDir: string | undefined, runId: string) => string;

// src/adapter.ts: set by the controller; neither is sent to an extension runtime
interface RunRequest { /* … */ runDir?: string; deadlineMs?: number }

// src/lifecycle.ts
| { type: 'run_started'; runId: string; runtime: string }

// src/runtime/spawn.ts
interface SpawnOptions { /* … */ dir?: string; maxRuntimeMs?: number }
export const runFiles: (dir: string) => { stdin: string; stdout: string; stderr: string; exit: string };
/** What a run folder says now. The same reader serves a live run and, in 11-f, a run whose controller died. */
export function readRun(dir: string, maxOutputBytes?: number): RunResult | undefined;  // undefined: no exit file yet
```

- **The folder.** `execute` mints the run ID, records the start, and passes `runDir` and its deadline on the request; `spawnRuntime` creates the folder (refusing one that exists) and writes the prompt (or the extension's request JSON) to `stdin`. A `cliAdapter` called with no `runDir` (a test, a kit) runs over pipes as before; every run the controller starts has one. Command stages call `spawnRuntime` with no folder. The child's stdin, stdout and stderr are those files, opened by the controller and passed as file descriptors: no pipe stays between the controller and the run.
- **The supervisor.** A fixed `sh` wrapper inside today's scope, outside bwrap: it runs the command, then writes its exit status to `exit.tmp` and renames it to `exit`, so `exit` is either absent or whole. A signal death is written as `128+n`, as the shell reports it. Then it SIGKILLs its own process group, so what the command left in the group dies with the run under process-group isolation too, as a scope's `cgroup.kill` does under cgroup isolation (standard 2); the live result takes its exit code from `exit`. The sandboxed CLI cannot reach the folder: no path in it is bound, and `stdin` is created read-only (0400), since the run can reopen its fd 0 through `/proc/self/fd/0` (standard 2).
- **The deadline.** Under cgroup isolation the scope gets `-p RuntimeMaxSec=<deadline + grace>` and `-p TimeoutStopSec=<grace>`, so a run with no controller still stops, and the wrapper writes `143` for it. The live controller keeps its own deadline as today; systemd's is the backstop.
- **One reader.** The live adapter waits for its child to exit, then calls `readRun` and parses what it returns with the spec's `parse`, as `outcome` does today. 11-f calls the same reader on a run whose controller died, so a received run and an adopted one go through the same code.
- **The byte cap.** A pipe cannot be capped any more, so `spawnRuntime` checks the two files' sizes on a timer (100 ms) and stops the run past `maxOutputBytes`, recording `overflow` as today. `readRun` never reads more than the cap, so a run that wrote past it while no controller watched is an overflow too, not a large string.
- **`run_started`.** `execute` appends `{ type: 'run_started', runId, runtime }` before a reviewer run starts, where it now only calls `requireStage`. `apply` accepts it in an agent stage that produces a verdict, adds the run to `cycle.runs` with its role and runtime, and does not change the stage. Anywhere else it escalates, as a claim outside a commit stage does. If `apply` did not take the run (the cycle was cancelled meanwhile), nothing is launched. A developer's `claim` stays its start record.
- **Folders are kept.** A run folder is not deleted after the run: it is the raw output the Run records row wants. The owner clears `runsDir` as today. The run's `/tmp` is still removed after a live run.

## Alternatives

1. **A transient service per run instead of a wrapper.** systemd keeps a failed exit status, and liveness is one `systemctl` call. Rejected for now: a run that exits 0 needs `RemainAfterExit=yes` and an explicit stop afterwards, the service does not inherit the controller's environment (claude and pi read `PATH`, `HOME` and their auth from it), and the kill path moves from `cgroup.kill` on a known path to `systemctl stop`, which every 03-b and 04-e test would have to prove again. It would also take runs out of the SSH session's scope (the parked 11-d2 finding), which the wrapper does not fix.
2. **Pipes as today, with the controller copying each byte to a file as it arrives.** Rejected: the copy stops when the controller dies, which is the case this ticket exists for.
3. **`run_started` for every run, the developer's included, after its claim.** Rejected as a duplicate: the claim already records the run, its runtime and its base before launch, and `recover` can read either.

## Threat model

- New state the controller reads outside a sandbox: `stdout`, `stderr` and `exit` in the run folder. `stdout` and `stderr` carry what the pipes carried; `readRun` caps them at the same size. `exit` is written by the wrapper, outside bwrap; no sandbox binds the folder, so a run cannot forge it.
- A run can reopen its own stdout and stderr through `/proc/self/fd/1` and `2` and rewrite them. It could already write anything to them. Its `stdin` is read-only, so the kept prompt stays what the controller sent.
- A run with no controller now runs until its deadline (cgroup) or its end (process group). Before, it ran the same way, but its output was lost.
- A reviewer run in `cycle.runs`: the `claim` rule "developer run already active" counts unconsumed runs, so a reviewer run that started and never ended would block a later claim until it is consumed. Today's paths consume every run (verdict, `run_failed`, a settled cycle); 11-f consumes one whose controller died.

## Questions for the owner

1. Supervisor: the `sh` wrapper in today's scope (recommended), or a transient service (alternative 1)?
2. `run_started` for reviewer runs only, with the developer's claim as its start (recommended), or for every run (alternative 3)?
3. A verdict from a run with no `run_started`: applied as today (recommended: old logs replay unchanged and `ENGINE_VERSION` stays 1), or escalated as "verdict from unknown run", which needs `ENGINE_VERSION` 2 and leaves cycles opened before it to the replay check?
4. Pick up these parked lines, which name the next ticket to touch `spawn.ts` or `cli-adapter.ts` (recommended: all three): 04-e's run ID ending in `.<unit type>`; 04-e's "exec" comment that should say "fork"; 11-d2's SSH session scope, as an error that names the `systemd-run --user --scope` workaround.

## Not decided here

- Sorting a started run into running, finished and gone, receiving it under its run ID, the "never adopt" setting, and stopping a run: 11-f.
- Liveness under process-group isolation: the folder and `exit` are written, but nothing tells a running run from a dead one. 11-f treats a run with no `exit` there as gone, or the owner decides otherwise then.
- Streaming the output as it arrives and parsing usage and cost: the Run records row (A-116); it writes into the same folder.
- Command stages and their `sf-verify-*` scopes: recovery reruns a command stage (A-105 item 3), so they need not outlive the controller.
