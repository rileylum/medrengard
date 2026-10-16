# 04-d — Real claude and pi adapters

Route: Design. Fixes the seam between `spawnRuntime` and `Adapter`; the cgroup decision and the claim format are both real alternatives.

Goal: `execute` can run a real `claude -p` or `pi -p` through an `Adapter` built on `spawnRuntime`, and a cancel or deadline stops the whole process tree, including descendants that leave the process group.

## Design note

### Seam

One module, `src/runtime/cli-adapter.ts`, builds an `Adapter` from a `CliSpec`. Two specs live in it: `claude` and `pi`. The spec is the only thing that varies; everything else (spawn, isolation, byte cap, abort, outcome mapping) is shared.

```ts
export interface CliSpec {
  name: 'claude' | 'pi';
  command: string;                     // binary; default is the name
  args: string[];                      // 03-a flags; the caller may replace them (tools on, model, etc.)
  /** Turn the finished child into an outcome. Only called for status `exited`. */
  parse(stdout: string, stderr: string, exitCode: number | null): RunOutcome;
}

export interface CliAdapterOptions {
  isolation?: 'cgroup' | 'process-group';   // default 'cgroup'
  maxOutputBytes?: number;                  // default 8 MiB, stdout and stderr each
  graceMs?: number;                         // SIGTERM to SIGKILL / cgroup.kill, default 5000
}

export function cliAdapter(spec: CliSpec, opts?: CliAdapterOptions): Adapter;
export const claude: CliSpec;
export const pi: CliSpec;
```

Behaviour behind `start(req, signal)`: spawn `spec.command spec.args` in `req.cwd` with `req.prompt` on stdin, under the isolation mode; wire `signal` to `run.cancel()`; map the `RunResult`:

| `RunResult.status` | `RunOutcome` |
| --- | --- |
| `cancelled` | `{ status: 'cancelled' }` |
| `failed` (never started) | `{ status: 'failed', reason: stderr }` |
| `overflow` (new, see below) | `{ status: 'failed', reason: 'stdout exceeded N bytes' }` |
| `exited` | `spec.parse(stdout, stderr, exitCode)` |

`parse` never throws; a parser error is `failed` with the error text. Reasons are cut at 1 KB so a reason cannot itself be the size problem.

**Claim format.** The prompt asks the runtime to end its reply with one fenced block, ` ```json { ... } ``` `, holding the claim (`{ head, artifacts }`) or verdict (`{ head, verdict, findings }`). `parse` takes the last fenced `json` block in the reply text and `JSON.parse`s it as `claim`; the controller validates it through `append` as today. No block, or a block that does not parse, is `failed` with reason `no claim block in reply` or `claim block is not JSON`. The adapter does not check the fields; that is the store's job.

**claude parser.** Stdout is one JSON object. Not an object: `failed`, reason `stdout is not a JSON result` plus the first line of stderr. `is_error: true`: `failed`, reason is `result` (the human sentence) with `api_error_status` if present. Otherwise reply text is `result`, `sessionId` is `session_id`. Exit code is informational; `is_error` is the flag (03-a).

**pi parser.** Stdout is JSON Lines. Lines that do not parse are skipped. `sessionId` is `id` from the `session` line. Completion is an `agent_end` line; without one, `failed` with reason from the first stderr line (`Model "x" not found`, `No API key found`) or `run ended without agent_end`. Reply text is the concatenated `content[].text` of the last `turn_end.message`.

**Isolation** (03-b major). `spawnRuntime` grows `isolation: 'cgroup' | 'process-group'`. In `cgroup` mode the command is `systemd-run --user --scope -q --unit=sf-<runId> -- <command> <args>`; `systemd-run --scope` execs the command in the calling process, so `child.pid` is the command and `/proc/<pid>/cgroup` names the scope. Cancel is SIGTERM to the process group as today, then after `graceMs` a write of `1` to `/sys/fs/cgroup<scope>/cgroup.kill`, which kills every process in the scope regardless of session or group. `exit` of the child also triggers `cgroup.kill` so a self-re-parenting child cannot leave a worker behind and be reported `exited`. The scope path is read once, right after spawn, before anything can escape. Probed 2026-10-16 on this machine: unprivileged, `cgroup.kill` mode `--w-------` owned by the user, a `setsid` grandchild died. The unit name `sf-<runId>` is also what a later reconcile ticket lists and stops (`systemctl --user list-units 'sf-*'`), which answers "detached runtimes outlive a dead controller" without code here.

