Branch: feat/10-d-observation-stream

# Observation stream (ticket 10-d)

## Problem

An observer is any process that reads the event stream and acts through the owner's commands (D-024). A-074 decides the shape: `node src/main.ts events <job.json | runsDir> [--follow]` prints JSON lines `{ seq, at, cycleId, workId, event, from, stage, escalation }`. The store records a time on each row, outside the `Event`, so replay is unchanged. `accept` and `cancel` record their source, and an observer may run `accept` (Q6a). The controller does not start observers. A-074 also promises a contract test kit for observers.

Facts the design must respect:
- The events table (`src/store.ts`, the constructor) is `(cycle_id, seq, type, run_id, body)`, `WITHOUT ROWID`, keyed `(cycle_id, seq)`. It has no rowid, so no order across cycles, and no time.
- `seq` is allocated per cycle inside the one `INSERT … SELECT` in `insert`. SQLite takes the write lock for the whole statement, so two processes cannot interleave an allocation.
- Row 0 of each cycle is the store's `open` marker. It is not an `Event` and never reaches `apply`.
- `from`, `stage` and `escalation` come only from replaying `apply`, and `apply` needs the cycle's workflow. The open row records the workflow's name and hash, not the workflow itself. One runs directory can hold several work IDs, each under its own workflow (09-b), and a runs directory names no workflow.
- `append` refuses an event `isEvent` cannot classify. A row this version cannot read can only come from a newer controller.
- `tests/fixtures/v1-store.sqlite` must still replay. So must every store written since, including `live-1`'s, whose cycles ran a custom workflow.
- `accept` and `cancel` (`src/main.ts`) find the workflow through `decisionConfig`, which reads the layers at each recorded base.

## Interface

**The store** (`src/store.ts`). Two columns join the events table:

- `pos INTEGER`: a position across the whole store. It is allocated in the same `INSERT … SELECT` as `seq` (`COALESCE(MAX(pos), 0) + 1` over the table), and a unique index guards it. It increases with commit order. It is not dense: an insert that `DEDUP` ignores uses no position, and open rows take one but print no line.
- `at TEXT`: `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, set by SQLite in the same statement. The `Event` body is unchanged, so replay is unchanged.

The constructor adds both columns when they are missing, inside `BEGIN IMMEDIATE`, and checks again under the lock, so two processes opening one old store cannot both add them. Old rows get a `pos` in `(cycle_id, seq)` order, before every new row, and `at` stays null. Their real order across cycles is lost, and the stream says so by giving no time rather than a false one.

The open row gains `definition`, the workflow itself, from 10-d on. A reader checks `workflowHash(definition)` against the recorded hash before it trusts it.

**The reader** (`src/stream.ts`, new).

```ts
export interface Line {
  /** The row's pos. Increasing across the store; not dense. */
  seq: number;
  /** ISO time the row was written; null for a row written before 10-d. */
  at: string | null;
  cycleId: string;
  workId: string;
  /** The event as stored. May be of a type this version does not know. */
  event: unknown;
  /** The cycle's stage before and after the event, and its escalation after; null when the reader cannot replay the cycle. */
  from: Stage | null;
  stage: Stage | null;
  escalation: string | null;
}

