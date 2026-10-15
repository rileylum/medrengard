# 04-a — Adapter interface, fake adapter and the controller's receive path

Route: Design. This is the seam every runtime (claude, pi, future) and the controller build on, and there are real alternatives for where it sits.

Goal: the controller can start a run through an adapter, bound it with a deadline, and turn whatever comes back — a normal claim, a malformed one, a timeout, a cancel, or a redelivery — into exactly one correct lifecycle transition, recorded through the store.

## Design note

### Seam

`src/adapter.ts` holds the interface. An adapter starts one run and settles with a normalised outcome. It knows nothing about cycles, stages or events.

```ts
export interface RunRequest {
  runId: string;      // minted by the controller, crypto.randomUUID()
  role: Role;         // from lifecycle.ts
  prompt: string;     // the contract plus, for reviewers, diff, SHA and evidence
  cwd: string;
}

export type RunOutcome =
  | { status: 'completed'; claim: unknown; sessionId?: string }  // the runtime returned something; claim is parsed JSON, unvalidated
  | { status: 'failed'; reason: string }                          // never started, crashed, or ended with no claim
  | { status: 'cancelled' };                                      // we aborted it and it stopped

export interface Adapter {
  readonly name: string;
  /** Must settle after `signal` aborts. The controller does not wait past its deadline either way. */
  start(req: RunRequest, signal: AbortSignal): Promise<RunOutcome>;
}
```

`src/controller.ts` owns the only call to `EventStore.append` outside tests:

```ts
export async function execute(store: EventStore, cycleId: string, adapter: Adapter,
                              req: Omit<RunRequest, 'runId'>, deadlineMs: number): Promise<Cycle>
```

What `execute` does, in order: mint the run ID; append `claim` for a developer; start the adapter with an `AbortSignal` that fires at `deadlineMs`; race the adapter against the deadline; map the outcome to one event and append it; return the Cycle the store returns. Mapping: `completed` becomes `developer_result` or `verdict` built from the claim for that role, and a claim the store cannot classify (store throws `unclassifiable`) becomes `run_failed` with reason `malformed result`; `failed` and `cancelled` become `run_failed`; the deadline winning becomes `run_failed` with reason `timeout`, whether or not the adapter settles afterwards. A later settle from a timed-out run is dropped. Owner cancel is the existing `cancel` event plus abort; the run's outcome is ignored because the cycle is terminal.

One new lifecycle event: `{ type: 'run_failed'; runId: string; reason: string }`. In any non-terminal stage it escalates with the reason; a duplicate run ID is ignored like a result. The spec's "relaunch once per cycle" for infrastructure failures is deferred until a test or an incident needs it (D-016).

The store's calling convention changes (02-c parked, major): `append(cycleId, event): Cycle` applies the canonical parsed event to the replayed cycle and returns the new Cycle; a deduplicated redelivery returns the current Cycle unchanged. Callers never apply the object they passed in. `requireId` rejects ill-formed strings (`isWellFormed()`), so lone-surrogate IDs cannot collide in the index (02-c parked, minor).

Fake adapter, `tests/fake-adapter.ts`: scripted per call — settle with a given outcome after `n` ms, or hang until aborted then settle `cancelled`, or hang and ignore the abort. Tests observe only `execute`'s return value and `store.load()`.

### Alternatives

1. **Adapter emits lifecycle `Event`s directly** (seam at the Event). Thinner controller, but every adapter must know the state machine and the role-to-event mapping, and `run_failed` and dedup logic get written three times. Rejected: less locality.
2. **Seam at the process** — adapters are a command line plus an output parser, the fake is a fixture script, and `spawnRuntime` is the interface. Exercises the real path in every test, but the five outcome kinds become child-process timing tests (slow, flaky) and the seam carries pipes, exit codes and signals that the controller has no use for. Rejected: shallow. `spawnRuntime` stays as what real adapters are built on, behind the seam.

### Parked lines

| Line | How 04-a covers it |
| --- | --- |
| 02-c major, `append` calling convention | `append` returns the Cycle; replay test with `new String('PASS')` as a verdict; controller uses only the returned Cycle |
| 02-c minor, lone-surrogate IDs | `requireId` uses `isWellFormed()`; test with a lone surrogate |
| 02-b minor, claim reuses a consumed run ID | Controller mints run IDs with `randomUUID()`; `apply` unchanged. Test: two `execute` calls on one cycle produce distinct run IDs |
| 02-c note, `JSON.stringify` TypeError in append | `execute` catches only the `unclassifiable` error from append and maps it to `run_failed`; anything else propagates and stops the controller |
| 03-a minor, deadline on every launch | `deadlineMs` is a required argument of `execute`; the deadline wins even against an adapter that ignores abort (test) |
| 03-b major, process-tree escape | **Proposed: move to 04-b** (real claude and pi adapters). `systemd-run --user --scope` plus `cgroup.kill` works unprivileged on this machine and kills a `setsid` descendant (probed 2026-10-16). It belongs where `spawnRuntime` is wrapped into a real adapter, which 04-a does not do |
| 03-b minor, `cancel()` guard, cwd/empty command, `ready`, `detached` | **Proposed: move to 04-b** with the line above |

