# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md).

Plan step 1 done: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` and `tests/scenarios.ts` hold SC-01 to SC-19.

Plan step 2 done (A-018): `src/store.ts` persists events in one `node:sqlite` table and replays them through `apply`.

Plan step 3 done (A-019): `src/runtime/spawn.ts` launches, observes and cancels a runtime as a child process; [03-a-findings.md](work/03-a-findings.md) records how `claude -p` and `pi -p` behave (JSON shapes, session ids, exit 143 on cancel, exit 1 with JSON or stderr on bad model and no auth, tool denial). Tickets 03-a and 03-b, merged as one stacked branch with an adversarial FAIL on record; the process-group escape and the other findings are parked for 04-a.

## Checks run

2026-10-15: `npm test` and `RUNTIME_SPIKE=1 npm test` on `d8a9d21`, owner-run — 51 tests, 36 pass offline (10 live tests skipped with reason), 46 pass live, 5 todo, 0 fail.

## Next action

Owner merges `feat/03-b-cancel-process-group` into main (it contains 03-a). Then write ticket 04-a (adapter interface, Design route) using `interface-design`; its done-when list must cover the first two 02-c lines and the three 03-x lines in [work/parked.md](work/parked.md).