/** Lines after `after`, in seq order. Each poll returns the lines written since the last. */
export function openStream(path: string, opts?: { workId?: string; after?: number; workflow?: Workflow }): { poll(): Line[]; close(): void };
```

- `poll` reads rows with `pos > last`, applies each to its cycle held in memory, and returns the lines. With `after`, the reader still replays the earlier rows of each cycle, so `from` and `stage` are right, but returns only the lines after it.
- A cycle's workflow is, in order: the open row's `definition`; `defaultWorkflow` when the recorded hash is the default's; `opts.workflow` when its hash matches. Otherwise the cycle's lines carry `from`, `stage` and `escalation` as null, and `poll` writes one warning to stderr for the cycle.
- A row `isEvent` refuses is printed as stored, with `from`, `stage` and `escalation` null, and that cycle's later lines are null too. The reader decides nothing, so it does not escalate. It warns once on stderr.
- `escalation` is the cycle's `escalation` after the event, so it stays set on every later line of an escalated cycle.

**The command.**

```
node src/main.ts events <job.json | runsDir> [--after <seq>] [--follow]
```

- A job file reads that job's runs directory and its work ID only, and passes its workflow, found as `decisionConfig` finds it. A runs directory reads every work ID.
- Each line is `JSON.stringify(line)` on stdout. Nothing else goes to stdout.
- `--follow` polls every 500 ms until killed. SQLite cannot notify another process. An observer that restarts passes the last `seq` it handled as `--after`, so delivery is at least once.
- A store that does not exist yet is not an error under `--follow`: the reader waits for it.
- The reader opens the store read-write, because it runs the same column check as the constructor. It never appends.

**The source** (`accept` and `cancel`).

```
node src/main.ts accept <job.json> <sha> [--source <name>]
node src/main.ts cancel <job.json> [--source <name>]
```

The `accept` and `cancel` events gain `source?: string`, a non-empty single line. Without the flag the command records `owner`. An event without the field, from before 10-d, reads as the owner's. `SHAPE` checks it, and `apply` ignores it. The source is a label, not an identity: anyone who can run the command can write any source. It shows who acted; it does not decide who may.

**The observer helper and kit** (`src/kits/observe.ts`, new).

```ts
/** The owner's commands, run as `node src/main.ts … --source <source>` against the job file. */
export interface Owner { accept(sha: string): Promise<void>; cancel(): Promise<void> }
export type Observer = (line: Line, owner: Owner) => void | Promise<void>;

/** Follow the job's stream and hand each line to `observer`, one at a time, until `signal` aborts. */
export function observe(jobFile: string, source: string, observer: Observer, opts?: { after?: number; signal?: AbortSignal }): Promise<void>;

export interface ObserverCase {
  name: string;
  /** One cycle under the default workflow, written to a scratch store and read back through the stream. */
  events: Event[];
  /** What the observer must do, in order. */
  expect: ({ accept: string } | 'cancel')[];
}
export function observerKit(name: string, observer: Observer, cases: ObserverCase[]): void;
```

- `Owner` is the only way the helper gives an observer to act. Its methods run the real commands, so the store's rules apply: an `accept` on a moved head is refused as it would be for the owner. A refused command rejects.
- `observe` waits for each call to settle before the next line, so an observer sees lines in order. An observer that throws stops `observe`, which rejects with the error. The observer chooses whether to catch.
- `observerKit` registers `node:test` cases, as `runtimeKit` and `commandKit` do. Each case writes its events to a scratch store, reads the lines through `openStream`, and hands them to the observer with a recording `Owner`. The case passes when the recorded actions equal `expect`. Two fixed cases run for every observer:
  - A line whose event is of an unknown type, with unknown fields, makes the observer neither throw nor act.
  - A recording `Owner` whose methods reject does not make the observer throw.
- The owner's use case, accepting a change that touches only comments, is an example observer in `tests/fixtures/`, checked with `observerKit`. It reads the diff from the job's repository with `git diff base..head`. It accepts when every changed line is blank or starts with `//` or `#`, and does nothing otherwise.

## Alternatives

1. **A second table for order and time.** A table `log(pos INTEGER PRIMARY KEY, cycle_id, seq, at)` beside `events`. `pos` would come from SQLite's rowid, and `events` would stay as it is. But each append becomes two statements in a transaction, and the dedup on `events` must also skip the `log` insert. Two columns keep the one-statement insert. Rejected.
2. **Push from the controller.** The controller writes each event to a socket or a webhook. A-074 chose pull: the controller does not start or know observers, and a stopped observer catches up from its cursor. Rejected by the decision.
3. **Store the stage on each row instead of replaying.** `append` already replays the cycle, so it could write `from`, `stage` and `escalation` into columns. Then the reader would need no workflow at all. But the columns would be a second copy of what `apply` decides, so a change to `apply` would leave old rows saying something replay no longer says. Old rows would also have no stage. Rejected. Recording the workflow's definition keeps `apply` the one source.

