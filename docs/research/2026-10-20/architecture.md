# Architecture review of `src/` and `tests/` (slug: architecture)

Read at `a3c74ff` in a detached worktree. Vocabulary from the `interface-design` skill: module, interface, seam, adapter, depth, leverage, locality.

## Baseline

- `npm test`: 419 tests, 395 pass, 0 fail, 19 skipped, 5 todo. About 36 s wall (59 s user, 47 s sys).
- Slowest files, run alone: `developer.test.ts` 27.3 s, `kits.test.ts` 21.1 s, `verify.test.ts` 20.9 s, `runtime.test.ts` 12.1 s, `stream.test.ts` 12.0 s, `main.test.ts` 9.9 s, `run.test.ts` 8.3 s. Every other file takes under 7 s.
- Slowest single test: `runtimeKit fails an adapter that does not settle after an abort`, at 10.65 s. It waits out the fixed `SETTLE_MS = 10_000` in `src/kits/runtime.ts:14`.
- Node runs the test files in parallel, so the wall time is set by `developer.test.ts`. Most of its time is deadline and FIFO tests that wait 2 to 3 s each, which 08-f pinned on purpose. That file sets `process.env.PATH` at line 605, so its tests cannot run concurrently without a change.

## Ranked findings

### 1. The one-open-cycle rule is check-then-insert, with no transaction (bug)

`EventStore.open` reads `cyclesFor(workId)` (store.ts:136), then inserts row 0 (store.ts:144). The comment at store.ts:141 says a racing open "must collide on the primary key", but the key is `(cycle_id, seq)`. Two opens with *different* cycle IDs for the same work therefore both succeed.

- **Reproduction** (`probe/race.ts`): open two `EventStore`s on one file. Patch `b.cyclesFor` so that `a.open('c1','w1')` runs between b's check and b's insert. Then `b.open('c2','w1')` succeeds, and `cycles('w1')` returns two QUEUED cycles. Two processes can take the same order: two terminals running `node src/main.ts job.json`, or a row-13 pool made of processes.
- **Effect:** the spec's "one work item has at most one open cycle" breaks. Each `accept` and `cancel` then picks the first open cycle.
- **Fix:** wrap the checks and the insert in `BEGIN IMMEDIATE … COMMIT`, as `addPositions` already does at store.ts:46. Test it as 10-d did: hold `BEGIN IMMEDIATE` on a raw connection, start two child `open`s, release the lock, and expect exactly one cycle.
- Impact 3 (4 once row 13 lands). Effort S. Confidence high. Implementable now: yes. The spec already states the rule.

### 2. One driver entry point; accept and cancel as functions, not CLI code (pure refactor)

Today `run` is develop followed by `drive`. `resume` calls `drive` but rebuilds paths itself (run.ts:77-78). `accept` and `cancel` exist only inside `main.ts` (main.ts:224-269), mixed with `console.log`. `main.ts` calls `main()` when it is imported (main.ts:338), so every test of a command spawns a process: 31 `sf(...)` calls in main.test.ts and 14 in stream.test.ts.

Three later needs hit the same missing seam:
- Row 11 needs a `resume` command.
- Row 12 needs "a GitHub merge records accept", from code rather than the CLI.
- The known gap "a grant stage after a human stage never runs" needs accept to be followed by a drive.

Sketch:

```ts
// src/run.ts, exported: the loop that run and resume already share
export async function drive(store: EventStore, cycleId: string, adapters: Adapters, job: Job, opts: RunOptions): Promise<RunResult>
// src/decide.ts, new: the rules now at main.ts:224-269, without printing
export function acceptCycle(store: EventStore, workId: string, sha: string, source: string): Cycle   // throws the same messages
export function cancelWork(store: EventStore, workId: string, source: string): Cycle[]
// src/main.ts
export async function main(argv: string[]): Promise<number>
if (import.meta.main) main(process.argv.slice(2)).then(...)   // Node 24.13 supports import.meta.main (checked)
```

- Files: `run.ts`, `main.ts`, and the new `decide.ts`.
- Pure refactor: yes. `main.test.ts`, `stream.test.ts` and `run.test.ts` keep spawning `main.ts` and must pass unchanged. New fast tests can then call `acceptCycle` and `cancelWork` in-process.
- Row 11 then adds `resume` as `drive`. Row 12 adds `acceptCycle(…)` followed by `drive(…)`.
- Impact 4. Effort M. Confidence high. Implementable now: yes for the extraction. Whether `accept` should drive on is an owner decision, and belongs to row 11 or 12.

