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
- A `completed` outcome whose claim the store cannot classify records `run_failed` and the cycle is ESCALATED with reason `malformed result`; verified by test with a missing head, a non-array artifacts and a non-object claim.
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
