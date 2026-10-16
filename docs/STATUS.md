# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md).

Plan step 1 done: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` and `tests/scenarios.ts` hold SC-01 to SC-19.

Plan step 2 done (A-018): `src/store.ts` persists events in one `node:sqlite` table and replays them through `apply`.

Plan step 3 done (A-019): `src/runtime/spawn.ts` launches, observes and cancels a runtime as a child process; [03-a-findings.md](work/03-a-findings.md) records how `claude -p` and `pi -p` behave (JSON shapes, session ids, exit 143 on cancel, exit 1 with JSON or stderr on bad model and no auth, tool denial). Tickets 03-a and 03-b, merged as one stacked branch with an adversarial FAIL on record; the process-group escape and the other findings are parked for 04-a.

Plan step 4 done (A-023): `src/adapter.ts` is the seam between the controller and a runtime; `src/controller.ts` starts a run with a deadline and records exactly one outcome per run through `EventStore.append`, which now returns the replayed Cycle; `run_failed` is a lifecycle event; `tests/fake-adapter.ts` drives normal, malformed, timeout, cancel and duplicate outcomes. Tickets 04-a, 04-b and 04-c, merged as one stacked branch with an adversarial FAIL on record (string-cap size bound, parked for 04-d).

## Checks run

2026-10-15: `npm test` and `RUNTIME_SPIKE=1 npm test` on `d8a9d21`, owner-run — 51 tests, 36 pass offline (10 live tests skipped with reason), 46 pass live, 5 todo, 0 fail.
2026-10-16: `npm test` on `3ba5434` (04-a), owner-run — 62 tests, 47 pass, 10 skipped, 5 todo, 0 fail. Standard review 1 PASS, adversarial FAIL (three majors in `receive`/`run_failed`; see the ticket log).

2026-10-16: `npm test` on `8664c1b` (04-b), owner-run — 68 tests, 53 pass, 10 skipped, 5 todo, 0 fail. Standard review 1 PASS; adversarial FAIL (two majors: hostile in-process values from an adapter, a throwing `toStringTag` getter on a rejection and a throwing `status` getter on an outcome, strand a cycle; see the ticket log).

2026-10-16: `npm test` on `003fdef` (04-c), owner-run — 71 tests, 56 pass, 10 skipped, 5 todo, 0 fail. Standard review 1 FAIL (BigInt and cycles pass `structuredClone` and throw in `append`); fixed with a JSON round trip.
2026-10-16: `npm test` on `e97a045` (04-c fix), owner-run — 71 tests, 56 pass, 10 skipped, 5 todo, 0 fail. Standard review 2 PASS. Adversarial FAIL: one major (an outcome within about 60 bytes of V8's string cap survives the guard and throws `RangeError` in `append`, stranding the cycle; reproduced, needs about 3 GB heap).

## Next action

Branch `feat/04-e-claim-scan` (stacked on 04-d): 04-d standard PASS, adversarial FAIL (claim-block regex backtracking, A-025); 04-e fixes it, standard review 1 PASS. Owner runs `npm test` on the fix SHA, then the 04-e adversarial review, then owner merges both. Plan row 5 (real developer run in a scratch repository) follows.
