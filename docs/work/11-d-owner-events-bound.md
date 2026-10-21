# 11-d — Owner events bound to a SHA, deduplicated, and refused on a stale load

Route: Design. It changes what the store accepts from outside a run and closes a parked race, and it has real alternatives (A-123 item 1, A-132). Tier: Trust (2 standard + 1 adversarial through `claude -p`, A-125): the store and the engine.

Goal: every event from outside a run can be deduplicated by a command ID; `request_changes` binds to the candidate head as `accept` does; and an owner command decided on a cycle that has since moved writes nothing.

Design note: [2026-10-21-owner-moves.md](../design/2026-10-21-owner-moves.md) (shared with 11-d2).

Done when:
- `isEvent` refuses a `request_changes` without `head`; `apply` escalates one whose head is not the candidate. Verified by test, including `engine.md` G7's sequence: reject `h1`, developer makes `h2`, a redelivered rejection with the same command ID writes nothing, and one naming `h1` under a new ID escalates rather than rejecting `h2`.
- `accept`, `request_changes`, `cancel`, `head_changed` and `base_changed` take an optional `commandId`. A second event with the same ID on the same cycle writes nothing and returns the cycle unchanged; the same ID on another cycle is recorded. Verified by test, and by a mutant that drops the command key.
- `append(cycleId, event, { after })` throws `StaleLoad`, writing nothing, when the cycle's history is longer than `after`. The check runs under the write lock. Verified by test, and by a mutant that checks before `BEGIN IMMEDIATE`.
- Two overlapping `accept` commands on a cycle whose human stage leads to a grant stage: one records `accept` and runs the grant stage once; the other is refused with `StaleLoad` and writes nothing; the cycle never reads ESCALATED. Verified by a test that releases both with a held write lock (A-137). Closes the parked 11-a2 row.
- `cancel` passes no `after` and still lands during a run. Verified by the existing 07-d tests, unchanged.
- `node src/main.ts request-changes <job.json> <sha>` records `request_changes` with the head and drives on, refusing as `accept` does (no open cycle, not at a human stage, not the candidate). Every owner command takes `--command-id <id>`; without it a random one is minted. Verified by test.
- The observer kit sends `<source>:<pos>` as the command ID, so handling the same stream line twice records one event. Verified by test.
- No existing log moves stage: every v1 and v2 fixture cycle replays to the stage main's `apply` gives. `ENGINE_VERSION` stays 1. Verified by test.
- The spec's Identities table and principle 2 name the owner's SHA-bound decisions and the command ID. `learn/shims/store.js` follows `append`. Verified by `npm run test:learn`.

Constraints: zero dependencies; `node:sqlite` and `node:crypto` only; no paid calls. Existing tests pass unchanged.
Non-goals: `owner_decision` and the moves (11-d2); `run_started` for reviewers (11-e); a stale-load check on run outcomes; a separate `command_id` column.
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result.

## Log
- 2026-10-21 — drafted on `feat/11-d-owner-events-bound` (then named `feat/11-d-owner-moves`) off main at `f3f2a25`. Not READY until the owner answers the design note's questions and says go.
- 2026-10-21 — owner: “Go with your recommendations” (A-139). READY at Trust tier. The branch is renamed `feat/11-d-owner-events-bound`.
- 2026-10-21 — implemented, tests first; code head `ad3d9c4`. Red first: the `request_changes` shape and head check and the command ID shape (`tests/lifecycle.test.ts`); the store tests (no `StaleLoad`). Written after the code, each with a mutant as its red step: the `decide.ts`, `main.ts` and observer-kit tests. `request_changes` requires `head` and escalates for a SHA other than the candidate. `accept`, `request_changes`, `cancel`, `head_changed` and `base_changed` take an optional `commandId`, a non-empty well-formed string; the store keys it as `JSON.stringify({ commandId })` in the `run_id` column, so the existing unique index keeps the first per cycle. `outcomeRunId` is kept; `dedupKey` in `store.ts` wraps it, which leaves its test unchanged. `append(cycleId, event, { after })` throws `StaleLoad` under the write lock when the history is longer than `after`. `acceptEvent` and the new `requestChangesEvent` (`decide.ts`) return the history length they decided on; `decideAndDrive` takes it and passes it to both appends; `cancelWork` passes none. `main.ts`: `request-changes <job> <sha>`; `--source` and `--command-id` in either order, each once; no ID is minted (A-140); a `StaleLoad` adds "run the command again". The observer kit sends `<source>:<pos>:<command>`. Two pins changed with A-140: the `request_changes` sample in `tests/lifecycle.test.ts` and the expected accept in `tests/observe.test.ts`. The guide's store stand-in and two pages follow. Mutants (`/var/tmp/software_factory/11-d/mutants.log`): 17 of 17 caught, the lock mutant 3 runs of 3 and the loop-path `after` mutant 2 of 2. Implementer's `npm test` on `ad3d9c4`, not independent: 516 tests, 492 pass, 0 fail, 19 skipped, 5 todo; `test:learn` 6 of 6. The simulator was not checked in Chrome: the browser extension was not connected.
