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
