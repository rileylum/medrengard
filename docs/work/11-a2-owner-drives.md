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
