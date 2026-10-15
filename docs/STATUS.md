# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md).

Plan step 1 done: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` and `tests/scenarios.ts` hold SC-01 to SC-19.

Plan step 2 done (A-018): `src/store.ts` persists events in one `node:sqlite` table and replays them through `apply`. Tickets 02-a, 02-b, 02-c, merged as one stacked branch. Three adversarial reviews each found a narrower input-validation hole; the last one is about the controller's calling convention and is parked in [work/parked.md](work/parked.md).

## Checks run

2026-10-15: `npm test` on `39d2c59`, owner-run — 32 tests, 27 pass, 5 todo (SC-09, 10, 12, 14, 15 need readiness, waiver, finding and package models that v1 does not have yet), 0 fail.

## Next action

Step 3 in progress on `feat/03-a-runtime-spike`: [03-a](work/03-a-runtime-spike.md) code and [findings](work/03-a-findings.md) committed; both CLIs authenticated and probed. Owner-run tests pass on 85e32e9. Standard review 1 PASS; adversarial FAIL (2 major: `close` versus `exit` with a grandchild on the pipe, and `cancel()` dead once `exitCode` is set). Owner chose fix ticket [03-b](work/03-b-cancel-process-group.md) on `feat/03-b-cancel-process-group`, stacked on 03-a: cancel signals the process group, resolves inside the bound with a grandchild on the pipe. Owner-run tests pass on d8a9d21. Standard 1 FAIL (test did not exercise the guard), fixed; standard 2 PASS; adversarial FAIL, 2 major: descendants that `setsid` out of the process group survive cancel, and a child that re-parents itself is reported `exited` 0. Budget spent. Stopped; owner decides: fix ticket 03-c, or merge with the setsid findings parked for 04-a (the real CLIs do not re-parent in the tool-less runs tested).
