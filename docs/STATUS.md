# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md). The twelve design-review cycles and v0.x specs were removed from the tree; they are in Git history before `1214ca2`.

Plan step 1 done and merged: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` holds SC-01 to SC-19.

Ticket [02-a SQLite event store](work/02-a-sqlite-event-store.md) in review on branch `feat/02-a-sqlite-event-store`: `src/store.ts` persists events in one `node:sqlite` table and replays them through `apply`. Standard review 1 FAIL (double `open` corrupted the log); fixed with a test. Standard review 2 pending.

## Checks run

2026-10-15: `npm test` on `b3280df`, owner-run — 25 tests, 20 pass, 5 todo (SC-09, 10, 12, 14, 15 need readiness, waiver, finding and package models that v1 does not have yet), 0 fail.

## Next action

Standard review 2 of 02-a, then adversarial review, then owner merge. After 02-a: plan step 3, the runtime spike (owner leaning towards Claude Code as the first runtime).