### 3. A shared preflight for `run` and `resume`; bad check names are found only after a paid developer run

`run` refuses a broken setup before develop (run.ts:52-58): the sandbox, a missing `workflowDir`, missing grants. Two gaps remain:

- **Job check names.** `job.checks` names are checked only inside `verify` (verify.ts:107-116). `tests/run.test.ts:155-170` pins this: a check named `../x` gives `['claim','developer_result','reject_dispatch']`. With a real CLI, the owner pays for a developer run and gets an escalated cycle. Neither `loadConfig` nor `run` checks `job.checks`. `commandReasons` (lifecycle.ts:291) applies the same rules to a stage's `run`, but nothing applies them to `job.checks`.
- **Resume skips most of preflight.** `resume` runs only `checkSandbox` and `byRole` (run.ts:74-75). It skips the `workflowDir` and grant checks, so a resumed cycle can pay for a review and then fail at a grant stage.

Sketch:

```ts
// lifecycle.ts: commandReasons' per-command loop, split out
export function commandListReasons(label: string, cmds: unknown, opts: { files: boolean; grantStage: boolean }): string[]
// run.ts
function preflight(w: Workflow, job: Job, opts: RunOptions): void   // sandbox, workflowDir, grants, job.checks
```

`verify` keeps its own check as a backstop.

- Not pure: `run.test.ts:155` must make a stage throw some other way, for example a missing verify checkout. Add tests that a bad check name throws before develop, and that resume refuses a missing grant.
- Impact 3. Effort S. Confidence high. Implementable now: yes. It follows the "before develop" pattern of 08-a and 10-e.

### 4. Event knowledge is spread across files; move outcome classification into `lifecycle.ts` (pure refactor)

Copies of the same knowledge today:
- **"Outcome" event types.** `DEDUP` (store.ts:86) and the shim copy `learn/shims/store.js:16` list which events are a run's outcome. `apply` encodes the same list in its `consumed` branches (lifecycle.ts:405, 417, 436, 472). HANDOFF's lesson already counts four places to change for a new event type.
- **Settled stages.** `SETTLED` appears in store.ts:88, controller.ts:83 and shims/store.js:10. `SETTLED_TARGETS` (lifecycle.ts:13) is the same set.

Sketch:

```ts
// lifecycle.ts
export const SETTLED: Stage[] = ENGINE_STAGES.slice(1);
/** The run ID if `e` is a run's one outcome; the store keeps one per run. */
export function outcomeRunId(e: Event): string | undefined
```

- `store.ts` derives `dedupKey` from `outcomeRunId(parsed)`. `controller.ts`, `store.ts`, `main.ts` and the shim import `SETTLED`.
- One new lifecycle test: for every key of `SHAPE` whose event has a `runId`, other than `claim`, `outcomeRunId` returns it.
- A new outcome type then needs three places changed, not four, and the browser stand-in follows by itself.
- Pure refactor: yes. All store, controller and lifecycle tests stay unchanged.
- Impact 2. Effort S. Confidence high. Implementable now: yes.

### 5. A `layout` module for cycle paths (pure refactor; recovery needs it)

Every step function works out where things live from `runsDir` and `cycleId`:
- **The default runs folder** `'/var/tmp/software_factory/runs'` is written out four times: developer.ts:67, review.ts:26, verify.ts:60 and config.ts:54.
- **The clone and the branch.** `join(runsDir, cycleId)` and `` `sf/${cycleId}` `` appear in developer.ts:74-77, developer.ts:130-132, run.ts:77-78 and `learn/shims/sim-developer.js`.
- **The verify checkout** `` `${cycleId}-verify` `` appears in verify.ts:142 and review.ts:55.
- **The evidence layout** `evidence/<head>/<stage>/<name>.<ext>` is written in verify.ts and read back in review.ts:72-80, kits/command.ts and two learn shims.
- **The default sandbox** `opts.sandbox ?? { backend: 'bwrap' }` appears six times.

Row 11 recovery has to find a stranded cycle's clone and checkout from its ID alone. Row 13 needs paths that are clearly per cycle.

Sketch:

