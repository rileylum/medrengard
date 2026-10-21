# 11-d2 — An escalated cycle waits for the owner

Route: Design. It makes ESCALATED a stage that can move again, which changes the spec's core rules 2 and 3 (A-114, A-109 B). Tier: Trust (2 standard + 1 adversarial through `claude -p`, A-125): the engine and the store. Stacked on 11-d.

Goal: the owner answers an escalated cycle in place with `retry`, `overrule` or `route`, each bound to the candidate head, carrying a reason, and driven on as 11-a2's commands are.

Design note: [2026-10-21-owner-moves.md](../design/2026-10-21-owner-moves.md).

Done when:
- `owner_decision { action, head, reason, stage?, source?, commandId? }` is an event. `apply` acts on it only in ESCALATED and escalates it elsewhere. Verified by test.
- `retry` enters the stage the cycle escalated from; spent budget stays spent. `overrule` refunds one unit at the stage of the last FAIL verdict for the candidate and enters it. `route` enters a named workflow stage. Each one whose condition does not hold leaves the cycle ESCALATED with a note. Verified by test per move and per condition, each with a mutant.
- Each move consumes the cycle's developer runs that have no outcome; a late outcome from one is ignored as a duplicate, and `fix` then runs. Verified by test.
- `moveEvent` (`src/decide.ts`) refuses, writing nothing: no escalated cycle; a head other than the candidate; a spent budget; a stage the driver cannot run (commit stage without a FAIL for the candidate, review stage without a verification of the candidate, a grant stage `headGate` refuses); an unknown or engine stage for `route`. Verified by test.
- The store refuses a move on a cycle that another cycle names as its parent, or while another cycle of the work is open, checked under the write lock. Verified by test with two processes (a child `open` and a `retry` on its parent).
- `node src/main.ts retry | overrule | route` record the move with `after` and drive on through `decideAndDrive`; `preflight` runs before the move is written. Verified by test with fake runtimes, including live run 1's case: a reviewer FAIL, a developer dispute, then `overrule` reruns the review on the same head and the cycle reaches AWAITING_ACCEPTANCE.
- After an `overrule`, the next reviewer's prompt holds the owner's reason. Verified by test.
- `SETTLED` is ACCEPTED and CANCELLED; `STOPPED` holds today's three stages, and every current use moves to it unchanged; `unsettled()` lists ESCALATED cycles. Verified by the existing tests, unchanged, and one for `unsettled()`.
- No existing log moves stage; `ENGINE_VERSION` stays 1. Verified by 11-d's fixture test.
- The spec's core rules 2 and 3, the Decision row and the open-cycle rule describe the moves. The guide's shims and simulator follow; `npm run test:learn` passes and the simulator runs an escalated ticket through a `retry` with no console errors.
- Probe: a job whose `base` is `sf/<parentCycleId>` starts the developer from the parent's candidate. The result is recorded in the log.

Constraints: zero dependencies; no paid calls. Existing tests pass unchanged, except where the owner's word changes one.
Non-goals: `fix` with chosen findings and "continue at" (A-108's ticket); a `moves` key in the workflow (A-124); a cap on overrules (`engine.md` P5); fencing reviewer runs (11-e); resolving a diverged cycle (11-f).
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result.

## Log
- 2026-10-21 — drafted on `feat/11-d-owner-moves` with 11-d. Not READY until the owner answers the design note's questions and says go.