## Tests

- A store written by 10-d gives every row an increasing `pos` across cycles and an ISO `at` between the times taken before and after the append.
- `v1-store.sqlite`, and a store with a custom workflow written before 10-d, open, get a `pos` for every row, keep `at` null, and replay to the same cycles. Two processes opening one old store at once both succeed.
- `events` on a job file prints only that work's lines; on a runs directory it prints every work ID's. `from`, `stage` and `escalation` match `cycle.history` for the same cycle. The open marker prints no line.
- A cycle opened under a custom workflow replays from its recorded `definition`, without the job file. A pre-10-d custom cycle prints null stages from a runs directory, and real stages from its job file.
- A row of an unknown type, inserted directly, prints as stored with null stages, and the reader exits 0.
- `--after` returns only later lines, with stages that are still right. `--follow` prints a line appended by another process, and waits for a store that does not exist yet.
- `accept` and `cancel` record `source: 'owner'` by default and the flag's value when given. An empty or multi-line source is refused, writing nothing. A pre-10-d `accept` event still replays.
- `observerKit` passes for the comment-only example on a comment-only diff and on a code diff. It fails for an observer that throws on an unknown event, and for one that acts on it.
- `observe` with the example observer and a real `accept` records `source` as the observer's name, and the cycle reaches ACCEPTED.

## Risks

- **An observer that accepts can accept a wrong change.** That is Q6a's purpose. The source shows who accepted, and `accept` still refuses anything but the candidate head of a cycle at a human stage.
- **The source can be forged.** Anyone who can run `main.ts` can write any source. The store has no notion of identity, and this ticket does not add one.
- **Polling reads the whole store on start.** A long store makes a slow first poll. lazy: ceiling about 100 000 rows; upgrade with a per-cycle snapshot when a store passes that.
- **The reader writes to the store once,** to add the columns. An observer running as a user who cannot write the store fails on an old store. Every store today belongs to the owner.
- **Reviewer runs record no start** (A-074), so a stalled reviewer shows as silence. Row 11 adds that.

## Questions for the owner

**Q1 — `seq` in a line is the store-wide position, not the per-cycle number.** Recommended: store-wide. A cursor that resumes `--follow` needs one number across every cycle, and the per-cycle number is still in the order of a cycle's lines.

**Q2 — Old rows get a position, in cycle-ID order, and no time.** The alternative is to leave old rows without a position, and print them with `seq: null`. Recommended: give them one. Every line then has a cursor, and the null `at` already says the order is not real.

**Q3 — The open row records the workflow's definition, so a runs directory can be read without a job file.** Cycles from before 10-d under a custom workflow print null stages from a runs directory, and real ones from their job file. Recommended: yes. Without it, `events <runsDir>` could not replay any custom workflow, which is most real use since 10-c.

**Q4 — `--source <name>` on the command line, defaulting to `owner`.** The alternative is an environment variable (`SF_SOURCE`), which would also reach every process the command starts. Recommended: the flag. It is visible in the command an observer runs.

**Q5 — The observer kit takes scripted cycles and the expected actions, plus two fixed cases: unknown events, and refused commands.** Recommended: yes. The kit can only check behaviour the helper lets it see. That is the observer's actions through `Owner`, not other effects, such as a Discord message.

**Q6 — Leave `proto/board.ts` as it is.** It could move onto the stream and order cycles by `at`. Recommended: leave it. The board is experimental (A-046), and the ticket is large enough without it.

Reply with the numbers you want to change, or say skip to take all recommendations.
