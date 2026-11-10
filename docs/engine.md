# The engine in TypeScript

Every method of the engine and every type it returns, for a client other than the CLI.

The words used here (commission, attempt, subject, wait and the rest) are defined in
[`core.md`](core.md).

## A working example

```ts
import { createEngine } from "@medrengard/core/src/engine.ts";
import factory from "./factory.ts";

const engine = createEngine({ ...factory, log: "/var/tmp/factory/log.sqlite" });

// Starts a commission of the workflow "greet". The request is its first subject.
engine.commission("greet", { title: "Greet", body: "Say hello." }, { name: "first" });

// Attempts ready steps until the commission waits for the owner or finishes.
let state = await engine.advance("first");

if (state.status === "awaiting") {
  // The subject, and what the owner may decide: ["accept", "changes", "abandon"].
  console.log(engine.artifact(state.subject), state.outcomes);

  // A decision names the subject and the wait it ends.
  state = engine.decide("first", {
    subject: state.subject,
    since: state.since,
    outcome: "accept",
    feedback: "Fine.",
  });
}

// { status: "finished", by: "end" }
console.log(state);

// Each attempt and decision, oldest first, and what attempt 1 wrote.
console.log(engine.record("first").entries);
console.log(engine.transcript("first", 1).toString());
```

## Creating an engine

```ts
createEngine(factory: Factory)
```

```ts
type Factory = {
  log: string;
  kinds: Kinds;
  workflows: Record<string, Workflow>;
  defaults: { limits: Limits };
  triggers?: Readonly<Record<string, Trigger>>;
};
```

`createEngine` opens the SQLite log at `log`, creating the file if it is missing, and returns the
engine: an object with the eighteen methods below. The log's directory must exist. The engine
keeps its store in `store/` and its running attempts in `attempts/`, both beside the log.

`log` is used as given, so pass an absolute path. The CLI resolves a relative `log` against the
factory's module; `createEngine` does not.

Any number of engines may open one log, in one process or several.

It throws when a trigger is invalid, `Trigger <name> is invalid: …`, or when a commission step
names a trigger the factory lacks, one with no allowance, or one that may not start the step's
workflow.

Every method that takes a commission throws `There is no commission named <commission>.` for a
name the log does not hold, and replay's own error for a commission whose events it cannot read.

## Starting

### `check`

```ts
engine.check(workflow: string): Definition
```