Without systemd: `cliAdapter` with `isolation: 'cgroup'` throws at construction if `systemd-run --user --scope -q -- true` does not exit 0, so the failure is at startup and names the fix. `process-group` is the explicit opt-out for such a machine and carries the 03-b limit.

**Size bound** (04-c major). `spawnRuntime` grows `maxOutputBytes`. Counted per stream in bytes (`Buffer.byteLength` of each chunk). Crossing it cancels the tree the same way as `cancel()` and resolves `status: 'overflow'` with the collected output dropped, so the result can never approach V8's string cap and the controller's `plain()` never sees a large outcome. Default 8 MiB: a pi run with full system prompts per event was 26 KB; 8 MiB is three hundred times that and a thousandth of the cap. `plain()` in the controller is unchanged; the bound at the read is the fix the parked line asks for, and a second limit there would be a second place to tune.

**03-b minors.** In `spawn.ts`: `cancel()` after resolve is a no-op (settled flag; today it SIGKILLs a possibly reused pgid); an empty `command` resolves `failed` with `command is empty` instead of throwing synchronously; cwd is checked with `accessSync(cwd, R_OK | X_OK)` so EACCES is reported against the cwd, not the binary; `ready` resolves on the first byte of either stream.

**`Adapter.name`.** No reader. The spec's Run record carries `runtime`, which the controller loop (step 5) will record when it opens cycles from non-test code. Recommendation: drop the field now and reinstate it with the reader. Alternative: keep it and have `execute` ignore it, as today.

### Alternatives

Isolation:
1. **cgroup via `systemd-run --user --scope`** (chosen). Kills by membership, not by lineage; unprivileged on this machine; one extra argv prefix; the unit name doubles as the reconcile handle. Cost: a hard dependency on a user systemd for the default mode.
2. **PID namespace** (`unshare --pid --fork --kill-child`). Kills everything on exit of the init; needs user namespaces and makes the runtime pid 1 of its namespace, which changes how it reaps children and reads `/proc`. Rejected: more surface than the problem.
3. **pid tracking** (walk `/proc/*/stat` for descendants at cancel). No dependencies, but a double fork plus `setsid` between two reads escapes it, which is the exact finding. Rejected: does not close the finding.

Seam for isolation:
1. **Inside `spawnRuntime`** (chosen). Cancel, grace and the exit race already live there; the adapter stays a command and a parser, and the runtime tests cover the kill once for both CLIs.
2. **A wrapper in the adapter** that prefixes `systemd-run` and does its own `cgroup.kill`. Leaves `spawn.ts` untouched but splits cancel across two files and repeats it per adapter. Rejected.

Claim format:
1. **Fenced `json` block, last in the reply** (chosen). Works for both runtimes with no flags; the model can explain and then claim.
2. **Whole reply is JSON** (claude `--json-schema` style structured output). Cleaner parse, but pi has no equivalent and a reviewer's findings read better as prose plus a block. Rejected for now; the parser takes a block, so a whole-reply JSON object is also a valid "block" if a later ticket wants it.

### Parked lines

