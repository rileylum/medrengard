# 11-f2 — Resume: drive an open cycle on, never relaunching a started run

Route: Design, under 11-f's note. It changes `drive`, the open row and `main.ts`'s commands (A-105 items 1 and 2). Tier: Trust (2 standard + 1 adversarial through `claude -p`, A-125): the controller, the engine's driver and the store.

Goal: `resume <job.json>` drives the work's open cycle from its stored stage, and refuses a cycle with a started run that has no outcome or whose job changed.

Design note: [2026-10-23-recover.md](../design/2026-10-23-recover.md).

Done when:
- `drive` refuses a cycle with a started run and no outcome, naming the run and `recover`; nothing is appended and no run launches. Verified by test, and by a mutant that drops the check.
- `resume` on a cycle at an agent stage with no started run, or at a command stage, drives it on, holding 11-f's lock through `drive`. `drive` waits for the lock as `run` does (5 s); a work another live process holds past the wait gets the lock's message, and nothing is appended or launched. At a human stage or ESCALATED it prints the owner's next commands and drives nothing. Verified by test, with a holder that outlasts the wait.
- The open row records `job`, a SHA-256 of the ticket text and `checks`. `resume` refuses a cycle whose ticket or checks changed, naming which. A cycle with no `job` resumes with a printed warning. Stores written before 11-f2 replay unchanged. Verified by test.
- Parked row 48: `cycles(workId)` reports a cycle the store cannot replay instead of throwing for the whole work; `open` still refuses while one is listed; `accept`, `cancel` and moves on another cycle work. Verified by test.
- Parked row 51: `moveEvent` loads only the cycle the move names, so a cycle under another workflow does not block it. Verified by test.
- Parked 11-f adversarial rows: the run folder keeps a `launch` file, written at launch beside `stdin`, with the stage deadline and the extension module's hash. Recover records `timeout` for a run whose `exit` was written more than that deadline after its `stdin`, and an outcome it records carries the module hash kept at launch. The `clearEmptyUnits` test stops each unit in its own call; tests for a finished run whose `stdout` is still held, and for `recover`'s exit code 1. Each verified by test (the timeout and the hash red first).

Constraints: zero dependencies; no paid calls in tests. 11-f merged first.
Non-goals: the config-hash form of the job check (Owner tools row); relaunching a crashed run.
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result.

## Log
- 2026-10-23 — drafted on `feat/11-f-recover` with 11-f. Not READY until the owner answers 11-f's design questions and says go; built on its own branch `feat/11-f2-resume` after 11-f merges.
- 2026-10-23 — owner took the design note's recommendations (11-f log). READY at Trust tier, to build after 11-f merges.
- 2026-10-23 — owner, on the two gaps the 11-f handover raised: “take your recommendations”. (1) `resume` holds the work's lock through `drive`, waited for as `run` waits; a work held past the wait gets the lock's message. (2) The run folder keeps the deadline and the module hash at launch, in one `launch` file; recover compares `exit`'s mtime with `stdin`'s. Done-when list updated. Also from the owner, on 2026-10-23: “happy to have 11a come on I think - we can start stress testing this properly.” And, asked whether the spec catch-up docs ticket runs before 11a: “Yes run it first.” Order after 11-f2: the spec catch-up ticket, then 11a (live runs: read `docs/live-runs.md` first). Branch `feat/11-f2-resume` off `c941916`.
