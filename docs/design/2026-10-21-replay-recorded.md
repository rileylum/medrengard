Branch: feat/11-c-replay-recorded

# Replay each cycle under its recorded workflow, and detect divergence (ticket 11-c)

## Problem

`EventStore` replays every cycle under the one workflow it was built with, and `load` throws for a cycle opened under any other (`src/store.ts`, `load`; A-059 Q2). Three places pick "the workflow this cycle was opened under" in three ways (`architecture.md` finding 7): the store refuses, `stream.ts#workflowOf` trusts a recorded definition that hashes right, and `main.ts#decisionConfig` reloads the config layers at each recorded base. `recover` (11-f) must scan every unsettled cycle in a runs folder, and today it would throw on the first cycle under another workflow.

Two engine gaps ride with it (A-123 item 2, `engine.md` G8, G9, P6):
- **G8.** A change to `apply` re-interprets every old log, and nothing notices: an ACCEPTED cycle could replay as ESCALATED. The one guard is the golden fixture.
- **G9.** Replaying under a recorded definition "when it passes `checkWorkflow`" makes every older cycle unloadable the day `checkWorkflow` tightens (A-123 item 4 tightens it).

Facts the design must respect:
- The open row (seq 0) holds `workflow: { name, hash }` since 09-b and `definition` since 10-d. Stores before 09-b have neither; their cycles were opened under `defaultWorkflow` (`DEFAULT_RECORD`).
- `apply` trusts its workflow. A definition read back from the store is data, so it is checked before `apply` sees it.
- Every stage function reads stage definitions from `store.workflow` (`run.ts`, `developer.ts`, `verify.ts`, `review.ts`, `controller.ts`, `decide.ts`). Adapters, grants and `workflowDir` come from the job's config. A cycle under another workflow must not be driven with this store's stage table.
- `append` today inserts with `seq = MAX + 1` in one statement, then replays. A stored stage is only right if it is computed from the rows it follows.
- The guide's `learn/shims/store.js` mirrors `src/store.ts`; `learn/learn.test.ts` checks its exports.

## Interface

```ts
// src/lifecycle.ts
/** Bumped when apply would move any existing log to a different stage. Recorded on each open row. */
export const ENGINE_VERSION = 1;
/** What apply needs to run without crashing or misrouting; empty when it passes. Lighter than checkWorkflow. */
export function replayCheck(w: Workflow): string[];

// src/store.ts
interface OpenRow { /* … */ engine?: number }   // absent before 11-c

/** The recorded definition, then defaultWorkflow, then `given`: the first that passes replayCheck and hashes to the recorded workflow. */
export function recordedWorkflow(open: OpenRow, given?: Workflow): Workflow | undefined;

/** The replay disagrees with a stage stored on a row. Names the cycle, the row, both stages and the engine version. */
export class ReplayDiverged extends Error {}

class EventStore {
  constructor(path: string, workflow?: Workflow);   // full checkWorkflow, as now: it opens new cycles
  /** Replays under the cycle's recorded workflow; compares each row's stored stage. Throws ReplayDiverged, or the mismatch error when no workflow matches. */
  load(cycleId: string): Cycle | undefined;
  /** As load, but refuses a cycle whose workflow is not this store's: the stage functions read their stage table from `this.workflow`. */
  drivable(cycleId: string): Cycle;
  /** Under one write lock: load, apply under the cycle's own workflow, insert with the stage apply produced. */
  append(cycleId: string, event: Event): Cycle;
  /** Every cycle not in SETTLED, across work IDs, ordered by cycle ID. A cycle that cannot be replayed is listed with the reason, not thrown. */
  unsettled(): { cycleId: string; workId: string; stage?: Stage; refused?: string }[];
}
```

Storage: one nullable column, `events.stage TEXT`, added to an older store as `addPositions` adds `pos` (checked again under the write lock). The open row stores `QUEUED`; each event row stores the stage `apply` moved the cycle to. A row with a null stage (written before 11-c) is replayed and not compared. No backfill: filling old rows from today's `apply` would bless whatever today's `apply` says, which is what the checksum exists to catch.