```ts
// src/layout.ts
export const DEFAULT_RUNS_DIR = '/var/tmp/software_factory/runs';
export function layout(runsDir: string | undefined, cycleId: string): {
  clone: string; branch: string; checkout: string;
  evidence(head: string, stage: string): string;
  evidenceFile(dir: string, check: string, ext: 'exit' | 'stdout' | 'stderr'): string;
}
```

- Pure refactor: yes. developer, verify, review, run and command tests stay unchanged.
- Impact 3. Effort S. Confidence high. Implementable now: yes.

### 6. Resume runs on whatever the job file says now (row 11, needs a decision)

The open row records the work ID, parent, workflow and its hash, the base, and the definition (store.ts:10-20). It records nothing of the job: not the ticket, not `checks`, not `repo`, not `instructions`. `resume(store, cycleId, adapters, job, opts)` takes the job from the caller. Recovery will read the job file again, so after an edit to it:
- the fix run and the reviewers are given a different ticket from the one the first developer worked to;
- verify runs different checks on the same head.

Neither change is recorded anywhere. That is the drift A-059 refuses for workflows ("a cycle replayed under another workflow … refuse instead"), and nothing guards it for tickets.

Proposal: record `job: { ticketHash, checksHash, repo }`, or the ticket text itself, on the open row. `resume` and `drive` then refuse a mismatch, as `load` refuses a workflow mismatch.

- Not pure: the open row gains a field. Older rows without it should be accepted, as with `workflow`.
- Impact 4 for row 11. Effort S to M. Confidence high that the gap exists; the fix is a design choice.
- Implementable now? Not without the owner. Decision needed: store the ticket text (the reviewer could then be rebuilt from the store alone) or only a hash, and whether a mismatch refuses or escalates.

### 7. Replay each cycle under its recorded definition (row 11 and 13; needs a nod)

Three modules each choose "the workflow this cycle was opened under":
- `EventStore` is built around one workflow and throws for any cycle opened under another (store.ts:189-192).
- `stream.ts#workflowOf` (stream.ts:28-32) uses the recorded `definition` when it hashes to the recorded workflow.
- `main.ts#decisionConfig` (main.ts:173-183) reloads the config layers at every recorded base until one hashes the same.

Recovery wants to scan every unsettled cycle in a runs folder. With today's store it throws on the first cycle under another workflow, and this is behind the rough edge "one runs directory holds one workflow per work ID". 10-d already trusts a recorded definition that hashes correctly.

Sketch:

```ts
new EventStore(path, workflowForNewCycles?)
store.load(id)       // replays under the open row's definition if its hash matches,
                     // else the given workflow if it matches, else throws (as now)
store.unsettled(): { cycleId; workId; stage }[]   // across all works
```

- `decisionConfig` then shrinks to a fallback for stores written before 10-d.
- Not pure: the store's public behaviour changes for mixed stores. Existing tests should pass, but `store.test.ts`'s mismatch test needs a look.
- Impact 3. Effort M. Confidence medium.
- Implementable now? Needs an owner nod: it widens A-059 from "refuse another workflow" to "replay under the recorded one when it hashes".

### 8. Drift in the guide's stand-ins: share the pure parts instead of copying them (pure refactor in `src/`)

Each stand-in copies its `src/` module's rules by hand:
- `learn/shims/store.js` (119 lines) repeats `open`, `append`, `load` and the rest of `store.ts`.
- `learn/lines.js` repeats `stream.ts#openStream`'s per-row replay.
- `sim-developer.js` repeats `fix`'s preconditions.

Drift has already started. `lines.js` dereferences `cycles.get(r.cycle_id).workId` with no fallback, where `stream.ts:74` uses `?? { workId: '' }`. `lines.js` also never passes the caller's workflow.

Split out the parts with no I/O:

```ts
// src/stream.ts: the loop body, no SQLite
export function replayRow(state: Map<string, Known>, row: { pos; at; cycle_id; seq; body }, opts): Line | undefined
// src/developer.ts: fix's checks on the cycle, no Git
export function fixInput(cycle: Cycle, w: Workflow): { def; head: string; base: string; findings?: string[] }
// src/store.ts: open's rules over the cycles of the work
export function openRefusal(cycles: { cycleId; stage }[], parent?: Cycle, ...): string | undefined
```

- `lines.js` and the shims then import these the way they already import `apply`.
- Pure refactor: yes for `src/`. `npm test` stays unchanged, and `npm run test:learn` must still pass.
- Impact 2 (maintenance). Effort M. Confidence high. Implementable now: yes. Do `replayRow` and `fixInput` first, because they are the smallest.

