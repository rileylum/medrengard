# 10-d — Observation stream

Route: Design. The stream's line format, its cursor and the store's new columns are seams every observer builds on (A-074, D-024).

Goal: `node src/main.ts events <job.json | runsDir> [--after <seq>] [--follow]` prints one JSON line per event, with its time, position and the stage it moved the cycle to. `accept` and `cancel` record their source. A TypeScript helper and a contract kit let an observer act through the owner's commands.

Design note: [2026-10-20-observation-stream.md](../design/2026-10-20-observation-stream.md). The events table gains `pos` and `at`, set in the one insert statement. Old rows get a `pos` and no `at`. The open row records the workflow's definition. `src/stream.ts` replays each cycle to give `from`, `stage` and `escalation`. `accept` and `cancel` take `--source`. `src/kits/observe.ts` holds `observe` and `observerKit`. The alternatives considered: a second table, push from the controller, and stages stored per row.

Done when:
- Every row a 10-d store writes has a store-wide increasing `pos` and an ISO `at`. Verified by test.
- `v1-store.sqlite`, and a pre-10-d store with a custom workflow, open, number their rows, keep `at` null and replay unchanged. Two processes opening one old store at once both succeed. Verified by test.
- `events` on a job file prints that work's lines only, and on a runs directory every work's. `from`, `stage` and `escalation` match `cycle.history`. The open marker prints no line. Verified by test.
- A custom-workflow cycle opened by 10-d replays from its recorded definition without the job file. A pre-10-d one prints null stages from a runs directory and real ones from its job file. Verified by test.
- A row of an unknown type prints as stored with null stages, and `events` exits 0. Verified by test.
- `--after` returns only later lines, with correct stages. `--follow` prints a line another process appends, and waits for a store that does not exist yet. Verified by test.
- `accept` and `cancel` record `source`: `owner` by default, or the `--source` value. An empty or multi-line source is refused, writing nothing. Verified by test.
- `observerKit` passes the comment-only example on a comment-only and a code diff. It fails an observer that throws on an unknown event, and one that acts on it. Verified by test.
- `observe` with the example observer runs a real `accept` that records the observer's source, and the cycle reaches ACCEPTED. Verified by test.

Constraints: zero dependencies. No paid calls. The default workflow's hash is unchanged. Stores written before 10-d still replay. The `Event` body gains only the optional `source`.
Non-goals: push delivery; the controller starting observers; a start event for reviewer runs (row 11); identity behind `source`; moving `proto/board.ts` onto the stream; named outcomes (Q8, parked).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-20 — drafted on `feat/10-d-observation-stream` (A-074). Not READY until the owner says go; no code before the design note is approved.
- 2026-10-20 — owner: “take all” (A-088). READY; design note approved with Q1 to Q6 as recommended.
- 2026-10-20 — built on `feat/10-d-observation-stream`, tests first, code head `05b550a`. Implementer's `npm test` (not independent): 412 tests, 388 pass, 0 fail, 24 skipped or todo (unchanged). Each done-when line has a test. `tests/fixtures/v2-store.sqlite` was written by the store at `c4db0d6`, before any 10-d code: a default cycle and an `ownerCheck` cycle. 27 mutants were checked and all were caught (runner: `/var/tmp/software_factory/10-d/mutants.py`). One survived at first: the race test did not make two processes reach the upgrade together. It now holds the write lock while both start. `lazy-review` found two shrinks (one `FOLLOW_MS`; a redundant `?? null`), both applied. Decisions the note left to the build, for the reviewers:
  - `observerKit` takes `makeObserver: () => Observer`, not an observer, so each case gets a fresh one, as `runtimeKit` takes `makeAdapter`. A shared observer would carry one case's state into the next.
  - The controller's own cancel in `develop` (a worktree it could not make) records `source: 'controller'`. Such a cancel written before 10-d has no source and reads as the owner's.
  - `--after` takes a non-negative integer. `--source` also refuses U+2028 and U+2029.
  - `events <job.json>` reads the job through `decisionConfig`, as `accept` does, so a job file whose layers do not load is refused.
  - `observe` passes no workflow to the reader, so a pre-10-d custom-workflow cycle gives it null stages. `events <job.json>` does pass one.
  - A pre-10-d controller writing to an upgraded store would leave `pos` null, and the reader would skip that row. One controller version runs on this machine, so this is noted, not handled.
  - `observe` does not catch: an observer that throws stops it, and it rejects with the error.
