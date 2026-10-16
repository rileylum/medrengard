# 07-d — Owner accept and cancel commands

Route: Fast. The lifecycle already has `accept` and `cancel` events; this ticket gives the owner a command for each (A-044).

Goal: the owner can accept or cancel a job's cycle from the command line, so a work ID can be run again without inventing a new one.

Done when:
- `node src/main.ts accept <job.json> <sha>` records `accept` on the job's open cycle when it is AWAITING_ACCEPTANCE and the SHA is its candidate head. It prints the stage and the merge line by SHA, and exits 0. Verified by test.
- `accept` writes nothing and exits 2 when the work has no open cycle, when the cycle is in another stage, or when the SHA is not the full candidate head. A typo never escalates a cycle. Verified by test.
- `node src/main.ts cancel <job.json>` records `cancel` on the job's open cycle. When none is open it records `cancel` on every ESCALATED cycle of the work, since the store asks a new cycle to name any one of them as its parent. It prints each cycle and stage and exits 0. With nothing to cancel it writes nothing and exits 2. Verified by test.
- After `accept` or `cancel`, `node src/main.ts <job.json>` opens a new cycle for the same work ID. Verified by test.
- `node src/main.ts <job.json>` still runs the job. On AWAITING_ACCEPTANCE it also prints the `accept` command and the merge line by SHA, not by branch, so the merge takes the accepted commit even if the branch moves. Verified by test.
- Parked 02-a note, busy timeout (the first ticket with two processes on one database): `cancel` from a second process while another connection holds the write lock waits and succeeds. Verified by test.
- Parked 02-a note, row 0 check: a cycle whose first row is not the open marker fails to load with an error naming the cycle. Verified by test.

Constraints: zero dependencies. `lifecycle.ts` untouched: apply already decides both events. No paid calls: tests seed the store.
Non-goals: stopping a run in progress in another process (its later events land on a terminal cycle and are ignored, but its current stage finishes); removing the clone, checkout or `sf/` branch; merging. Parked 02-a schema cleanup (`WITHOUT ROWID`, the partial index): proposed to drop, since existing databases would need a migration for no behaviour change; owner decides.
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-17 — owner: “Yep, let's add the accept and cancel commands now.” (A-044). Branch `feat/07-d-accept-cancel` off `feat/09-scoping` at `d54d731`.
- 2026-10-17 — tests first (`7d8f9cf`). `tests/main.test.ts`: end to end with the stub CLI (run, blocked rerun, accept, rerun, cancel, rerun), accept refusals on a seeded store, cancel of the open cycle or every ESCALATED cycle, cancel waiting on another connection's write lock. `tests/store.test.ts`: a non-open row 0. All five red. The 08-e CLI stub moved from `tests/run.test.ts` to `tests/stub-cli.ts` so both files use it.
- 2026-10-17 — implementation (`b5d4635`). `main.ts` gains `accept` and `cancel`; the run's summary prints the accept command and merges by SHA. `store.ts` sets a 5 s busy timeout, checks row 0, and exposes `cycles(workId)` and `SETTLED`. Mutation checks, one at a time, `src` restored after each: no busy timeout, no stage guard, a SHA prefix accepted, one ESCALATED cycle cancelled instead of all; each fails one test. Implementer-run `npm test` on `b5d4635`: 228 tests, 204 pass, 19 skipped, 5 todo, 0 fail. Not independent. Output: `/var/tmp/software_factory/07-d/npm-test-2.txt`. Standard review 1 launched on `b5d4635`.
- 2026-10-17 — Standard review 1 on `b5d4635`: PASS, 0 major, 0 minor, 4 notes. One note asked for a usage line on cancelling an ESCALATED ancestor; added to the README in `35530be`. Verdict: `/var/tmp/software_factory/07-d/standard-1.verdict.md`. Budget: standard 1 of 2 used.
- 2026-10-17 — Adversarial review on `b5d4635`: PASS, 0 major, 2 minors, 3 notes. Verdict: `/var/tmp/software_factory/07-d/adversarial.verdict.md`; probes under `/var/tmp/software_factory/07-d/probes/adv/`.
  - Minor: arguments after the job file are ignored, so the order typo `node src/main.ts job.json cancel` runs the job and starts a paid developer run when the work ID is free. Fix: refuse extra arguments with the usage line.
  - Minor: after `cancel` clears an ESCALATED parent and child, a job file that still names `parentCycleId` is refused (`parent cycle c1 is CANCELLED, not ESCALATED`). The work ID is free once the field is removed. Fix: a README line or a hint in the error.
  - Notes: cancel during DEVELOPING and STANDARD_REVIEW left the cycle CANCELLED with the late outcome ignored and no further stage started; three processes appending 300 events each lost none; a store written by `d54d731` still loads. `runsDir` resolves against the working directory, not the job file (since 07-b).
  - Budget: standard 1 of 2, adversarial 1 of 1. Waiting on the owner: fix the two minors before merge, park them, or accept them.
- 2026-10-17 — owner: “Fix” (A-045). Tests first (`1b7f099`): `job.json cancel` and `job.json accept <sha>` refused with the usage line, no store made and no CLI spawned; a job naming a cancelled parent refused before any run, naming the field to remove. Both red. Fix in `eaa5eb8`; README line added. Mutation checks: extra arguments allowed, parent check removed; each fails one test. Implementer-run `npm test` on `eaa5eb8`: 230 tests, 206 pass, 19 skipped, 5 todo, 0 fail. Not independent. Output: `/var/tmp/software_factory/07-d/npm-test-3.txt`. Standard review 2 launched on `eaa5eb8`.
- 2026-10-17 — Standard review 2 on `eaa5eb8`: PASS, 0 major, 0 minor, 4 notes. Both A-045 fixes verified by mutation. Notes: a `parentCycleId` that names no cycle, or another work's cycle, gets the store's refusal without the "remove the field" hint; a refused job on a fresh runs directory leaves an empty `events.sqlite`. Reviewer's independent `npm test` on `eaa5eb8`: 230 tests, 206 pass, 19 skipped, 5 todo, 0 fail. Verdict: `/var/tmp/software_factory/07-d/standard-2.verdict.md`. Budget: standard 2 of 2, adversarial 1 of 1, all passed. Ready for the owner's `npm test` and merge.
