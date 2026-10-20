# 11-a2 — An owner command drives the cycle on

Route: Design. It sets the rule 11-d's owner moves build on (A-129), and has real alternatives. Tier: Trust (2 standard + 1 adversarial through `claude -p`, A-125), because it runs grant stages from the owner's command.

Goal: after the owner's `accept`, a stage the loop runs, such as a grant stage, runs in the same command; a refusal writes nothing.

Design note: [2026-10-21-owner-drives.md](../design/2026-10-21-owner-drives.md). `decideAndDrive(store, cycleId, event, ready)` in `src/run.ts` works out the stage the event leads to with `apply`, and only when the loop runs that stage does it build adapters and run `preflight`, before recording the event.

Done when:
- In a workflow with a developer, checks, a reviewer, a human stage and then a grant stage, `main.ts accept` runs the grant stage, the cycle ends ACCEPTED, and the command exits 0. Verified by test, end to end through `main.ts`.
- A grant stage that fails after accept escalates the cycle; `accept` prints the escalation and exits 1. Verified by test.
- When the grant is not given, or the sandbox cannot start, `accept` exits 2 with `preflight`'s message, and the store holds no `accept`. Verified by test.
- With the default workflow, `accept` builds no adapter and reads no runtime module: a job whose runtime module is missing still accepts. Its output and exit codes are unchanged (`tests/main.test.ts` passes unchanged). Verified by test.
- `decideAndDrive` never calls `ready` when the event leads to a stage the loop does not run, and records nothing when `ready` or `preflight` throws. Verified by in-process tests.
- `cancel` is unchanged.
- The guide's controller room says `accept` runs the next stage when the workflow has one; `npm run test:learn` passes.

Constraints: zero dependencies; no paid calls. No new event type, and no change to `apply`.
Non-goals: a `resume` command (11-f); refusing a changed job file (A-105 item 2; 11-c, 11-f); a command that sends `request_changes`; 11-d's owner moves; the guide demo's cancel drift (Guide stand-ins row).
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result.

## Log
- 2026-10-21 — drafted on `feat/11-a2-owner-drives` (A-129). Not READY until the owner approves the design note and says go.
- 2026-10-21 — owner: “go approved” on the design note and the ticket (A-131). READY at Trust tier.
- 2026-10-21 — implemented, tests first; code head `28de902`. Red: the three end-to-end tests stopped at `Stage: MERGE` (accept recorded and returned); `tests/decide.test.ts` on the missing `decideAndDrive` export. The default-workflow test (a runtime nobody registered) passed when written: it guards today's behaviour, and its red step is the `loopRuns => true` mutant. `decideAndDrive` (`src/run.ts`) applies the event in memory; when `loopRuns` the stage it leads to, it calls `ready`, runs `preflight`, then appends and calls `loop`. `acceptEvent` (`src/decide.ts`) holds the refusals and returns the event; `acceptCycle` records it. `main.ts`: the run command's report is `report()`, shared with a driven accept; `jobOf` and `optionsOf` build the job and options for both. A driven accept that ends ACCEPTED prints the report, then the merge lines, and exits 0; at a further human stage it prints the run command's next steps and exits 0; otherwise 1. Not covered by a test: two processes changing the cycle between `decideAndDrive`'s load and its append (the append re-applies, and `loop` acts on whatever stage results; a stage it would run but did not preflight is not reached, because `loop` only runs after a preflight). Mutants, all caught (`/var/tmp/software_factory/11-a2/mutants.py`): preflight after the append; `loopRuns` always true, always false, and command stages only (survived at first; the agent-stage test was added for it); the stage before the event instead of after; a driven ESCALATED exit 0; the merge lines dropped. Guide: the controller room says accept drives on and shows `decideAndDrive`. Implementer's `npm test` on `76e7e29`, not independent: 463 tests, 439 pass, 0 fail, 19 skipped, 5 todo; `test:learn` 6 of 6 on `28de902`.
