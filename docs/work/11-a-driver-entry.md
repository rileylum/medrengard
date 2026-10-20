# 11-a — One driver entry point

Route: Fast. A pure refactor with one design, already sketched and approved (A-112 item 2; `docs/research/2026-10-20/architecture.md` finding 2). Proposed tier: Light, one review (A-125), because no behaviour changes.

Goal: the loop, the owner's decisions and the CLI become functions that code can call in-process, so `resume`, `recover` and a tracker's `accept` (row 12) need no new seam.

Done when:
- `drive(store, cycleId, adapters, job, opts)` is exported from `src/run.ts` and replaces `resume`: it loads the cycle, refuses an unknown or QUEUED one with today's messages, runs `preflight` and the loop. `run` is `preflight`, `develop`, then the same loop. Verified by `tests/run.test.ts`, which changes only the imported name.
- `src/decide.ts` exports `acceptCycle(store, workId, sha, source, where)` and `cancelWork(store, workId, source, where)`, where `where` names the runs directory and the job file for the refusals, the rules now inside `main.ts` `accept` and `cancel`, with no printing. They throw today's messages and return the cycle or cycles after the event. Verified by a new `tests/decide.test.ts`, in-process: no open cycle, a cycle not at a human stage, a wrong or short SHA, a good accept, cancel of open cycles, and cancel of every ESCALATED cycle when none is open.
- `src/main.ts` exports `main(argv)`, which returns the exit code, and calls it only under `import.meta.main`. Importing `main.ts` runs nothing. Verified by test.
- The CLI's output, messages and exit codes do not change: `tests/main.test.ts` and `tests/stream.test.ts` pass unchanged.
- The guide still matches `src/`: `npm run test:learn` passes, and the guide's copies of `run.ts`, `resume` or the `accept`/`cancel` rules are updated where they exist (`learn/README.md`, "When you change src/").
- Plan row 11 gets its missing full stop before "Design inputs", and names its tickets.

Constraints: zero dependencies; no paid calls. No change to `lifecycle.ts`, `store.ts` or any event.
Non-goals (each is a behaviour change, so not in a Light ticket): a `resume` command in `main.ts`; `accept` driving on into a grant stage; `run_started` for reviewer runs (A-105 item 3); a producer for `head_changed` and `base_changed` (A-103); cycle paths in one module (11-b).
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result.

## Log
- 2026-10-21 — drafted on `feat/11-a-driver-entry` from A-112 item 2. Not READY until the owner says go and confirms the tier.
- 2026-10-21 — owner: “Go on 11-a, and take your recommendations” (A-129). READY at Light tier. Plan row 11 also names where the gaps go: 11-a2 (`accept` drives on), `run_started` with 11-e, the `resume` command with 11-f.
- 2026-10-21 — implemented at `7b9548e`, tests first. Red: `tests/decide.test.ts` on the missing module; the `main.ts` import test on `main` running at import (usage printed, exit code set). `resume` is now `drive`; the inner loop is `loop`. `acceptCycle` and `cancelWork` take a `where` (`runsDir`, job file) so their refusals keep today's text; `humanStages` moved with them. One difference: `cancel` now prints its lines after every cancel is recorded, not between them, so an append that throws part way prints nothing for the cycles before it. Guide: `sim.html` and `controller.html` show `drive`, `loop` and `src/decide.ts`; a bad reference there fails `test:learn` (checked). Mutants on `decide.ts`, all caught: human-stage check removed, a short SHA accepted, the ESCALATED fallback removed, cancel taking settled cycles, accept's source dropped (`/var/tmp/software_factory/11-a/mutants.py`). `npm test` by the implementer, not independent: 456 tests, 432 pass, 0 fail, 19 skipped, 5 todo. `npm run test:learn`: 6 of 6.
- 2026-10-21 — Light review on `df2af87` (in-session subagent; prompt under `/var/tmp/software_factory/11-a/`): PASS. One minor: `cancel` prints after every cancel is recorded, not between them; a behaviour change only when an append throws part way, untested (`src/main.ts:132`). Notes: the done-when signatures lacked `where` (fixed); `learn/demos/sim.js:571` still named `main.ts` (fixed); the guide demo's cancel on an ESCALATED cycle cancels only that one, while `cancelWork` cancels every ESCALATED cycle, a drift older than this ticket and left for the guide stand-ins ticket. Reviewer's `npm test` at the SHA: 456 tests, 432 pass, 0 fail; `test:learn` 6 of 6; removing the `import.meta.main` guard failed the new test. The reviewer left no files.
- Next: owner to decide the minor (accept, or print as each cancel is recorded), then merge.
