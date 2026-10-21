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
