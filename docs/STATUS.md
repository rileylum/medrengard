# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md). The twelve design-review cycles and v0.x specs were removed from the tree; they are in Git history before `1214ca2`.

Plan step 1 done: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` holds SC-01 to SC-19.

## Checks run

2026-10-15: `npm test` — 21 tests, 16 pass, 5 todo (SC-09, 10, 12, 14, 15 need readiness, waiver, finding and package models that v1 does not have yet), 0 fail.

## Next action

Plan step 2: SQLite event store behind the state machine. Then step 3, the runtime spike that launches `claude -p` and `pi -p` with JSON output and cancels a run mid-flight.