Returns the definition the workflow would be commissioned with, in the shape
[`definition`](#definition) returns. It records nothing.

It throws what `commission` would throw for the workflow: `There is no workflow named <workflow>.`,
or why the definition is invalid.

### `commission`

```ts
engine.commission(
  workflow: string,
  request: { title: string; body: string },
  naming: { name: string; trigger?: string } | { name?: string; trigger: string },
): string
```

Starts a commission of the factory's workflow and returns its name. The request becomes a document,
the commission's first subject. The commission starts ready or awaiting, by the kind of its start
step; nothing is attempted until you call `advance`.

Give a `name`, a `trigger`, or both. With a trigger and no name, the commission is named
`<trigger>-<n>`, where `n` counts the commissions the trigger has started, from 1. A trigger's
commission records the trigger as its origin.

It throws, and records nothing, when:

- neither is given: `A commission needs a name unless a trigger starts it.`
- the workflow is unknown: `There is no workflow named <workflow>.`
- the definition is invalid: the message says which step or kind, and why.
- the request breaks the document kind's rules: `The request's title is over its limit of <n> bytes.`,
  `The request's body is over its limit of <n> bytes.` or
  `The request's title is not one of <values>.`
- the name is taken: SQLite's `UNIQUE constraint failed: events.commission, events.position`.
- the trigger cannot start it:
  - `There is no trigger named <trigger>.`
  - `Trigger <trigger> may not start workflow <workflow>.`
  - `Trigger <trigger> started <n> commissions in the last <s> s, its rate.`
  - `Trigger <trigger> has started <n> commissions since it was last renewed, its allowance.`
  - `Trigger <trigger> has <n> unfinished commissions, its limit.`
  - `Trigger <trigger>'s commission <commission> reported no cost, so its spend counts as over its money limit of $<usd>.`
  - `Trigger <trigger>'s commissions in the last <s> s cost $<spent>, its money limit of $<usd>.`
    (`since it was last renewed` for a trigger with no rate).

A trigger's caps are judged and its commission written in one write to the log.

### `renew`

```ts
engine.renew(trigger: string): void
```

Renews the trigger's allowance: the commissions it started before no longer count against it. The
renewal is recorded with its time, beside the events.

It throws `There is no trigger named <trigger>.` or `Trigger <trigger> has no allowance to renew.`

## Advancing

### `advance`

```ts
engine.advance(commission: string, options?: { signal?: AbortSignal }): Promise<CommissionState>
```

Attempts ready steps, one after another, until the commission can go no further, and resolves with
the state it stopped at:

- `awaiting`, `escalated` or `finished`;
- `ready` at an attended step, which only `attend` starts;
- `ready`, once `signal` aborts: the attempt in flight ends first, and no other starts;
- `ready`, for a child its parent is withdrawing;
- `attempting`, when another engine is running the attempt, or the attempt is a children or
  watching step's wait that goes on. Call `advance` again to look again.

An escalation is a state, not an error: `advance` resolves with it. An attempt no engine is running
escalates here, with the cause `interrupted`.

### `attend`

```ts
engine.attend(commission: string): Promise<CommissionState>
```

Attempts the attended step the commission is ready at, in this process's terminal, and resolves
with the state once that one attempt ends.

It throws, before it returns a promise:

- `Attending a step needs the owner's terminal as stdin and stdout.` when either is not a terminal;
- `Commission <commission> is not ready at an attended step.`

### `cancel`

```ts
engine.cancel(commission: string): void
```

Asks the engine running the commission's attempt to stop it. That engine stops the step and writes
the escalation, with the cause `cancelled` and the reason `Step <step> was cancelled by the owner.`
With no engine running the attempt, `cancel` writes the escalation itself. A children or watching
step's wait ends when an engine next advances the commission.

`cancel` returns at once, before the attempt ends. Nothing is decided: the owner then decides on
the escalation.

It throws `Commission <commission> is <status>, so no attempt can be cancelled.` unless the
commission is attempting.

## Deciding

### `decide`

```ts
engine.decide(
  commission: string,
  decision: { subject: string; since: number; outcome: string; feedback?: string },
): CommissionState
```

Records the owner's decision and returns the new state. Take `subject`, `since` and the allowed
`outcome`s from the state the owner saw:

- `subject`: the full hash of the current subject;
- `since`: the wait the decision ends, named by the state's `since`;
- `outcome`: one of the state's `outcomes`. At an approval step, an outcome the step declares, or
  `abandon`. On an escalation, `retry` or `abandon`;
- `feedback`: optional text, at most 1 MiB, kept as the decision's body.

`retry` makes the step ready again and renews its budget. On an escalation with the cause
`upgrade`, it also accepts this engine for the commission. `abandon` finishes the commission.

It throws, and records nothing, when:

- the commission is not waiting: `Commission <commission> is <status>, so no decision can be made.`
- the subject has changed: `Commission <commission> is about <subject>, not <given>.`
- the wait has changed: `Commission <commission> has waited since event <since>, not <given>.`
- the outcome is not allowed: `Step <step> does not declare outcome "<outcome>".`
- the feedback is too long: `The feedback is <n> bytes, over its limit of 1048576.`

## Reading

### `state`

```ts
engine.state(commission: string): CommissionState
```

Returns the commission's state, replayed from the log. See [`CommissionState`](#commissionstate).

### `commissions`

```ts
engine.commissions(): (
  | { commission: string; state: CommissionState }
  | { commission: string; error: string }
)[]
```

Returns every commission in the log, oldest first, children included. One the engine cannot read
is listed with the `error` in place of its state, so it does not hide the others.

### `record`

```ts
engine.record(commission: string): CommissionRecord
```

Returns the commission's state, its request and every attempt, escalation, withdrawal and
decision, oldest first. See [`CommissionRecord` and `Entry`](#commissionrecord-and-entry).

### `definition`

```ts
engine.definition(commission: string): Definition
```

```ts
type Definition = {
  workflow: Workflow<string, "whole">; // every step's limits whole
  kinds: Kinds;
  skills: Readonly<Record<string, { name: string; files: Readonly<Record<string, string>> }>>;
};
```

Returns the definition the commission was commissioned with and runs on, whatever the factory says
now: its workflow, with each step's limits filled in from the defaults the factory had then; its
kinds; and its agents' skills, each file by its hash. [`workflows.md`](workflows.md) describes a
workflow, and [`kinds.md`](kinds.md) a kind.

### `artifact`

```ts
engine.artifact(hash: string): Artifact
```

```ts
type Artifact = { kind: string; fields: Readonly<Record<string, string>>; body?: string };
```

Returns an artifact by its hash, or by a prefix of at least 8 characters that names one artifact.
It reads only what a commission's events name as an artifact: a request, an artifact a commission
was given, a claimed artifact or a decision.

It throws `There is no artifact <hash>.` or `The prefix <hash> names more than one artifact.`

```json
{ "kind": "document", "fields": { "title": "Reply" }, "body": "Hello. You asked: Say hello." }
```

### `transcript` and `errors`

```ts
engine.transcript(commission: string, attempt: number): Buffer
engine.errors(commission: string, attempt: number): Buffer
```

`transcript` returns everything the attempt's program wrote: its stdout and stderr, or an attended
step's terminal. `errors` returns its stderr alone, empty when it wrote none. Attempts are numbered
from 1 within their commission.

Both throw `Commission <commission> has no transcript for attempt <attempt>.` for an attempt that
has not ended, one whose program never ran, or a number the commission has no attempt for.

The bytes are the step's own. Make control characters visible before you show them in a terminal.

## Observing

### `events`

```ts
engine.events(position: number): {
  position: number;
  commission: string;
  index: number;
  event: CommissionEvent;
}[]
```

Returns every commission's events after the log position `position`, oldest first. Pass 0 for the
whole log.

- `position`: the event's place in the whole log, from 1. Pass the last one you read to read on.
- `index`: the event's place among its own commission's events, from 0. It is the `since` a
  decision names.
- `event`: see [`CommissionEvent`](#commissionevent).

```json
{
  "position": 8,
  "commission": "docs1",
  "index": 2,
  "event": { "type": "noted", "attempt": 1, "note": "Replying to Greet", "at": 1794299982709 }
}
```

### `next`

```ts
engine.next(
  position: number,
  options?: { signal?: AbortSignal },
): Promise<{ position: number; commission: string; index: number; event: CommissionEvent }[]>
```

Resolves with what `events(position)` returns, once it returns any: at once if there are events
already, otherwise when any engine next writes one. It is woken by the write and does not poll.
Once `signal` aborts, it resolves with what there is, which may be `[]`.

An observer reads on in a loop:

```ts
let position = 0;

while (!stopping.signal.aborted) {
  for (const { position: at, commission, index, event } of await engine.next(position, {
    signal: stopping.signal,
  })) {
    console.log(at, commission, index, event.type);
    position = at;
  }
}
```

### `register` and `engines`

```ts
engine.register(): () => void
engine.engines(): { host: string; pid: number; since: number; status: "alive" | "dead" | "unknown" }[]
```

`register` records this engine's process as running on the log, and returns a function that
withdraws the registration. It first removes the registrations of this machine's engines that
have ended. A registration changes no commission; a client that advances commissions for as long
as it lives, as the CLI's `run` does, registers so that others can see it.

`engines` lists the registered engines, oldest first. `since` is when it registered, in
milliseconds since the epoch. `status` is `alive` or `dead`, judged by the process on this machine,
or `unknown` for an engine registered on another machine.

## Types

Import them from the modules the package exports:

```ts
import type { CommissionRecord, Entry } from "@medrengard/core/src/engine.ts";
import type {
  Cause,
  CommissionEvent,
  CommissionState,
  Usage,
} from "@medrengard/core/src/replay.ts";
import type { Definition, Factory } from "@medrengard/core/src/definition.ts";
import type { Artifact } from "@medrengard/core/src/store.ts";
```

Every hash is a SHA-256 in hexadecimal. Every time is in milliseconds since the epoch.

### `CommissionState`

A state has a `status`. Every status but `finished` carries:

- `step`: `{ name, kind }`, the step the commission is at. An attended agent step also has
  `attended: true`;
- `subject`: the hash of the current subject;
- `decision`: the hash of the owner's latest decision about the subject. It is absent until there
  is one, and again once an attempt claims a subject.

| Status       | Step's kind                                  | Also carries                           |
| ------------ | -------------------------------------------- | -------------------------------------- |
| `ready`      | `agent`, `command`, `children`, `commission` |                                        |
| `attempting` | the same                                     |                                        |
| `awaiting`   | `approval`                                   | `since`, `outcomes`                    |
| `escalated`  | as `ready`                                   | `reason`, `cause`, `since`, `outcomes` |
| `finished`   | none                                         | `by`, and nothing else                 |

- `since`: the index of the event that began the wait. A decision must name it.
- `outcomes`: what the owner may decide. Awaiting, the approval step's outcomes, then `abandon`.
  Escalated, `["retry", "abandon"]`.
- `reason`: why it escalated, in words, at most 4096 bytes. A longer one is cut and ends
  `… (cut to 4096 of <n> bytes)`.
- `cause`: one of the sixteen [causes](#cause). Absent only for a log written before escalations
  carried one.
- `by`: `"end"`, an edge reached the end; `"abandoned"`, the owner decided `abandon`; or
  `"withdrawn"`, the commission was a child and its parent no longer waited for it.

```json
{
  "status": "awaiting",
  "step": { "name": "approve", "kind": "approval" },
  "subject": "3b662a273f4a51598a69a7d2f80993fb424d31a05ba93364cabfb140583edfc0",
  "since": 3,
  "outcomes": ["accept", "changes", "abandon"]
}
```

### `CommissionRecord` and `Entry`

```ts
type CommissionRecord = {
  state: CommissionState;
  request: { hash: string; artifact: Artifact };
  origin?: { trigger: string; from?: { commission: string; step: string; attempt: number } };
  entries: Entry[];
};
```

`origin` is there for a commission a trigger started. Its `from` names the commission step's
attempt that started it, when one did.

An entry has one of six forms. `entry` and the fields it carries tell them apart.

An attempt in flight:

```ts
{ entry: "attempt"; attempt: number; step: string; notes: Note[]; started?: number; running: true }
```

An attempt that completed:

```ts
{
  entry: "attempt"; attempt: number; step: string; notes: Note[];
  started?: number; ended?: number;
  outcome: string;
  artifacts: { hash: string; artifact: Artifact; verifier: readonly string[] | null }[];
  errors: boolean;
  usage?: Usage;
}
```

An attempt that escalated:

```ts
{
  entry: "attempt"; attempt: number; step: string; notes: Note[];
  started?: number; ended?: number;
  escalated: string;
  cause?: Cause;
  next?: string;
  errors: boolean;
  usage?: Usage;
}
```

An escalation before any attempt started, such as a spent budget:

```ts
{ entry: "escalation"; step: string; reason: string; cause?: Cause; at?: number }
```

A withdrawal, of a child by its parent:

```ts
{ entry: "withdrawal"; step: string; reason: string; at?: number }
```

A decision:

```ts
{ entry: "decision"; step: string; outcome: string; subject: string; feedback?: string; at?: number }
```

- `notes`: `{ note: string; from: "step" | "engine" }[]`, each note the attempt wrote for the
  owner, or the engine wrote about it, in order.
- `artifacts`: what the attempt claimed, in the order claimed. `verifier` is the command of the
  verifier that accepted the artifact, or `null` when its kind has none.
- `escalated`: the reason. `cause` is absent only for a log written before escalations carried one.
- `next`: the step the escalation was routed to, when the attempt's step routed its cause. The
  commission went on there and did not wait for the owner.
- `errors`: whether the attempt wrote to stderr. Read it with `errors`.
- `usage`: what the step reported it used, when it reported any. See [`Usage`](#usage).
- `started`, `ended`, `at`: absent for events written before the log kept times.

### `CommissionEvent`

```ts
type CommissionEvent = (
  | Commissioned
  | AttemptStarted
  | AttemptCompleted
  | Noted
  | Decided
  | Withdrawn
  | Escalated
) & { at?: number };
```

Seven event types are the whole log. Each carries `type`, and `at`, when the engine wrote it. An
event gains fields over time and never loses one, so read the fields you know and ignore the rest.

**`commissioned`**, always a commission's first event, at index 0:

- `workflow`: the workflow's name;
- `definition`: the hash of the definition the commission runs on;
- `request`: the hash of the request;
- `engine`: the version of the engine that commissioned it;
- `origin`: `{ trigger, from? }`, for a commission a trigger started;
- `parent`: `{ commission, step, attempt }`, for a child;
- `given`: `{ hash, kind, kept }[]`, the artifacts it was given.

**`attempt-started`**:

- `step`, `attempt`;
- `subject`: the hash of the subject the attempt was given;
- `inputs`: `{ name, hashes }[]`, each input's artifacts, oldest first;
- `process`: `{ pid, start, boot? }`, the engine process running it;
- `engine`: the engine's version.

**`attempt-completed`**:

- `step`, `attempt`, `outcome`;
- `artifacts`: `{ hash, kind, kept }[]`, in the order claimed. `kept` names the files the kind's
  verifier kept, each by its hash;
- `transcript`: its hash, and `errors`, the hash of its stderr, when it wrote any;
- `usage`: the step's latest report, when it made one;
- `session`: the hash of the session it left, when it left one;
- `next`: the step the outcome's edge led to, or `"end"`.

**`noted`**: `attempt`, `note`, one line for the owner, and `from: "engine"` when the engine wrote
it. It changes no state.

**`decided`**:

- `step`, `outcome`;
- `decision`: the hash of the decision artifact, which holds any feedback as its body;
- `subject`: the hash of the subject it names;
- `next`: the step it led to, or `"end"`.

**`withdrawn`**: `reason`. It finishes a child whose parent no longer waits for it.

**`escalated`**:

- `reason`, `cause`;
- `step`: the step the commission was at;
- `next`: the step it was routed to, when its step routed the cause;
- `attempt`: when an attempt was involved, with `transcript` and `errors` when its program ran,
  `usage` when it reported any, and `session` when it left one;
- `engine`: this engine's version, when the cause is `upgrade`.

`cause` and `step` are absent only in events written before escalations carried them.

### `Cause`

Why a commission escalated, from a closed set:

| Cause         | Meaning                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `budget`      | The step spent its budget.                                                 |
| `money`       | A money limit was reached, or what was spent is unknown.                   |
| `limit`       | Another declared limit was reached: time, size, disk, memory or a wait.    |
| `repeat`      | The step was already attempted on this subject and these inputs.           |
| `inputs`      | What the step was to be given cannot be given, such as a workspace's base. |
| `claim`       | The claim was invalid, or its kind's verifier rejected it.                 |
| `exit`        | The step's program failed, or could not start.                             |
| `kind`        | A kind's verifier or materialiser failed.                                  |
| `broker`      | A broker did not start.                                                    |
| `interrupted` | No engine was running the attempt.                                         |
| `engine`      | The engine itself failed.                                                  |
| `cancelled`   | The owner cancelled the attempt.                                           |
| `withdrawn`   | The commission's parent no longer waits for it.                            |
| `upgrade`     | This engine is not the one the commission last ran on.                     |
| `unmet`       | A children step's wait can no longer be met.                               |
| `trigger`     | A commission step's trigger cannot start its commissions now.              |

A step may route `limit`, `claim`, `exit`, `kind`, `broker`, `interrupted` and `unmet` to another
step; see [`workflows.md`](workflows.md). The rest always wait for the owner.

### `Usage`

```ts
type Usage = {
  usd?: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};
```

What an attempt's step reported it used: money in US dollars, and tokens as its harness counts
them. It is the step's claim, and nothing verifies it. [`step-contract.md`](step-contract.md) says
how a step reports it.