- 2026-10-20 — owner: “run the reviews” (A-089). Standard 1 started on `05b550a`.
- 2026-10-20 — standard 1 on `05b550a`: PASS, two minors, both reproduced by the reviewer:
  - A store file that exists but has no `events` table yet makes `openStream` throw `no such table: events`. `events --follow` and `observe` wait only for the file, so a poll that lands between the writer's open and its `CREATE TABLE` exits 2. The reviewer reproduced it with an empty `events.sqlite`.
  - `SHAPE` checks that `source` is a non-empty string, not a single line, so `store.append` stores `source: 'a\nb'`. Only the CLI refuses it.

  Notes: the reviewer's independent `npm test` matched (412 tests, 388 pass, 0 fail). No path was found that loses, reorders or misnumbers an event, or changes replay. The reviewer confirmed the race test catches the missing re-check. The v2 test's "replays unchanged" compares two opens after the upgrade; the stream tests pin the stages instead. The kit's refused-command case is only as strong as the observer's own cases. Adversarial started on `05b550a`; the two minors wait for its verdict.
- 2026-10-20 — adversarial on `05b550a`: PASS, one minor and two notes.
  - Minor, reproduced (probe `10-d/probes/adv/p3-late.kit.ts`): the kit's unknown-event case sends the unknown row only after a claim, so an observer that acts or throws on an unknown event only after a `developer_result` passes every case. The fix: also send the unknown row after each case's events.
  - Note: `--source` accepts U+0085, `\v`, `\f` and ESC, and no test pins the U+2028 and U+2029 refusal.
  - Note, reproduced: a raw seq 0 row whose body is JSON `null` makes `poll` throw. `load` throws on it too.

  Notes: the reviewer's independent `npm test` matched (412 tests, 388 pass, 0 fail). Five writers and a follower racing an upgrade of `v1-store.sqlite` lost, duplicated and reordered nothing: 486 rows, 486 lines, stages equal to `load().history`. SIGKILL during a 450 000-row upgrade left the old schema intact, and the next open upgraded it fully. Copies of `live-1` and other real stores replay the same through the stream. By reading: `openings()` opens read-only with no `busy_timeout`, as on main, so `accept`, `cancel` or `events <job.json>` during a write can fail with `database is locked`. The real `live-1` store was checked afterwards and is not upgraded. Review record so far: 1 standard (PASS) and 1 adversarial (PASS). Confirmed findings: 2 minors from standard 1, 1 minor and 2 notes from the adversarial review.
- 2026-10-20 — owner: “fix and merge” (A-090). Fix the five findings and the `openings()` busy timeout tests first, then merge without another review.
- 2026-10-20 — review findings fixed at `0a1b1c5`, tests first, each seen red for its reason, unreviewed (A-090):
  - `storeReady` in `src/stream.ts` is true only once the file holds an events table. `events` refuses a store without one, and `events --follow` and `observe` wait for it.
  - `isSource` in `src/lifecycle.ts` is the one rule: no control character (`\p{Cc}`, so C0, DEL and C1 with U+0085) and no U+2028 or U+2029. `SHAPE` and `--source` both use it; a test pins the CLI's own message.
  - The kit's unknown-event case also runs after each case's events. The adversarial reviewer's `late-acts` and `late-throws` observers now fail it (`tests/kits/observe-late.kit.ts`).
  - An open row whose body is not an object gives its cycle null stages; the reader goes on.
  - `openings()` sets `busy_timeout`, so `accept`, `cancel` and `events <job.json>` wait out another connection's exclusive lock.

  Seven more mutants were all caught (`10-d/mutants2.py`). Two needed a second look: the CLI's refusal survived at first, because the store refuses the same source, so the test now pins the CLI's message; and the first form of the observe mutant was caught by a broken import, so it was rewritten and is caught by the right test. A crashed mutant run left two `sf-observe-*` folders; they are deleted, and a clean run leaves none. Implementer's `npm test` on `0a1b1c5`: 419 tests, 395 pass, 0 fail. Review record: 1 standard (PASS) and 1 adversarial (PASS). Confirmed findings: 2 minors from standard 1; 1 minor and 2 notes from the adversarial review, all fixed. Owner interventions: 3 (A-088, A-089, A-090). Merged into main with `--no-ff`.
