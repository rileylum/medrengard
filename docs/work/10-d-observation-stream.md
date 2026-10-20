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
