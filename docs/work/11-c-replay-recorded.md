# 11-c — Replay each cycle under its recorded workflow, and detect divergence

Route: Design. It changes what the store trusts and how every load replays, and it has real alternatives (A-112 item 6, A-123 item 2). Tier: Trust (2 standard + 1 adversarial through `claude -p`, A-125): the store.

Goal: the store replays each cycle under the workflow it was opened with, lists unsettled cycles across work IDs, and refuses a cycle whose replay no longer matches the stages it recorded.

Design note: [2026-10-21-replay-recorded.md](../design/2026-10-21-replay-recorded.md).

Done when:
- A store built with workflow B loads, lists and appends to a cycle opened under workflow A, replaying under A's recorded definition: the cycle reaches a stage only A has. Verified by test.
- `drivable` refuses that cycle, naming both workflows; every stage function reaches its cycle through `drivable`. Verified by test, and by a mutant that calls `load` instead.
- A cycle with no recorded definition and a hash that neither the default nor the given workflow matches is still refused, naming both. Verified by test.
- A recorded definition that `replayCheck` passes and `checkWorkflow` refuses still loads; a new store built with it is refused. Verified by test.
- Each row stores the stage `apply` produced. A row whose stored stage differs from the replay makes `load` throw `ReplayDiverged`, naming the cycle, the row's seq, both stages and the engine version. Verified by test that edits a stored stage.
- Two processes appending to one cycle at once store the stages the final log replays to. Verified by a test that releases them together with a barrier file.
- The open row records `engine: ENGINE_VERSION`. Verified by test.
- `unsettled()` lists every cycle not in SETTLED across work IDs, and lists a cycle it cannot replay with the reason instead of throwing. Verified by test.
- A store written before 11-c (the v1 and v2 fixtures) gains the column with nulls and loads every cycle as before. Verified by the existing fixture tests and one for the column.
- `events` resolves a cycle's workflow with `recordedWorkflow`, the same rule as the store. Verified by the existing stream tests and one for a definition `checkWorkflow` now refuses.

Constraints: zero dependencies; `node:sqlite` and `node:crypto` only; no paid calls. Existing tests pass unchanged, except the two pins the design note names (question 6), which change only with the owner's word.
Non-goals: driving a cycle under another workflow (11-f); refusing an append whose loaded stage moved (11-d, parked); `decisionConfig` changes; the history copy in `record` (P9, Protocol version row); stage checks in the stream.
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result.

## Log
- 2026-10-21 — drafted on `feat/11-c-replay-recorded` off main at `12b3be9`. Not READY until the owner answers the design note's questions and says go.
- 2026-10-21 — owner: “Go with your recommendations” (A-136). READY at Trust tier.
- 2026-10-21 — probe before code (`/var/tmp/software_factory/11-c/probes/p1.ts`): one append on a cycle of 250, 500, 750 and 1,000 events took 1.55, 2.11, 2.36 and 2.90 ms on main; after 11-c, 1.56, 2.19, 2.82 and 3.43 ms. The lock and the comparison keep the cost near one replay per append.
- 2026-10-21 — implemented, tests first; code head `e64464d`. Red first, each for the missing behaviour: a store running the default workflow loading an owner-check cycle (refused by A-059); the two A-136 pins rewritten (no `drivable`); `tests/drivable.test.ts` (`drive` reached preflight instead of refusing); a recorded definition `checkWorkflow` now refuses (refused on load); the stored-stage test (no column); `unsettled` (missing); the stream test (null stages). Passing at once, with mutants as their red step: the no-match refusal, `replayCheck`'s table, the engine, concurrent-append and pre-11-c store tests. `recordedWorkflow` (store.ts) tries the recorded definition, then `defaultWorkflow`, then the store's, each through `replayCheck` (lifecycle.ts, only what `apply` reads) and the hash; `stream.ts` uses it in place of its own `workflowOf`. `load` replays under it; `drivable` also refuses a cycle whose recorded hash is not the store's, and `drive`, `decideAndDrive`, `review`, `fix`, `verify`, the controller's `requireStage` and `acceptEvent` call it where they called `load`; `cancelWork` still appends to any cycle that loads. A nullable `events.stage` column, added to older stores as `addPositions` adds `pos`; the open row stores `QUEUED` and `engine: ENGINE_VERSION` (1); `append` replays, applies and inserts under `BEGIN IMMEDIATE`; a stored stage the replay disagrees with throws `ReplayDiverged`. `unsettled()` lists cycles not in SETTLED across work IDs, with `refused` for one that cannot replay. The concurrent-append test uses the held write lock as its barrier, as the open-race test does, not a barrier file. The guide's store stand-in and `lines.js` follow the same rules; `store.html` and `lifecycle.html` describe them. Mutants (`/var/tmp/software_factory/11-c/mutants.log`): 7 of 7 `drivable` call sites, 13 of 13 `replayCheck` rules, and the stage-column mutants caught (the lock mutant three runs of three); the migration mutant hung rather than failed, because the 02-a test "a process killed between two events reopens…" waits with no bound for its writer child. Not changed here; a Housekeeping candidate. Implementer's `npm test` on `e64464d`, not independent: 496 tests, 472 pass, 0 fail, 19 skipped, 5 todo. `test:learn` 6 of 6; the simulator page ran a ticket to AWAITING_ACCEPTANCE and accepted it, with no console errors.