Done when:
- A `completed` outcome with a well-formed developer claim moves DEVELOPING to VERIFYING, and with a well-formed verdict moves STANDARD_REVIEW on; verified by test through `execute` and `store.load()`.
- A `completed` outcome whose claim the store cannot classify records `run_failed` and the cycle is ESCALATED with reason `malformed result`; verified by test with a non-array artifacts, missing artifacts and non-object claims. A missing head is a well-formed result that `apply` rejects (SC-07) and escalates as such; verified by the same test.
- An adapter that has not settled by `deadlineMs` yields `run_failed` with reason `timeout` within `deadlineMs` plus one second, both for an adapter that honours abort and one that ignores it; a settle arriving later changes nothing; verified by test.
- A `cancelled` or `failed` outcome escalates with its reason; verified by test.
- The same run's outcome delivered twice changes nothing: the second `append` returns a Cycle deep-equal to the first and the event count is unchanged; verified by test.
- `append` returns the Cycle, and a verdict passed as `new String('PASS')` replays to the same state the caller was returned; `requireId` rejects a lone-surrogate ID; existing store tests updated for the new return type; verified by test.
- `run_failed` is in the `Event` union with a shape check and a scenario in `tests/scenarios.ts`; a duplicate `run_failed` is ignored; verified by test.
- `npm test` has no new live tests and no new fixtures that spawn processes.

Constraints: zero dependencies. `src/runtime/spawn.ts` is not touched. No retries, no relaunch, no real adapters. `apply` changes only to add `run_failed`.
Non-goals: claude and pi adapters, cgroup cancel, prompt assembly for reviewers, reconciliation on restart, the 02-b `open` guards and the 02-a store notes (not touched here).
Verification: `npm test`, run by the owner on the reviewed SHA. Then `lazy-review` on the diff before the standard review.

## Log
- 2026-10-16 — branch `feat/04-a-adapter-interface` off main at `cecdb5b`. Ticket drafted on the Design route; awaiting owner read and go, and a decision on moving the two 03-b lines to 04-b.
- 2026-10-16 — owner: “go with your recommendations” (A-020). The two 03-b lines move to 04-b.
- 2026-10-16 — tests first (`tests/controller.test.ts`, `tests/fake-adapter.ts`, RF-01/RF-02 scenarios, two store tests; 7 red), then `src/adapter.ts`, `src/controller.ts`, `run_failed` in lifecycle.ts, `append` returns the Cycle. Two deviations from the note: `execute`'s last argument is `{ deadlineMs, base? }` (the developer claim needs the base SHA, which the adapter does not); a claim with a missing head is a well-formed `developer_result` that `apply` rejects itself (SC-07), so it is recorded as such and escalates with `missing commit`, not as `run_failed` — the done-when wording is corrected. Mutation-checked: run_failed dedup in the store, the dedup key escaping, the refused-claim guard and the error-propagation guard each fail a test when removed; the `consumed` bookkeeping in `run_failed` did not and was deleted (a redelivery always meets an ESCALATED cycle). Lazy-review: three cuts applied. Implementer-run: `npm test` 62 tests, 47 pass, 10 skipped, 5 todo, 0 fail. Awaiting owner-run tests, then standard review 1.
- 2026-10-16 — owner-run on 3ba5434: `npm test` 62 tests, 47 pass, 10 skipped, 5 todo, 0 fail. Standard review 1 on 3ba5434: PASS, 0 major, 3 minor (`ac.abort()` is not observed by any test; the malformed path matches the error message prefix, which the 02-c note warned against; `deadlineMs` outside `setTimeout`'s range is not validated), 3 notes (`run_failed` has no consumed guard; no entry point for owner cancel of a running `execute`; the late-settle test documents rather than guards). Adversarial on 3ba5434: FAIL, 3 major, 4 minor, all reproduced by the implementer (`/var/tmp/software_factory/04-a/probes/majors.mts`). Majors: a `run_failed` for a run whose result or verdict was already consumed is not ignored and overturns the recorded transition (the design note said it would be ignored like a result; the per-type unique index lets both rows land); a `failed` outcome with an empty `reason` throws `unclassifiable` from `receive` after the claim was appended, leaving the cycle in DEVELOPING with the run active and every later `execute` ignored; an adapter rejection with a value `String()` cannot convert throws inside the handler after `clearTimeout`, so `execute` never settles and the deadline does not hold. Minors: `deadlineMs` of NaN, negative, Infinity or above 2^31-1 fires at once; a throwing abort listener is an uncaughtException; reviewer runs start without checking the cycle's stage; an `adversarial_reviewer` run on a STANDARD_REVIEW cycle is counted as the standard verdict because `toEvent` drops the role. Notes: no `append`/`load()` divergence found with `__proto__`, getters, Proxies or NUL IDs. Review budget: standard 1 of 2 used, adversarial 1 of 1 used. Stopped; owner decides. Full verdicts under `/var/tmp/software_factory/04-a/`.
- 2026-10-16 — owner: “Yep I agree I think, we should really just accept it here and move on…” (A-023). Merged with 04-b and 04-c. Reviews: standard 1 PASS, adversarial 1 FAIL (fixed in 04-b). Owner interventions: 3 (go, option 1, A-023).
