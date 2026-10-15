# 04-b — One outcome per run; receive and the deadline cannot strand a cycle

Route: Fast. Fix ticket for 04-a's adversarial FAIL on `3ba5434` (A-021). Internal, reversible, one obvious design per finding.

Goal: whatever an adapter returns, rejects with, or does after its deadline, `execute` settles, writes exactly one outcome per run, and never overturns a transition the cycle already recorded.

Done when:
- A `run_failed` for a run whose result or verdict is already consumed changes nothing: `apply` ignores it, and the store does not write it (the dedup index is one row per run ID across result, verdict and run_failed); verified by a lifecycle test and a store test asserting stage and event count.
- A `failed` outcome with an empty or non-string `reason`, and an outcome that is not an object or has an unknown `status`, each record `run_failed` with a non-empty reason and escalate; `receive` does not throw; verified by test.
- An adapter that rejects with a value `String()` cannot convert, or throws synchronously, yields `run_failed` and `execute` settles before the deadline plus one second; verified by test.
- `execute` throws before writing anything when `deadlineMs` is not a positive safe integer at or below 2^31-1; verified by test with NaN, 0, -1, Infinity and 2^31.
- A reviewer run is not started unless the cycle's stage matches the role (`standard_reviewer` needs STANDARD_REVIEW, `adversarial_reviewer` needs ADVERSARIAL_REVIEW); `execute` and `receive` throw on a mismatch or an unopened cycle, and the adapter is never called; verified by test, including the adversarial-on-STANDARD_REVIEW case that 04-a miscounted.
- The timeout path aborts the adapter: the fake records `signal.aborted` and the hang test asserts it (04-a standard minor).
- `append` signals an unclassifiable event with a typed error, `UnclassifiableEvent`, and the controller matches on the class, not the message (04-a standard minor, 02-c note).

Constraints: zero dependencies. `src/runtime/spawn.ts` untouched. No retries, no relaunch, no real adapters. Schema: the unique index is renamed (`events_run_outcome`); no migration, nothing persisted exists yet.
Non-goals: a throwing abort listener inside an adapter (Node reports it as an uncaughtException the controller cannot catch; an in-process adapter that throws there is a bug to fix in the adapter). Owner cancel of a running `execute` (needs a handle; the controller ticket that runs cycles decides). The late-settle test stays as documentation.
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — owner: “Option 1, go” (A-021). Branch `feat/04-b-receive-hardening` stacked on 04-a at `ffd6ce4`.