| Line | How 04-d covers it |
| --- | --- |
| 03-b major, process-tree escape | `isolation: 'cgroup'` in `spawnRuntime`; test: a fixture that `setsid`s a grandchild which writes a file after 2 s, cancelled under cgroup mode, file never appears; a fixture that `exec setsid`s itself is killed on exit. Skipped with reason where `systemd-run --user` is unavailable |
| 03-b minor, `cancel()` after resolve | settled flag; test: `cancel()` twice after resolve does not call `process.kill` (observed via a spy on `process.kill`) |
| 03-b minor, unreadable cwd and empty command | `accessSync`; empty command resolves `failed`; tests with a `chmod 000` dir and `command: ''` |
| 03-b minor, `ready` on stderr-only child | `ready` on first byte of either stream; test with a stderr-only fixture |
| 03-b minor, `detached` outlives a dead controller | Named scope `sf-<runId>`; the stop belongs to the reconcile ticket, which now has a handle. Not tested here |
| 04-c major, size bound | `maxOutputBytes` in `spawnRuntime`, `overflow` status, adapter maps to `failed`; test with a fixture that writes past a 64 KB cap, resolves within the grace bound, and `execute` escalates with the reason |

Done when:
- `cliAdapter(claude)` and `cliAdapter(pi)` against fixture CLIs under `tests/fixtures/` that replay the 03-a shapes (ping with a claim block, `is_error` result, model-not-found on stderr, no-auth, no claim block) produce the outcomes in the tables above; verified by `tests/cli-adapter.test.ts` through `start()` and through `execute` with `store.load()`, offline.
- Cancel through `execute`'s abort kills a `setsid` grandchild under `isolation: 'cgroup'` and reports `cancelled`; a child that re-parents itself does not leave a worker running; verified by `tests/runtime.test.ts`, skipped with reason without a user systemd.
- `cliAdapter(x, { isolation: 'cgroup' })` throws at construction when `systemd-run --user` is unavailable; verified with `PATH` emptied.
- Output past `maxOutputBytes` resolves `overflow` inside `graceMs` plus one second and `execute` escalates with a reason naming the cap; verified by test with a 64 KB cap.
- The four 03-b minors above each have a test that fails on `main`'s `spawn.ts`.
- `RUNTIME_SPIKE=1 npm test` runs one ping per real adapter through `execute` and gets a `completed` outcome with the claim from the block, and one bad-model run per adapter that is `failed` with the model named; four live runs, each with a 60 s deadline.
- `npm test` offline has no new skipped tests beyond the live ones, and nothing under `tests/` spawns `claude` or `pi` without `RUNTIME_SPIKE=1`.

Constraints: zero dependencies; `node:child_process`, `node:fs` for the cgroup files, `spawnRuntime`. The `Adapter` and `RunOutcome` types are unchanged apart from the `name` decision. `controller.ts` is not touched. Tools stay off in every test; which tools a developer run gets, and how permissions are granted, is step 5.
Non-goals: prompt assembly, reconcile and stopping orphaned scopes, retries, streaming, the controller loop that opens cycles, the 02-b `open` guards, the 02-a store notes.
Verification: `npm test` and `RUNTIME_SPIKE=1 npm test`, run by the owner on the reviewed SHA. `lazy-review` on the diff before the standard review.

