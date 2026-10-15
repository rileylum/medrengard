# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md).

Plan step 1 done: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` and `tests/scenarios.ts` hold SC-01 to SC-19.

Plan step 2 done (A-018): `src/store.ts` persists events in one `node:sqlite` table and replays them through `apply`. Tickets 02-a, 02-b, 02-c, merged as one stacked branch. Three adversarial reviews each found a narrower input-validation hole; the last one is about the controller's calling convention and is parked in [work/parked.md](work/parked.md).

## Checks run

2026-10-15: `npm test` on `39d2c59`, owner-run — 32 tests, 27 pass, 5 todo (SC-09, 10, 12, 14, 15 need readiness, waiver, finding and package models that v1 does not have yet), 0 fail.

## Next action

Owner merges `feat/02-c-validate-serialised-body` into main (carries 02-a, 02-b, 02-c). Then plan step 3, the runtime spike: a script launches `claude -p` and `pi -p` with JSON output, captures the result, and cancels a run mid-flight. Owner leaning towards Claude Code as the first real runtime. Write the step 3 ticket(s) first and get a go.
