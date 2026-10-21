Branch: feat/11-d-owner-events-bound (11-d); feat/11-d2-owner-moves (11-d2)

# An escalated cycle waits for the owner; owner events bound to a SHA and deduplicated (tickets 11-d, 11-d2)

## Problem

`apply` ignores every event in ESCALATED except `cancel` (`src/lifecycle.ts`, `apply`). The owner's only choices are cancel, or a child cycle that clones the base again and repeats the paid developer run (`engine.md` G1). In live run 1 a reviewer misread a check, the developer disputed, and the cycle escalated. The owner agreed with the developer, and no command could keep the work. A-114 makes ESCALATED a stage that waits for the owner's move.

Three gaps ride with it:
- **G7, A-123 item 1.** `request_changes` carries no head, and no owner event carries an ID. A redelivered rejection can land on a candidate nobody has read (`engine.md` G7, reproduced). Observers deliver at least once (10-d), and row 12's webhooks redeliver.
- **The overlapping-accept race** (`docs/work/parked.md`, 11-a2 row; A-132). `decideAndDrive` loads the cycle, runs `preflight`, then appends. Two `accept` commands can both pass the load. The first runs the grant stage, and the second escalates the cycle under it.
- **Runs left active.** `fix` refuses a cycle with a developer run that has no outcome (`src/developer.ts`, `fix`). `apply` ignores outcomes in ESCALATED, so a run cut off by an escalation never gets one. A `retry` into the commit stage would refuse forever.

Facts the design must respect:
- Since 11-c, `append` replays, applies and inserts under one `BEGIN IMMEDIATE`, and each row stores the stage `apply` gave it. A stored stage that the replay disagrees with throws `ReplayDiverged`.
- `ENGINE_VERSION`'s rule: bump it when `apply` would move any existing log to another stage. The v1 fixture has 18 cycles (accept, head_changed, base_changed, reject_dispatch, run_failed among them). The v2 fixture has 2 cycles. Neither has a `request_changes`, and no command has ever sent one.
- 11-a2's rule: every owner command records its event and then drives the cycle until it stops. `preflight` runs before the event is written, so a refused command writes nothing.
- The store keeps one outcome per run through a unique index on `(cycle_id, run_id)`; `run_id` holds the JSON-escaped run ID. Nothing outside `store.ts` reads that column.
- Reviewer runs are not recorded until they return. `run_started` for every run is 11-e's (A-105 item 3).

## The split

Recommended: two tickets on two branches, 11-d first.

- **11-d: owner events bound and deduplicated.** `request_changes` carries `head`; every event from outside a run may carry `commandId`; `append` refuses a stale load. It closes the parked race. Size S.
- **11-d2: the owner's moves.** `owner_decision` and its moves, the CLI verbs, and the spec's rules 2 and 3. Size M. It builds on 11-d: every move carries a `commandId` and is appended with the stale-load check.

Each ticket gets its own reviews (Trust tier, 2+1).

## Interface

```ts
// src/lifecycle.ts
export type Event = (
  // …
  | { type: 'accept'; head: string; source?: string; commandId?: string }
  | { type: 'request_changes'; head: string; source?: string; commandId?: string }   // head: 11-d
  | { type: 'cancel'; source?: string; commandId?: string }
  | { type: 'head_changed'; head: string; commandId?: string }
  | { type: 'base_changed'; base: string; commandId?: string }
  /** 11-d2. The owner's move on an ESCALATED cycle (A-114). `stage` only for route. */
  | { type: 'owner_decision'; action: 'retry' | 'overrule' | 'route'; head: string; reason: string; stage?: Stage; source?: string; commandId?: string }
) & { step?: string };

/** The key the store deduplicates on: a run's outcome by run ID, an event from outside a run by command ID. */
export function dedupKey(e: Event): string | undefined;   // replaces outcomeRunId

/** Stages no run acts on: a run in flight stops, and the loop returns to the owner. Today's SETTLED, renamed. */
export const STOPPED: readonly Stage[];   // ESCALATED, CANCELLED, ACCEPTED
/** Stages nothing moves again (A-114): an escalated cycle waits for a move. */
export const SETTLED: readonly Stage[];   // CANCELLED, ACCEPTED

// src/store.ts
/** The cycle has rows the writer had not loaded; nothing was written. */
export class StaleLoad extends Error {}
class EventStore {
  /** `after`: the history length the writer loaded. Checked under the write lock (11-d). */
  append(cycleId: string, event: Event, opts?: { after?: number }): Cycle;
}

// src/decide.ts
export function requestChangesEvent(store, workId, sha, source, where): { cycleId; event; after };   // 11-d
export function moveEvent(store, workId, move: Move, where): { cycleId; event; after };            // 11-d2

// src/run.ts
export function decideAndDrive(store, cycleId, event, ready, after?: number): Promise<…>;
```