## Log
- 2026-10-16 — branch `feat/04-d-real-adapters` off main at `212f711`. Plan rows 3 and 4 marked done, STATUS next action updated (`4e89815`). Ticket drafted on the Design route; awaiting owner read and go.
- 2026-10-16 — owner: “go with all recommendations” (A-024). READY.
- 2026-10-16 — tests first (`tests/cli-adapter.test.ts`, seven new cases in `tests/runtime.test.ts`, fixtures `fake-cli.ts`, `escape.ts`, `flood.ts`; the flood test hangs on main's `spawn.ts`, the rest are red), then `src/runtime/cli-adapter.ts`, `spawn.ts` changes, `Adapter.name` dropped. Two deviations from the note: `spawnRuntime` takes `scope?: string` (the unit name) rather than an `isolation` enum, since the name is the only thing it needs; and the scope path is not read from `/proc/<pid>/cgroup` but computed, because a child that exits within milliseconds (the `exec setsid` case) was reaped before any poll found it. `systemd-run --slice-inherit` puts the scope beside the controller's own cgroup, so the path is `dirname(own cgroup)/sf-<runId>.scope` before the child runs; the first mutation check below covers it. Mutation-checked, one test file each, all fail when removed: `--slice-inherit`, the exit-time `cgroup.kill`, the settled guard in `cancel()`, dropping stdout on overflow, the cwd `accessSync`, pi's stderr-first reason, last-block-wins, claude's `is_error` branch, the construction probe. Lazy-review: three cuts applied (`f543b70`). Implementer-run: `npm test` 102 tests, 83 pass, 14 skipped (10 live from 03-a, 4 live here), 5 todo, 0 fail. Awaiting owner-run tests, then standard review 1.
- 2026-10-16 — owner-run on 93ab46e: `npm test` 102 tests, 83 pass, 14 skipped, 5 todo, 0 fail; `RUNTIME_SPIKE=1 npm test` 97 pass, 0 skipped, 0 fail (all four live adapter runs completed). Standard review 1 on 93ab46e: PASS, 0 major, 5 minor, 4 notes. Minors: the construction probe proved `systemd-run` runs but not that the computed `cgroup.kill` path is right and writable; no end-to-end test of `execute`'s deadline killing a `setsid` grandchild; the scoped exit path SIGKILLed a reaped pgid; the overflow test bound was looser than the done-when; STATUS stale. Notes: `dropPipes()` on every scoped exit relies on libuv reading the pipe before SIGCHLD and could cut the tail off a result; the fence regex required a newline before the closing fence; `parse` relies on the controller for throws; a stale `sf-<runId>.scope` makes systemd-run exit 1, which escalates (reconcile ticket). All five minors and the first two notes fixed in `611c1c9`: the probe runs a throwaway scope with `--slice-inherit` and checks from inside it that the path `scopePath()` computes is the real one and `cgroup.kill` is writable (mutation: wrong path or unwritable file each fail the construction test); on a scoped exit only `cgroup.kill` is written, the group is not signalled, and the pipes drain on their own; new tests: `execute` with a 500 ms deadline over the escape fixture under a scope, marker never appears; a scoped child that writes 1 MiB and exits loses nothing (the pipe-drop mutation did not fail this test in twelve probe runs either, so it is a smoke test; the change stands on Node's documented `exit`-before-stdio-close ordering, not on a reproduction). Implementer-run: `npm test` 104 tests, 85 pass, 14 skipped, 5 todo, 0 fail. Review budget: standard 1 of 2 used. Awaiting owner-run tests on the fix SHA, then adversarial review.
- 2026-10-16 — owner-run on 5347806: `npm test` 104 tests, 85 pass, 14 skipped, 5 todo, 0 fail. Adversarial on 5347806: FAIL, 1 major, 4 minor, 6 notes. Major, reproduced by the reviewer and the implementer: the claim-block regex backtracks catastrophically on a reply that opens a ```json fence and is followed by blank lines with no closing fence (2000 newlines: 3.6 s; 5000: 54 s); `parse` runs in the controller's process, so the event loop is held and the deadline cannot fire, and the 8 MiB bound does not help. Reachable from a real model reply. Fix: a linear scan (`lastIndexOf`/`indexOf`) and a test with thousands of blank lines after an open fence. Minors: `sf-<runId>` is not validated as a unit name, so a run ID with a space or non-ASCII is mangled by systemd and `cgroup.kill` goes to a path that does not exist (not reachable through `execute`, which mints UUIDs); `cancel()` after exit still signals a reaped pgid under a scope; the 1 KB reason cut can split a surrogate pair; the construction probe has no timeout. Notes: a cap crossed after the child's exit in process-group mode truncates silently; a pre-aborted signal is not honoured; fence variants without a newline after the tag; `scopePath` on a controller inside a sub-cgroup refuses loudly; a child cannot write itself out of the scope unprivileged. Review budget: standard 1 of 2 used, adversarial 1 of 1 used. Stopped; owner decides. Full verdicts under `/var/tmp/software_factory/04-d/`.
