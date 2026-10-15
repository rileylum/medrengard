# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md).

Plan step 1 done: `src/lifecycle.ts` is the pure state machine; `tests/lifecycle.test.ts` and `tests/scenarios.ts` hold SC-01 to SC-19.

Plan step 2 done (A-018): `src/store.ts` persists events in one `node:sqlite` table and replays them through `apply`.

Plan step 3 done (A-019): `src/runtime/spawn.ts` launches, observes and cancels a runtime as a child process; [03-a-findings.md](work/03-a-findings.md) records how `claude -p` and `pi -p` behave (JSON shapes, session ids, exit 143 on cancel, exit 1 with JSON or stderr on bad model and no auth, tool denial). Tickets 03-a and 03-b, merged as one stacked branch with an adversarial FAIL on record; the process-group escape and the other findings are parked for 04-a.

Plan step 4 in progress: ticket [04-a](work/04-a-adapter-interface.md) (Design route, A-020) on branch `feat/04-a-adapter-interface`: `src/adapter.ts` is the adapter seam, `src/controller.ts` starts a run with a deadline and records the outcome, `run_failed` is a lifecycle event, `EventStore.append` returns the Cycle. 04-a: standard 1 PASS, adversarial FAIL on `3ba5434`; owner chose a fix ticket (A-021). [04-b](work/04-b-receive-hardening.md) on branch `feat/04-b-receive-hardening`, stacked on 04-a, fixes the three majors and the minors; standard PASS, adversarial FAIL on `8664c1b`; owner decides. [04-c](work/04-c-total-receive.md) (A-022) makes `receive` and the deadline total over any value an adapter can produce. 04-d (real claude and pi adapters, cgroup cancel) follows and carries the two 03-b parked lines.

## Checks run

2026-10-15: `npm test` and `RUNTIME_SPIKE=1 npm test` on `d8a9d21`, owner-run — 51 tests, 36 pass offline (10 live tests skipped with reason), 46 pass live, 5 todo, 0 fail.
2026-10-16: `npm test` on `3ba5434` (04-a), owner-run — 62 tests, 47 pass, 10 skipped, 5 todo, 0 fail. Standard review 1 PASS, adversarial FAIL (three majors in `receive`/`run_failed`; see the ticket log).

2026-10-16: `npm test` on `8664c1b` (04-b), owner-run — 68 tests, 53 pass, 10 skipped, 5 todo, 0 fail. Standard review 1 PASS; adversarial FAIL (two majors: hostile in-process values from an adapter, a throwing `toStringTag` getter on a rejection and a throwing `status` getter on an outcome, strand a cycle; see the ticket log).

2026-10-16: `npm test` on the 04-c branch, implementer-run — 71 tests, 56 pass, 10 skipped, 5 todo, 0 fail. Not yet owner-run.

## Next action

Owner runs `npm test` on the 04-c SHA; then standard review 1 for 04-c via `claude -p`.
