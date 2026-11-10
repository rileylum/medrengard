# The engine in TypeScript

The engine's methods, for a client other than the CLI.

The CLI is a thin layer over `createEngine`, and so is any other client:

```ts
import { createEngine } from "@medrengard/core/src/engine.ts";
import factory from "./factory.ts";

const engine = createEngine({
  log: "/var/tmp/factory/log.sqlite",
  kinds: factory.kinds,
  workflows: factory.workflows,
  defaults: factory.defaults,
});

// Starts a commission: the request is its first subject.
engine.commission("greet", { title: "Greet", body: "Say hello." }, { name: "first" });

// Runs ready steps until the commission awaits the owner, escalates or finishes.
let state = await engine.advance("first");

if (state.status === "awaiting" || state.status === "escalated") {
  // The artifact the commission is about, by hash.
  console.log(engine.artifact(state.subject));

  // At an approval step, an outcome it declares or abandon; on an escalation, retry or abandon.
  state = engine.decide("first", {
    subject: state.subject,
    // The event that began its wait: a decision from an earlier wait is refused.
    since: state.since,
    outcome: "accept",
    feedback: "Shorter.",
  });
}

// What attempt 1 wrote to stdout and stderr, and to stderr alone.
console.log(engine.transcript("first", 1).toString());
console.log(engine.errors("first", 1).toString());

// The commission's record: each attempt with its claims or why it escalated, and each decision.
console.log(engine.record("first").entries);

// Every commission in the log, oldest first, with its state.
console.log(engine.commissions());

// An observer: every commission's events after a position, then each new one as it is written.
let position = 0;

for (;;) {
  for (const { position: at, commission, event } of await engine.next(position)) {
    console.log(at, commission, event.type);
    position = at;
  }
}
```

| Method                                                       | Returns                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commission(workflow, { title, body }, { name, trigger? })`  | the commission's name; refuses an unknown workflow or an invalid one, and a trigger past its caps. With a trigger, `name` may be left out: it is named `<trigger>-<n>`                                                                                                    |
| `check(workflow)`                                            | the definition it would be commissioned with, as `definition` gives a commission's; refuses as `commission` would, recording nothing                                                                                                                                      |
| `advance(commission, { signal? })`                           | the state it stopped at, which may be ready at an attended step; once `signal` aborts, it starts no further attempt                                                                                                                                                       |
| `attend(commission)`                                         | the state once the attended step it is ready at ends, run in this process's terminal                                                                                                                                                                                      |
| `events(position)`                                           | `{ position, commission, index, event }[]`: every commission's events after the log position, oldest first. `position` is the event's place in the whole log, to read on from; `index` its place among its commission's own events, which is the `since` a decision names |
| `next(position, { signal? })`                                | the same, once there are any, woken by any engine's write; none once `signal` aborts                                                                                                                                                                                      |
| `state(commission)`                                          | the state, replayed from the log                                                                                                                                                                                                                                          |
| `commissions()`                                              | `{ commission, state }[]`, oldest first; `{ commission, error }` for one the engine cannot read                                                                                                                                                                           |
| `decide(commission, { subject, since, outcome, feedback? })` | the new state; refuses a stale subject or wait, an undeclared outcome, or feedback over 1 MiB                                                                                                                                                                             |
| `cancel(commission)`                                         | nothing; the engine running the attempt stops it and escalates, or, with none, it escalates at once                                                                                                                                                                       |
| `renew(trigger)`                                             | nothing; renews the trigger's allowance, counting its earlier commissions no more. Refuses a trigger the factory lacks or one with no allowance                                                                                                                           |
| `definition(commission)`                                     | the definition the commission was commissioned with and runs on: its workflow, each step's limits whole, its kinds and its skills by file hash                                                                                                                            |
| `record(commission)`                                         | `{ state, request, entries }`: every attempt, escalation and decision, oldest first; each claimed artifact with its `verifier`, the command that accepted it, or `null` when its kind has none                                                                            |
| `errors(commission, attempt)`                                | what the attempt wrote to stderr, as a `Buffer`; empty for none                                                                                                                                                                                                           |
| `transcript(commission, attempt)`                            | the attempt's stdout and stderr as a `Buffer`                                                                                                                                                                                                                             |
| `artifact(hash)`                                             | `{ kind, fields, body? }`; refuses a hash the log does not name as an artifact                                                                                                                                                                                            |
| `register()`                                                 | a function that withdraws it; records this engine as running on the log, removing this machine's engines that ended                                                                                                                                                       |
| `engines()`                                                  | `{ host, pid, since, status }[]`, oldest first: `alive` or `dead`, judged on this machine, or `unknown` on another                                                                                                                                                        |

A state has a `status`:

- `ready` or `attempting`, at an agent or command `step`, about a `subject`; an attended step is
  marked `attended: true`;
- `awaiting`, at an approval `step`, about a `subject`;
- `escalated`, at a `step`, about a `subject`, with a `reason` of at most 4096 bytes, longer ones
  cut and marked `… (cut to 4096 of N bytes)`, and its `cause`: `budget`, `money`, `limit`, `repeat`,
  `inputs`, `claim`, `exit`, `kind`, `broker`, `interrupted`, `engine`, `cancelled`, `withdrawn`,
  `upgrade`, `unmet` or `trigger`, which [`docs/core.md`](core.md) defines. `record` gives
  each escalation's too, and `state` prints it as `cause: limit`;
- `finished`, `by` `"end"` or `"abandoned"`: abandoned only by the owner's `abandon`, at an
  approval step or an escalation; an approval's own edge to `end` finishes it by `"end"`.

Every state but `finished` also carries `decision`: the hash of the owner's latest decision about
the subject, if there is one. An `awaiting` or `escalated` state carries `outcomes`, what the owner
may decide: the approval step's outcomes and `abandon`, or `retry` and `abandon`.
