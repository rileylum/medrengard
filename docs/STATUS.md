# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md). The twelve design-review cycles and v0.x specs were removed from the tree; they are in Git history before `1214ca2`.

Plan step 1 done and merged: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` holds SC-01 to SC-19.

Ticket [02-a SQLite event store](work/02-a-sqlite-event-store.md) in review on branch `feat/02-a-sqlite-event-store`: `src/store.ts` persists events in one `node:sqlite` table and replays them through `apply`. Standard review 1 FAIL (double `open` corrupted the log), fixed with a test. Standard review 2 PASS on `7cff2de`. Adversarial review FAIL on `7cff2de`: an event type `apply` cannot classify is persisted and makes the log unloadable. Review budget is spent. Per workflow.md, a fix is a new ticket that names 02-a.

## Checks run

2026-10-15: `npm test` on `39d2c59`, owner-run — 32 tests, 27 pass, 5 todo (SC-09, 10, 12, 14, 15 need readiness, waiver, finding and package models that v1 does not have yet), 0 fail.

## Next action

02-c on `39d2c59`: standard 1 PASS, adversarial FAIL. The store meets its done-when list; the finding is that a future controller applying the unserialised object in memory can diverge from replay, and the suggested fix is an interface change (`append` returns the canonical Event, or applies it and returns the Cycle). Owner decides: 02-d for that interface change, or merge the stacked PR (02-a, 02-b, 02-c) and settle the calling convention in the controller ticket, where the caller is written. After that: plan step 3, the runtime spike.