### 9. Synchronous git in the driver blocks other cycles in a single-process pool (row 13 decision)

`ExecuteOptions.accept` is synchronous (controller.ts:258), because `receive` is synchronous. As a result `land` (developer.ts:211-237), `cloneGit`, `treeDiff`, `checkoutGit` and review's `gather` all use `spawnSync` or `execFileSync`, each bounded by the stage deadline, for example 900 s on a live run. `git.ts:11-14` already notes that `spawnSync` blocks the event loop. With one cycle that is harmless. In a single-process pool, one cycle's FIFO-blocked fetch would freeze the other cycles' deadline timers and adapter I/O until its own deadline.

The pool model decides which of two fixes is needed:
- **One process per cycle:** finding 1 must be fixed, and `pi`'s shared `auth.json` (A-068) matters.
- **One process for many cycles:** `accept` and `receive` become async, roughly `accept?: (claim) => Promise<string | undefined>`, and `land` and friends move to async `spawn`. Effort M. This is not pure: about 7 `receive` call sites in tests change from `throws` to `rejects`, and `learn/demos/ctl-outcomes.js:107` changes too.

Impact 3 for row 13. Confidence medium; nothing was measured. Implementable now? Not before the owner picks the pool model.

### 10. Row 9's "must allow for" list for row 11 is only partly met (for drafting row 11)

`docs/plan.md` says row 9 must provide two things for recovery:
- **"Runs recorded as started, so an orphan can be found."** This is still true only for developer runs. HANDOFF already lists the reviewer start record.
- **"A relaunch budget per cycle for infrastructure failures."** This does not exist. `apply` escalates every `run_failed` (lifecycle.ts:471-474). The spec's Recovery proposal ("may relaunch a failed run once") therefore needs a change to the engine: a new event, or a relaunch counter on `Cycle`. A workflow alone cannot add it. HANDOFF does not say this.

A cheap seam to add with it: `RunOptions.signal?: AbortSignal`, passed through `drive` into `execute`'s `bounded()` controller at controller.ts:403. A SIGINT handler can then end a run as `cancelled` instead of leaving it stranded. Without a signal, behaviour stays as it is. Whether Ctrl-C should escalate, or leave the cycle resumable, is the owner's choice.

Impact 4 for row 11 planning. Effort: design. Confidence high.

### 11. Test speed and test seams (small)

- **Fixed runtimeKit settle time.** `runtimeKit`'s `SETTLE_MS` is fixed at 10 s (kits/runtime.ts:14). Add `opts?: { settleMs?: number }` with a default of 10 000, and have `tests/kits/deaf.kit.ts` pass 1000. The test then drops from 10.6 s to about 1 s, and the regex at `tests/kits.test.ts:59` changes. Nearly pure.
- **In-process main tests.** After finding 2, new `main.ts` behaviour can be tested in-process. Keep one spawned smoke test per command.
- **Splitting `developer.test.ts`.** Splitting the file in two would let Node run the halves in parallel and cut about 8 to 10 s of wall time. This is a guess and was not measured. The `process.env.PATH` edit at line 605 must stay within one file.
- **Tests that write raw SQL.** The tests that write raw SQL (`store.test.ts:267`, `stream.test.ts:186-440`) simulate corrupt or pre-10-d stores. That is a fair reason to reach past the interface; no change is needed.
- **ROLE_ALIASES runs in two directions.** run.ts:83 renames alias keys to role names, and main.ts:152 looks up role names among alias keys. If a caller passes both `standard` and `standard_reviewer`, `byRole` keeps whichever comes last in the object. Low impact; it could be folded into one `adapterKey(runtime, role)` function.

## Best candidates for an unattended branch

These are pure or nearly pure; all existing tests should pass with no change, or with the one test change named:

1. Finding 4: `SETTLED` and `outcomeRunId` move into `lifecycle.ts`.
2. Finding 5: the `layout` module.
3. Finding 2: `drive` exported, `decide.ts`, and `main()` exported behind `import.meta.main`.
4. Finding 11: the `settleMs` option. One regex changes.
5. Finding 8: `replayRow` and `fixInput` only.

Finding 1 is a small, real bug fix, and it is spec-backed, so it can be built test-first now.

## Scratch

- `probe/race.ts`, the race reproduction, is under `/var/tmp/software_factory/research-2026-10-20/architecture/`.
- The worktree was removed after the run.