CLI (`src/main.ts`). Every owner command takes `--source` and `--command-id`. Without `--command-id`, no ID is recorded: a fresh random one would deduplicate nothing (A-140).

```
accept <job.json> <sha>
request-changes <job.json> <sha>                          # 11-d
cancel <job.json>
retry <job.json> <sha> --reason <text>                    # 11-d2
overrule <job.json> <sha> --reason <text>                 # 11-d2
route <job.json> <sha> <stage> --reason <text>            # 11-d2
```

The observer kit (`src/kits/observe.ts`) passes `<source>:<pos>` as the command ID: the stream position of the line being handled. An observer that restarts and handles the same line again sends the same ID.

## 11-d: binding, deduplication and the stale-load refusal

- **`request_changes` carries `head`.** `isEvent` requires it. `apply` escalates one that names a SHA other than the candidate, as it does for `accept`. No log holds a `request_changes`, so no existing log moves and `ENGINE_VERSION` stays 1.
- **`commandId`.** The store puts `JSON.stringify({ commandId })` in the `run_id` column, so the existing unique index deduplicates it. A run key is a JSON string and starts with `"`; a command key starts with `{`, so the two cannot collide. A second event with the same command ID on the same cycle writes nothing and returns the cycle as it is, as a second run outcome does. The ID is unique per cycle, not per store: one `cancel` command may cancel several escalated cycles under one ID.
- **The stale-load refusal.** A writer that decided on a loaded cycle passes `after: cycle.history.length`. Inside `append`'s transaction, the store throws `StaleLoad` when the replayed history is longer, and writes nothing. The refusal names the cycle and both lengths. The CLI tells the owner to run the command again.
  - `accept`, `request-changes` and every move pass `after`, taken from the load their refusals checked.
  - `cancel` does not. It is meant to land mid-run (07-d), and it wins in any stage.
  - Run outcomes do not. Other events may land while a run works, and refusing an outcome would lose a paid run.
- **What it closes.** In the race, two `accept` commands both load at length n. The first appends and drives on. The second's append finds n + 1 rows and throws `StaleLoad` before anything is written, so the grant stage runs once and the cycle never reads ESCALATED under it. The parked row asked for "stage or last seq". The history length is the last seq, and it also catches an event that left the stage unchanged.

## 11-d2: the moves

`owner_decision` acts only in ESCALATED. Elsewhere `apply` escalates it, as it does an `accept` outside a human stage. In ESCALATED, a move whose conditions do not hold is recorded with a note and leaves the cycle where it is. `decide.ts` refuses it before anything is written, so only a raw write reaches that case.

| Move | Condition (refused by `moveEvent`) | What `apply` does |
| --- | --- | --- |
| `retry` | The cycle escalated from a workflow stage, not from QUEUED. That stage's budget is not spent. | Enters the stage the cycle escalated from (the `from` of the last history entry that entered ESCALATED). Spent budget stays spent. |
| `overrule` | The cycle's last verdict is a FAIL for the candidate head (A-109 B). | Refunds one unit of the budget at the stage that recorded the FAIL, then enters that stage. |
| `route <stage>` | `stage` is a workflow stage, not an engine stage. Its budget is not spent. The driver can run it (below). | Enters `stage`. |
| `cancel` | As today. | As today. |

