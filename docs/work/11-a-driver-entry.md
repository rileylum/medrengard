# 11-a — One driver entry point

Route: Fast. A pure refactor with one design, already sketched and approved (A-112 item 2; `docs/research/2026-10-20/architecture.md` finding 2). Proposed tier: Light, one review (A-125), because no behaviour changes.

Goal: the loop, the owner's decisions and the CLI become functions that code can call in-process, so `resume`, `recover` and a tracker's `accept` (row 12) need no new seam.

Done when:
- `drive(store, cycleId, adapters, job, opts)` is exported from `src/run.ts` and replaces `resume`: it loads the cycle, refuses an unknown or QUEUED one with today's messages, runs `preflight` and the loop. `run` is `preflight`, `develop`, then the same loop. Verified by `tests/run.test.ts`, which changes only the imported name.
- `src/decide.ts` exports `acceptCycle(store, workId, sha, source)` and `cancelWork(store, workId, source)`, the rules now inside `main.ts` `accept` and `cancel`, with no printing. They throw today's messages and return the cycle or cycles after the event. Verified by a new `tests/decide.test.ts`, in-process: no open cycle, a cycle not at a human stage, a wrong or short SHA, a good accept, cancel of open cycles, and cancel of every ESCALATED cycle when none is open.
- `src/main.ts` exports `main(argv)`, which returns the exit code, and calls it only under `import.meta.main`. Importing `main.ts` runs nothing. Verified by test.
- The CLI's output, messages and exit codes do not change: `tests/main.test.ts` and `tests/stream.test.ts` pass unchanged.
- The guide still matches `src/`: `npm run test:learn` passes, and the guide's copies of `run.ts`, `resume` or the `accept`/`cancel` rules are updated where they exist (`learn/README.md`, "When you change src/").
- Plan row 11 gets its missing full stop before "Design inputs", and names its tickets.

Constraints: zero dependencies; no paid calls. No change to `lifecycle.ts`, `store.ts` or any event.
Non-goals (each is a behaviour change, so not in a Light ticket): a `resume` command in `main.ts`; `accept` driving on into a grant stage; `run_started` for reviewer runs (A-105 item 3); a producer for `head_changed` and `base_changed` (A-103); cycle paths in one module (11-b).
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result.

## Log
- 2026-10-21 — drafted on `feat/11-a-driver-entry` from A-112 item 2. Not READY until the owner says go and confirms the tier.
