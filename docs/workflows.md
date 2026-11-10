# Workflows

How a workflow is written: its steps, what each is given, how a step fans out to child commissions, and how work is started on a timer or by another commission.

## Workflows

A workflow is a start step and its steps by name, and, optionally, `usd`: the most its
commission's attempts may cost between the owner's decisions, in US dollars, as their steps report
it. Before each attempt, and as each report arrives, the engine adds what the commission's attempts
have cost since its latest decision; past the limit, or with an attempt since then that reported no
cost, the commission escalates, and the owner's retry starts the count again, as it renews a
budget. A workflow with an agent whose harness says `costs: false` cannot have one. `defineWorkflow` returns the workflow unchanged; it
exists so the compiler checks every step name an edge or query uses. Each step's `on` maps an
outcome to the next step or to `end`.

There are five kinds of step:

| Kind         | Runs                                             | Fields besides `kind` and `on`                                                                    |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `command`    | the owner's program, `run`                       | `run`, `watch`?, `workspace`, `inputs`, `claims`, `escalate`?, `budget`, `access`, `limits`?      |
| `agent`      | an agent through its harness adapter             | `agent`, `attended`?, `workspace`, `inputs`, `claims`, `escalate`?, `budget`, `access`, `limits`? |
| `approval`   | nothing: it waits for the owner                  | none                                                                                              |
| `children`   | nothing: it waits on child commissions           | see [Children](#children)                                                                         |
| `commission` | nothing: it starts commissions through a trigger | see [Commissions that start commissions](#commissions-that-start-commissions)                     |

The fields of a command or agent step:

- `workspace`: `"empty"`; `"subject"` to build the working directory from the current subject; or
  `{ input: "base" }` to build it from the one artifact the step's input `base` names, whatever the
  subject is, such as the commit a change starts from. That input must be `"subject"`, `"request"`
  or a query that takes the latest; if it names nothing, the commission escalates before an attempt
  starts. A commit is checked out with its history; a document is written to the file `document`.
  Built from an input, the workspace may add the artifacts another input names as branches,
  `{ input: "base", branches: "changes" }`: each is named `<input>-<n>`, `n` a child's number
  or else its position, from 1, and `input.json` gives each its `branch`. They must be of the
  base's kind, whose materialiser must say it can add them; the branches input may not be a
  session, a query across commissions, or a children query that takes all.
- `inputs`: what the step is given, by name. See [Inputs](#inputs).
- `claims`: the artifact kinds the step may claim, such as `["commit"]`; `[]` for none. A claim of
  any other kind escalates. A step need not claim what it lists. See
  [the step contract](step-contract.md#the-step-contract) for the kinds.
- `budget`: the attempts the step may start between the owner's decisions, above zero. It bounds
  every loop: a step that has spent its budget escalates.
- `access`: what the step's process may read, write and reach. See [Access](access.md#access).
- `limits`, optional: the ones the step changes from the factory's `defaults.limits`, which must
  name all seven, so every step has each. `@medrengard/core/defaults/limits.ts` holds a set to spread and
  change: 600 s idle, 3600 s per attempt, a 32 MiB transcript, 4 MiB of inputs, 4 GiB of memory,
  1024 processes and 4 GiB of disk. Each is over zero:
  - `idle`: seconds without output before the step is stopped; at an attended step, without
    output or the owner typing. An attended step may declare it `"unbounded"`;
  - `attempt`: seconds in all; `"unbounded"` too, only at an attended step;
  - `transcript`: bytes of stdout and stderr;
  - `input`: bytes of all input bodies, and an agent's prompt and skill files, together. Over it, the step
    never starts;
  - `memory`: bytes its processes may use together, shared memory included. Over it, systemd
    stops them, without swap, and the commission escalates naming the limit;
  - `processes`: processes and threads it may run at once. Past it, the step cannot start another,
    as its own failure;
  - `disk`: bytes its attempt's directory may hold: the workspace, input, output and the areas of
    its kind's programs. The engine measures it once a second while any of them runs and after each
    ends; over it, the program is stopped and the commission escalates. It can overshoot by a
    second of writes.

  Besides these, a step may state `usd`, optional and never one of the factory's defaults: the most
  an attempt may cost, in US dollars, as its step reports it on file descriptor 4 (see
  [the step contract](step-contract.md#the-step-contract)). The attempt is stopped as soon as a report goes over it,
  and the commission escalates naming it. Unknown cost is not zero: an attempt that ends without
  reporting any cost escalates too, even with a valid claim. An attended step reports nothing, so
  it cannot state one, nor can a step whose agent's harness says `costs: false`.

A kind's verifier and materialiser have bounds of their own; see [Kinds](kinds.md#kinds).

A command, agent or children step may route an escalation of one of its attempts to another step,
by its cause, in place of the owner:

```ts
implement: {
  kind: "agent",
  inputs: { earlier: { session: "implement" } },
  // An attempt whose engine died picks up its session again; a failed one goes to diagnose.
  escalate: { interrupted: "implement", exit: "diagnose", limit: "diagnose" },
  budget: 3,
  // ...
},
```

- The causes a step may route are `limit`, `claim`, `exit`, `kind`, `broker`, `interrupted` and
  `unmet`, and `any` for each of them without a route of its own. The rest are yours alone:
  `budget`, `money`, `repeat`, `inputs`, `engine`, `cancelled`, `withdrawn`, `upgrade` and
  `trigger`. A route leads to a step, never to `end`.
- Only an attempt's escalation is routed. One before an attempt starts, such as inputs over the
  input limit, waits for you whatever the step routes.
- The attempt spent a unit of its step's budget and a route renews none, so a step routed back to
  itself stops once its budget is spent, `Step implement has spent its budget of 3 attempts.`,
  and then waits for you.
- The step it goes on at is told why: its `input.json` holds `routed`, `{ "step": "implement",
  "attempt": 2, "cause": "exit", "reason": "Step implement exited with code 1." }`. It is given no
  transcript.
- `show` ends such an attempt's line with `On to diagnose.`, and `record` gives its `next`.

A command step may `watch: { interval, wait }`, to wait on something outside the commission, such
as CI or a review, without holding a program for the whole wait. Its attempt is the wait, a unit
of its budget, of at most `wait` seconds. Every `interval` seconds, at least 1, its program runs as
a check, under its limits, with its inputs and access and an empty workspace:

- a check that exits 0 without writing `output.json` found nothing yet; nothing is recorded, and
  the next runs an interval later;
- one that writes it claims, as any step does, and the attempt follows the outcome's edge;
- one that fails is recorded as the engine's note, `A check failed, and the wait goes on: …`, and
  the wait goes on. The third to fail in a row escalates with its reason;
- past `wait`, the commission escalates, `Step watch waited 259200 s, its wait limit.`; the owner
  can cancel it too.

Only one check runs at a time, whichever engines look, and an engine stopping does not interrupt
the wait: the next to look carries it on. [Landing on GitHub](github.md#landing-on-github) has one.

The engine refuses a workflow it could not run as written when it is commissioned, not halfway
through: among others, a step with no outcomes; a step that may claim a kind whose outcome field
has a value the step has no edge for, such as a verdict's `fail`; and a workspace that may be built
from a kind without a materialiser. For `"subject"` that is the document and every subject kind
any step claims; for an input, its `kind`, or else every kind its `from` steps may claim. A commission runs on the definition it started with, the factory's defaults included:
editing the factory affects only new commissions. The definition holds `run` as argv, not the program it names, so editing a script that
`run` points at changes every commission that runs it next. To pin a prompt, put its text in the
definition, not a path to it. An agent's skills are read when the commission starts and kept with
its definition, so editing a skill affects only new commissions. The engine is pinned as well:
commissioning and every attempt record the engine's version, a hash of the package's source,
its adapters and kinds' programs included, and an
upgraded engine never quietly changes how an unfinished commission goes on. Before its next
attempt, such a commission escalates, `Commission first last ran on engine 3f9a2c1d; this engine
is 7b01e4aa.`; the owner's retry carries it on with this engine, and abandoning ends it;
`medrengard accept` retries every commission escalated so, at once. Only a
decision on that escalation accepts the engine, not one at an approval step. A commission written
before engines recorded their version escalates the same way, once. A test keeps a log written on
2026-11-03 readable.

`src/definition.ts` exports what a factory is written in: `defineWorkflow` and the types
`Workflow`, `Agent`, `Access` and `Query`; `src/replay.ts`, the events and a commission's state. A `run` is a non-empty
argv, `readonly [string, ...string[]]`: a function that builds steps from a `string[]` must declare
that type, or the compiler refuses it.

Each attempt has a directory beside the log, `attempts/<sha256 of the commission>-<attempt>`,
holding its workspace, input and output, its kind's programs' areas, and its transcript and errors
as they arrive. It is removed once the attempt's end is written; an attempt whose engine died keeps
it until the next `advance` finds the attempt interrupted. So attempts live on the log's disk, not
in `TMPDIR`.

A step is never attempted twice on the same subject and inputs without the owner's decision between.
The second time, the commission escalates instead.

## Inputs

A step names each input and the query that fills it:

```ts
review: {
  kind: "agent",
  // ...
  inputs: {
    // The current subject, such as the commit under review.
    subject: "subject",
    // The owner's request.
    request: "request",
    // The latest document the design step claimed: the plan, after the subject became a commit.
    plan: { from: ["design"], kind: "document", take: "latest" },
    // Every verdict about the current subject: the evidence.
    evidence: { kind: "verdict", about: "subject" },
    // The owner's latest decision about the current subject, with its feedback.
    feedback: { kind: "decision", about: "subject", take: "latest" },
  },
},
```

A query searches every artifact in the commission, oldest first: the request, each artifact a step
claimed and each decision the owner made. Each field narrows it, and every field is optional:

| Field   | Keeps                                                                            |
| ------- | -------------------------------------------------------------------------------- |
| `from`  | artifacts claimed or decided at these steps                                      |
| `kind`  | artifacts of one kind: `document`, `commit`, `verdict` or `decision`             |
| `about` | judgements only: about the current `subject`, about `earlier` subjects, or `any` |
| `take`  | the `latest` one, or `all` of them, which is the default                         |

`{ kind: "verdict", about: "earlier" }`, for instance, gives a fix step the verdicts on the commits
its earlier fixes replaced. A query that finds nothing gives an empty list, not an error.

One more query is not over artifacts: `{ session: "implement" }` gives the latest session an attempt
of the step `implement` left, however that attempt ended, or none before it has left one. A session
is a harness's conversation, which the step's program leaves in its output as `session`; the
engine keeps it by hash and gives it to a later step whose query names it, which its adapter
continues. `input.json` lists it by its hash and body alone, with no kind or fields, and no
workspace is built from it. Its bytes count toward the input limit. A step that continues its own
session, `implement: { inputs: { earlier: { session: "implement" } } }`, picks up where its last
attempt left off, a failed one included, once the owner retries it.

A query may read related commissions: `{ across: "siblings", kind: "document", take: "latest" }`
gives each sibling's latest document. `across` is `origin`, the commission that started this one,
as its parent or through a commission step; `started`, those it started, in the order started; or
`siblings`, those the same attempt started, but this one. `from` names steps of their workflows and
`take` applies to each. They are read as they are when the attempt starts, finished or not, so a
sibling's plan is there before the sibling ends; the attempt records each by hash, and
`input.json` names the commission each came from. They reach one hop, take no `about`, and a
workspace is built from none of them.

A decision on an escalation is decided at the escalated step, so `from` keeps it too. Without a
`kind`, `{ from: ["design"], take: "latest" }` gives the owner's retry, not the plan, once design
has escalated and been retried.

A decision's fields are its `outcome` and the `subject` it names; the owner's feedback is its body,
at most 1 MiB.

An input name is also a directory in the step's input, so it may hold only letters, digits, `-` and
`_`, starting with a letter.

## Children

A children step fans out: it commissions child commissions of another workflow and waits on them,
bounded. Each child is a commission of its own, with its own record, subject and budgets, named
`<parent>.<step>.<attempt>.<n>`, so you see, decide, cancel or attend it by name like any other.

```ts
// One child per task document the plan claimed, three at a time; then gather their results.
fanOut: {
  kind: "children",
  workflow: "implement",
  each: { from: ["plan"], kind: "document" },
  width: 8,
  concurrent: 3,
  until: "all",
  on: { done: "gather" },
  budget: 1,
  limits: { wait: 6 * 3600 },
},
gather: {
  kind: "agent",
  inputs: { results: { children: "fanOut", kind: "document", take: "latest" } },
  // ...
},
```

- **Which children.** `each: <query>` makes one child per document it names, which is that
  child's request. `count: N` makes N, each on the parent's request, or on the document
  `request: <query>` names, taking the latest. More than `width` escalates before any child
  starts, spending no budget; at most `concurrent` are unfinished at once, the next commissioned as
  one finishes.
- **What they start with.** `given: { <name>: <query> }` names artifacts every child starts with,
  after its request; its first subject is the latest subject among them, or its request. Given
  the parent's `subject`, a child reviews or builds on the parent's work:
  `given: { change: "subject" }`.
- **What the parent waits for.** A child succeeds when its workflow reaches its end. `until` is
  `"all"`, `"first"` or `{ atLeast: N }`, following `done` once met and escalating once it can no
  longer be met; or it counts children that ended on an outcome, `{ all: "pass" }` or
  `{ atLeast: 2, outcome: "pass" }`, following `met` or `unmet`, as a review panel does:

  ```ts
  review: {
    kind: "children",
    workflow: "review",
    count: 3,
    given: { change: "subject" },
    width: 3,
    concurrent: 3,
    until: { atLeast: 2, outcome: "pass" },
    on: { met: "merge", unmet: "fix" },
    budget: 1,
    limits: { wait: 3600 },
  },
  ```

  A child that escalates waits for you as any commission does, and the parent waits on. Past
  `limits.wait` seconds, or when you cancel the parent, it escalates. Once the wait is decided,
  children still unfinished are withdrawn, one in flight stopped first and its transcript kept:
  they finish, recorded as withdrawn, not as your decision. A retry starts a fresh set.

- **Reading the results.** `{ children: <step>, kind, take }` gives a later step each child's
  latest artifact of that kind with `take: "latest"`, or all of them with `take: "all"`, for every child that reached
  its end, failed reviews included, in the order commissioned. `input.json` names each one's
  child.
- **Taking one as the parent's.** A step may adopt one of its inputs instead of writing a claim
  out, `{ "outcome": "done", "artifacts": [{ "adopt": "<hash>" }] }`, of a kind it may claim: the
  artifact is recorded as it is, kept files and all, and becomes the subject if it is one. So
  best-of-N is children, then a pick step that adopts the best child's commit.
- **Pinned.** The parent's commission records every workflow its children steps reach; children
  run on those, whatever the factory says later. A children step may not lead back to a workflow
  it is within, so nesting is bounded. Each child's spend is its own workflow's `usd`.
- **Run them with `run`.** Children advance like any commission, so `run` carries a fan-out
  through; `advance` on the parent returns while it waits.

## Triggers

Timers, cron and webhook receivers start work through a trigger the factory declares, never on
their own. The engine runs none of them: it checks the trigger's caps when commissioning and
records the trigger as the commission's origin.

```ts
export default {
  log: "state/log.sqlite",
  kinds,
  workflows,
  defaults: { limits },
  triggers: {
    nightly: {
      workflows: ["bump-deps"], // what it may start
      rate: { count: 1, per: 86400 }, // at most 1 a day
      unfinished: 1, // at most 1 of its commissions not finished at once
      usd: 5, // optional: at most $5 spent by those it started in the last day
    },
  },
};
```

```sh
# A systemd timer's or cron's command; it prints the commission's name, nightly-1.
medrengard commission bump-deps --trigger nightly --title "Bump dependencies" --body-file bump.md
```

- Past a cap, the commission is refused, with the reason on stderr and exit 1, and nothing is
  recorded: `Trigger nightly started 1 commission in the last 86400 s, its rate.`, `Trigger nightly
  has 1 unfinished commission, its limit.`, or, with `usd`, what its commissions cost. Unknown cost
  counts as over, so a trigger over a workflow whose harness reports no cost leaves `usd` out.
- Without a name, the commission is `<trigger>-<n>`, counting the trigger's commissions from 1.
- `show` says `Started by trigger nightly.`, and `record` has `origin: { trigger: "nightly" }`. The
  owner's own commissions have no trigger and no caps.
- Caps are read when commissioning, so editing a trigger affects the commissions it starts next.
- Instead of a rate, or as well, a trigger may have an `allowance`: at most that many commissions
  until the owner renews it with `medrengard renew <trigger>`, which counts its earlier ones no
  more. Past it: `Trigger nightly has started 5 commissions since it was last renewed, its
  allowance.` Without a rate, `usd` counts what those it started since it was last renewed cost.

### Commissions that start commissions

A `commission` step starts top-level commissions through a trigger, one per document `each` names,
each its request, and goes on at once: unlike a children step, it waits on none of them.

```ts
const steps = {
  plan: {
    kind: "agent",
    claims: ["document"], // one document per task
    // …
    on: { done: "spawn" },
  },
  spawn: {
    kind: "commission",
    trigger: "workers", // which must have an allowance
    workflow: "build", // which the trigger may start
    each: { from: ["plan"], kind: "document" }, // or "request", for one about the same request
    given: { brief: "request" }, // optional: artifacts each starts with, as a child's
    on: { done: "end" }, // done alone
    budget: 1,
  },
} as const;

const triggers = { workers: { workflows: ["build"], allowance: 20, unfinished: 5 } };
```

- Every commission that starts commissions is an unattended loop, so the step's trigger must have
  an `allowance`, which only the owner renews; a rate renews with time. An engine whose factory
  breaks this, or names a trigger it lacks or that may not start the workflow, refuses to start.
- All or none: if the trigger cannot start every one now, the step starts none and the commission
  escalates, `Step spawn would start 3 commissions through trigger workers, which has 2 of its
  allowance of 20 left.` Renew the trigger, or let some finish, and retry.
- Each is named after the trigger, `workers-1`, and runs on the factory's definitions when it
  starts, not its starter's, so a chain of commissions picks up an edited workflow. Abandoning
  the starter leaves them running.
- `show` says `Started by trigger workers, from commission first's step spawn, attempt 2.`, and
  `record`'s `origin` adds `from: { commission, step, attempt }`.
- A trigger's caps count every commission it started, by a step or a program outside the engine.

### Long-lived agents

An agent that keeps going across work, such as a foreman or a maintainer, is a chain of finite
commissions, each a link that ends by starting the next. Each link runs on the definitions current
when it starts, so an edited workflow reaches the chain at its next link, and none grows without
end.

```ts
const mayor = defineWorkflow({
  start: "work",
  steps: {
    // Works from its memory, the subject: the request in the first link, the approved memory after.
    work: {
      kind: "agent",
      workspace: "subject",
      claims: ["document"],
      on: { done: "remember" } /* … */,
    },
    // Memory steers every later link, so the owner approves each change to it.
    remember: { kind: "approval", on: { approve: "next" } },
    next: {
      kind: "commission",
      trigger: "mayor",
      workflow: "mayor",
      each: "request", // the same standing request
      given: { memory: "subject" }, // the approved memory, the next link's first subject
      on: { done: "end" },
      budget: 1,
    },
  },
});

const triggers = { mayor: { workflows: ["mayor"], allowance: 20, unfinished: 2, usd: 50 } };
```

```sh
medrengard commission mayor --trigger mayor --title "Mayor" --body-file standing-orders.md
```

- **Identity** is the trigger: its links are `mayor-1`, `mayor-2` and on, each naming the one before
  as its origin.
- **The bound** is the trigger's allowance, pooled across the chain, and its money limit. Once it is
  spent the link escalates; `medrengard renew mayor` and a retry carry it on.
- **Memory** is a document the owner approves before it reaches the next link. A link reads earlier
  links' artifacts with `{ across: "origin", … }`, one link back; older history lives in the memory.
- **Talking to it** is an attended step in its workflow.

## Preparing a workspace

A step whose program needs its workspace prepared first, such as dependencies installed, wraps its
`run` with `prepare` from `@medrengard/core/defaults/prepare.ts`:

```ts
import { prepare } from "@medrengard/core/defaults/prepare.ts";

const implement = {
  kind: "agent",
  agent: {
    harness: {
      run: prepare("npm ci", ["node", "/path/to/medrengard/core/adapters/claude-code.ts"]),
    },
    // ...
  },
  // ...
};
```

The command runs with `sh -c` in the step's workspace, before the step's program and in the same
attempt: a step of its own could not hand the workspace on, since steps share state only through
artifacts. If it fails, the step exits with its code before the program starts, so the commission
escalates without the agent spending anything, and a note says
`Preparation failed: npm ci exited with 1.`; its stderr is the attempt's errors. If it succeeds, a
note says how long it took. It has the step's access, network included, and counts toward the
step's limits and transcript like anything else the step runs. Nothing is cached: every attempt
prepares again.