Every move:
- **Names the candidate head.** `apply` refuses a move whose head is not the candidate. A cycle that escalated before its first commit has no head, so only `cancel` or a child cycle applies.
- **Carries a reason.** It is a non-empty string and is recorded. `report` and the stream print it through `printable`.
- **Consumes every developer run that has no outcome.** A late outcome from such a run is then ignored as a duplicate, and `fix` is not blocked by a run that will never answer.
- **Drives on.** It goes through `decideAndDrive`, so `preflight` runs before the move is written (11-a2's rule).

**What the driver can run.** `moveEvent` predicts the next cycle with `apply` (pure), then checks the step's own precondition:
- A commit stage needs a last verdict that is a FAIL for the candidate (`fix`).
- A review stage needs a last verification for the candidate (`review`).
- A grant stage needs `headGate`.
- A human stage needs nothing.

Without these checks, the loop would throw at once and escalate the cycle again with `reject_dispatch`. No paid run would start, but the owner would see a second escalation where a refusal would do. When A-108's ticket lets a commit stage run without a FAIL, its rule here goes too.

**Overrule shows its ruling to the next reviewer** (A-109 B). `review` adds the owner's reason to the prompt, folded to one line, when the latest overrule is for this stage and this head. It sits inside the prompt's delimiters, as findings do.

**Where a move is refused while other cycles live.** A move is refused when another cycle of the work is open, or when another cycle names this one as its parent. "Start over" was chosen there, and reviving the parent would give the work two live cycles. `append` checks both under the write lock, for `owner_decision` only. This is the store's copy of the one-open-cycle rule, as `open` holds it.

### The A-114 moves this ticket does not build

- **`accept with risk`.** Recommended: no separate action. `route` to the human stage with the reason, then `accept` as usual. The head is checked by `accept`, and a grant stage after the human stage still runs. A workflow without a human stage has nothing to accept into, and the owner cancels.
- **`fix` chosen findings, then continue at a named stage.** This needs structured findings (A-109 A) and commit-stage inputs (A-108, A-117), so it is deferred to that ticket. Today `route` to the commit stage after a FAIL runs a fix on all of the FAIL's findings.
- **A child cycle from the parent's candidate.** This may need no code: the job's `base` can name `sf/<parentCycleId>`, which `land` wrote into the owner's repository. 11-d2 probes it. If the mirror refuses a base on `sf/*` (11-b2 keeps `sf/*` out of the mirror), the option becomes a line on the Housekeeping row.

## What moves when ESCALATED leaves SETTLED

Every use of `SETTLED` today means "no run acts on this stage". The checker's path rule, `checkWorkflow` and `replayCheck` transition targets, the controller's abort poll and `requireStage`, the store's one-open-cycle rule, `acceptEvent`, and the guide's simulator all mean that. They keep that meaning under the name `STOPPED`, so their behaviour does not change. `SETTLED` becomes ACCEPTED and CANCELLED, with one user: `unsettled()`, which now lists ESCALATED cycles. `recover` (11-f) leaves them to the owner, as A-105 item 3 says. `openChild` and the store's parent rule are unchanged: a child still needs an ESCALATED parent.

## Engine version

No bump. `owner_decision` is a new type, and `isEvent` refused unknown types before 11-d2, so no stored log holds one. In ESCALATED, every older event is still ignored. Consuming runs happens only inside a move. `request_changes` appears in no log. A test replays every v1 and v2 fixture cycle and compares each stage with the stage main's `apply` gives. 11-c's stage column catches anything the fixtures miss on a newer store. An older binary that reads a log with a move fails closed: it ignores the move, and the stored stage then throws `ReplayDiverged`.

## Extension point (A-113, A-124)

None now. The core holds the moves, and the default lets the owner use all of them. Whether a workflow offers a move is policy. The first workflow the owner runs that must forbid one would add a `moves` key to the workflow: allowed actions, and allowed `route` targets per stage. An observer may already send `retry` with its own source (A-114 item 4), which gives opt-in automatic relaunch without changing A-105.

## Room for 11-f's diverged cycle

A move is an event, and an event needs a cycle that replays. A diverged cycle (the parked 11-c note) cannot take one. Resolving it is a store-level act for `recover` (cancel without replay, or reopen under the current engine), not a move. Nothing here blocks it. `owner_decision.action` is an open set, so a later action can be added without a new event type.

## Alternatives

1. **One ticket.** It is the plan row's wording. Rejected for a larger diff under one review budget: 11-d's three changes are separable and close a parked race on their own. The moves depend on them, not the other way round.
2. **A `command_id` column with its own unique index.** It is clearer in the schema. Rejected for a second column migration under the lock, the 11-c adversarial's class of race, when the existing index already has the semantics: first wins, a duplicate writes nothing.
3. **Stale-load check on the stage alone.** It is less strict. Rejected: a `retry` re-enters the same stage, so two overlapping retries would both pass.
4. **Moves as their own event types** (`retry`, `overrule`, `route`). Each would have a narrower shape. Rejected for five new `SHAPE` entries and `apply` cases where one action field does. A-114 names one `owner_decision` event.

## Threat model

- Moves come only from owner commands. A run cannot send one: `receive` turns a claim into `developer_result`, `verdict`, `dispute` or `run_failed` only, and the store file is outside every sandbox's write roots.
- Observers are the owner's code, unsandboxed (threat model, "Observers"), and act through the same commands. Each `overrule` refunds a budget unit, so an observer could loop paid reviews without end, though each loop needs a fresh FAIL first. Recommended: no cap in 11-d2. The source is recorded, and a cycle-level limit is `engine.md` P5's (Exhaustion edges and cycle limits).
- Reviewer runs cut off by an escalation. The controller's abort poll still stops a run when its cycle reaches ESCALATED, and its `run_failed` is stored while the cycle is ESCALATED, so the index keeps any later outcome out. One window remains: a move within about one second of the escalation, before the poll fires, while a reviewer run is still working. Its verdict could then count in the stage the move entered. Today only a second process escalating the cycle mid-review reaches this, since no producer sends `head_changed` or `base_changed`. Recommended: park against 11-e, where `run_started` lets a move consume reviewer runs too.

## Questions for the owner

1. **One ticket or two?** Recommended: two, 11-d then 11-d2, with 11-d2 stacked on 11-d's branch.
2. **Engine version.** Recommended: no bump, with the fixture replay test as evidence.
3. **`commandId` storage.** Recommended: the existing `run_id` index, with an object-shaped key.
4. **`cancel` without the stale-load check.** Recommended: yes, as above.
5. **`request-changes` command.** Recommended: yes, in 11-d. It is one verb on `accept`'s path, and it closes the open item "no command sends `request_changes`".
6. **Moves built in 11-d2:** `retry`, `overrule` and `route`, with `accept with risk` as `route` to the human stage. `fix` chosen findings goes with A-108's ticket; the child-from-candidate option is probed, not built. Recommended: as listed.
7. **Overrule cap.** Recommended: none now; P5's limits row holds it.
8. **The reviewer-run window.** Recommended: park against 11-e.
9. **Rename `SETTLED` to `STOPPED`** for today's meaning, with `SETTLED` as ACCEPTED and CANCELLED. The rename touches `learn/`. Recommended: yes. The other choice is to keep the name with a corrected comment, which leaves a name that is no longer true.

## Probes before code

- 11-d: none. The race test uses a held write lock as its barrier (A-137).
- 11-d2: a scratch job whose `base` is `sf/<parentCycleId>`. Does `develop` start from the parent's candidate? Fake runtimes only, no paid calls.