`replayCheck` keeps the parts of `checkWorkflow` that `apply` reads: `stages` is an object; `start` names a stage; each stage is an object of a known kind; an agent stage has a role and `produces` of `commit` or `verdict`; a budget, if present, is a positive integer; `transitions.PASS` is a string and `FAIL`, if present, is one; every target is a stage or a settled engine stage. It drops role-text rules, command and grant rules, the budgeted-loop rule and the path-to-settled rule: none of them changes what `apply` does with a log already written.

Who calls what:
- `load`, `cycles`, `unsettled`, `events` and `append` work on any cycle whose workflow resolves. So `cancel` and `accept` read the right stage on a cycle opened under an older workflow, whatever the tip's config says.
- The stage functions call `drivable` where they call `load` today. A cycle under another workflow is refused with today's message, naming both workflows. Driving such a cycle is 11-f's question (`recover`, `resume`).
- `stream.ts#workflowOf` becomes `recordedWorkflow`, so `events` uses the same rule and the same light check. The stream still decides nothing and does not compare stages.
- `decisionConfig` is unchanged. `accept` drives on with the whole config at the old base (grants, `workflowDir`, runtimes), not only its workflow, so it still needs the reload. A-112 item 6's "`decisionConfig` becomes a fallback" is narrowed: only the workflow match moves into the store.

## Alternatives

1. **Cycles carry their workflow; every stage function reads `store.workflowOf(cycleId)`** instead of `store.workflow`. Rejected for now: about a dozen call sites change, and no command drives a cycle under another workflow until 11-f. The adapters and the grants still come from the job's config, so driving an old cycle needs 11-f's design anyway. `drivable` is the one place 11-f would widen.
2. **A derived-stage column as the source of truth**, read instead of replaying (10-d's rejected alternative 3). Rejected again: two sources disagree silently. Here the column is only a checksum, and `apply` stays the one source (A-123).
3. **Hash the whole replayed Cycle per row**, not only the stage. It would catch a change in budgets or candidate that leaves the stage alone. Rejected: the stage is what drives the controller, it reads well in the error, and a budget change shows up as a stage change at the next budgeted transition.

## Threat model

The event store is listed as worth protecting; it is the record of what happened. This ticket reads more of it as trusted: a recorded definition now drives `apply` for reads and appends. Only the controller writes the store, and a definition was checked by the full `checkWorkflow` when its cycle opened, so a definition read back is no less trusted than today's events. It is checked again with `replayCheck`, because `apply` would misbehave on a malformed one. A repository workflow (partly trusted) reaches the store only through config loading at the base, as today. No candidate output is read. No sandbox, grant or git change.

## Questions for the owner

1. **One ticket or two?** Recommend one. The checksum needs `append` to apply the event under the cycle's own workflow, which is the replay change; both edit `load` and `append`.
2. **Stores written before 11-c.** Recommend: the column is added with nulls, null rows are not compared, and an open row with no `engine` means "before 11-c". No backfill.
3. **`decisionConfig`.** Recommend: unchanged in 11-c, for the reason above; record the narrowing of A-112 item 6.
4. **Driving a cycle under another workflow.** Recommend: refused by `drivable`, as A-059 refuses today; 11-f decides. Reading and appending widen.
5. **Engine version.** Recommend: record only (`engine: 1`) and name it in the divergence error. No refusal on a newer number: the checksum already refuses a log the engine reads differently, and only when it does.
6. **Two pins change meaning.** `tests/store.test.ts` "a cycle opened under one workflow is refused by a store running another, naming both" and "a store written before 09-b loads under the default workflow only" pin A-059's refusal, which A-112 item 6 widens. Recommend: both become "loads under the recorded workflow, and `drivable` refuses, naming both"; a new test keeps the refusal when nothing matches (no definition, an unknown hash).
7. **The append lock.** `append` now loads, applies and inserts under `BEGIN IMMEDIATE`, so the stored stage follows the rows before it. This is where 11-d's parked check (refuse an append when the stage the writer loaded has moved) slots in; 11-c does not add that check, and the race stays parked against 11-d.

## Probes

None paid. Before code: time `append` on a 1,000-event cycle with the lock and the comparison, against today's, to confirm the cost stays near one replay per append (P9's quadratic history copy is a later row).
