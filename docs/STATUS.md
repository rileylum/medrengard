# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md).

Plan step 1 done: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` and `tests/scenarios.ts` hold SC-01 to SC-19.

Plan step 2 done (A-018): `src/store.ts` persists events in one `node:sqlite` table and replays them through `apply`. Tickets 02-a, 02-b, 02-c, merged as one stacked branch. Three adversarial reviews each found a narrower input-validation hole; the last one is about the controller's calling convention and is parked in [work/parked.md](work/parked.md).

## Checks run

2026-10-15: `npm test` on `39d2c59`, owner-run — 32 tests, 27 pass, 5 todo (SC-09, 10, 12, 14, 15 need readiness, waiver, finding and package models that v1 does not have yet), 0 fail.

## Next action

Step 3 in progress on `feat/03-a-runtime-spike`: [03-a](work/03-a-runtime-spike.md) code and [findings](work/03-a-findings.md) committed; both CLIs authenticated and probed. Owner-run tests pass on 85e32e9. Standard review 1 PASS; adversarial FAIL (2 major: `close` versus `exit` with a grandchild on the pipe, and `cancel()` dead once `exitCode` is set). Stopped; owner decides: fix ticket 03-b, or merge with the findings parked for 04-a.
