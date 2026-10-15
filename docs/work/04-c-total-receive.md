# 04-c — receive and the deadline are total over any value an adapter can produce

Route: Fast. Fix ticket for 04-b's adversarial FAIL on `8664c1b` (A-022). Internal, reversible, one obvious design.

Goal: no JavaScript value an adapter returns, rejects with, or hands back with throwing getters or traps can keep `execute` from settling or leave a cycle with a run that has no outcome; and a reviewer run whose cycle moved to a terminal or escalated stage while it ran is recorded, not thrown.

Done when:
- An adapter that rejects with an object whose `Symbol.toStringTag` getter throws, or with a Proxy whose `get` trap throws, yields `run_failed` and `execute` settles within one second; verified by test.
- An outcome object with a throwing `status` getter, a Proxy outcome with a throwing trap, and a `completed` claim with a throwing `head` getter each record `run_failed` with a non-empty reason, `execute` settles, and a following `execute` on the cycle is not blocked by an active run; verified by test.
- The adapter contract is plain data: `receive` takes `structuredClone` of the outcome first, so getters, Proxies, functions and symbols never reach the controller's reads; a value that cannot be cloned is `run_failed` with reason `adapter outcome is not plain data`; stated in `adapter.ts` and verified by the tests above.
- A reviewer run started in the right stage whose cycle was cancelled, escalated or accepted before it settled: `execute` returns the Cycle (the outcome is appended and `apply` ignores it) and does not throw; verified by test with `cancel` and `head_changed` appended mid-run. A live cycle in the wrong review stage still throws (the existing test), because `apply` attributes a verdict to the stage and would miscount it.

Constraints: zero dependencies. `src/runtime/spawn.ts`, `src/lifecycle.ts`, `src/store.ts` untouched. No retries, no real adapters.
Non-goals: a throwing abort listener (04-b non-goal stands). Role on the verdict event (would let a concurrent reviewer's late verdict be recorded instead of thrown; a lifecycle change for a later ticket if pools need it).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — owner: “option 1 go” (A-022). Branch `feat/04-c-total-receive` stacked on 04-b at `f39698c`.
