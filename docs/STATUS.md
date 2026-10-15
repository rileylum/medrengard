# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md). The twelve design-review cycles and v0.x specs were removed from the tree; they are in Git history before `1214ca2`.

Plan step 1 done and merged: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` holds SC-01 to SC-19.

Ticket [02-a SQLite event store](work/02-a-sqlite-event-store.md) in review on branch `feat/02-a-sqlite-event-store`: `src/store.ts` persists events in one `node:sqlite` table and replays them through `apply`. Standard review 1 FAIL (double `open` corrupted the log), fixed with a test. Standard review 2 PASS on `7cff2de`. Adversarial review FAIL on `7cff2de`: an event type `apply` cannot classify is persisted and makes the log unloadable. Review budget is spent. Per workflow.md, a fix is a new ticket that names 02-a.

## Checks run

2026-10-15: `npm test` on `582e399`, owner-run — 31 tests, 26 pass, 5 todo (SC-09, 10, 12, 14, 15 need readiness, waiver, finding and package models that v1 does not have yet), 0 fail.

## Next action

Ticket [02-c validate serialised body](work/02-c-validate-serialised-body.md), stacked on 02-b on 02-a. Owner-run tests on the SHA, then standard review, adversarial review, and one merge of the stacked PR carrying 02-a, 02-b and 02-c. After that: plan step 3, the runtime spike (owner leaning towards Claude Code as the first runtime), and a controller ticket that picks up the minors parked in the 02-b and 02-c tickets.
