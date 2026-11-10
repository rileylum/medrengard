# Workflows

How you write a workflow: its steps, what each step is given, how a step fans out to child commissions, and how a timer or another commission starts one.

## Workflows

A workflow is a graph of steps. Each step's `on` maps an outcome to the next step, or to `end`.

```ts
import { defineWorkflow } from "@medrengard/core/src/definition.ts";

export const draft = defineWorkflow({
  start: "write",
  usd: 20, // optional: the commission's money limit
  steps: {
    write: {
      kind: "agent",
      agent: writer,
      workspace: "empty",
      inputs: { request: "request", feedback: { kind: "decision", take: "latest" } },
      claims: ["document"],
      on: { done: "approve" },
      budget: 3,
      access: claudeCode,
      limits: { attempt: 2 * 3600, usd: 5 },
    },
    approve: { kind: "approval", on: { approve: "end", revise: "write" } },
  },
});
```

- `start` names the step a commission starts at. No step may be named `end`.
- `defineWorkflow` returns the workflow unchanged. It makes the compiler check every step name an edge, a route or a query uses.
- A factory lists its workflows by name, in `export default { log, kinds, workflows, defaults } satisfies Factory`, with `Factory` from the same module. See [the README](../core/README.md).

## Steps

| Kind         | What it does                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `command`    | Runs your program, `run`. With `watch`, runs it as a check each interval: see [Watching](#watching).   |
| `agent`      | Runs an agent through its harness adapter. With `attended: true`, in your terminal.                    |
| `approval`   | Waits for your decision. It has only `on`, which cannot list `abandon`: you may abandon at every wait. |
| `children`   | Starts child commissions and waits on them. See [Children](#children).                                 |
| `commission` | Starts commissions through a trigger and waits on none. See [Commission steps](#commission-steps).     |

A command or agent step states:

| Field       | Meaning                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `run`       | A command step's program: a non-empty argv, typed `readonly [string, ...string[]]`.                |
| `agent`     | An agent step's harness, model, prompt and any skills. See [Agents](agents.md).                    |
| `workspace` | What the working directory is built from. See [Workspace](#workspace).                             |
| `inputs`    | What the step is given, by name; `{}` for nothing. See [Inputs](#inputs).                          |
| `claims`    | The artifact kinds the step may claim, such as `["commit"]`; `[]` for none. See [Kinds](kinds.md). |
| `on`        | The next step, or `end`, for each outcome. At least one.                                           |
| `budget`    | The attempts the step may start between your decisions. A positive integer.                        |
| `access`    | What the step's process may read, write and reach. See [Access](access.md).                        |
| `limits`    | Optional. See [Limits](#limits) and [Money](#money).                                               |
| `escalate`  | Optional. See [Escalation routes](#escalation-routes).                                             |

- A claim of a kind the step does not list escalates. A step need not claim every kind it lists.
- If a kind has an outcome field, as a verdict has, the step needs an edge for each of its values: `pass` and `fail`.
- A step that has spent its budget escalates: `Step write has spent its budget of 3 attempts.` Only your decision renews a budget, so every loop ends.
- A step is not attempted twice on the same subject and inputs unless your decision or a route comes between. The second time, the commission escalates with the cause `repeat`.

## Workspace

The workspace is the directory a step's program runs in.

| Value                                    | The workspace is                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `"empty"`                                | An empty directory.                                                       |
| `"subject"`                              | Built from the current subject.                                           |
| `{ input: "base" }`                      | Built from the one artifact the step's input `base` names.                |
| `{ input: "base", branches: "changes" }` | The same, with the artifacts the input `changes` names added as branches. |

```ts
merge: {
  kind: "agent",
  workspace: { input: "base", branches: "changes" },
  inputs: {
    base: "subject",
    changes: { children: "fanOut", kind: "commit", take: "latest" },
  },
  // ...
},
```

- The kind's materialiser builds it. The built-in ones check a commit out with its history, and write a document's body to the file `document`.
- The base input must be `"subject"`, `"request"`, or a query over the commission's own record with `take: "latest"`.
- If it names no artifact when the step is reached, the commission escalates before an attempt starts: `Step merge's workspace input base holds no artifact.`
- Each branch is named `<input>-<n>`: `n` is the child's number for a child's artifact, or else the artifact's position, from 1. `input.json` gives each artifact its `branch`.
- The branches input may not be a session, an `across` query, or a children query with `take: "all"`.
- The kind's materialiser must state `branches: true`. Of the built-in kinds, only commit's does.
- Each branch must be of the base's kind, or the commission escalates when the step is reached.

## Limits

Every command and agent step has seven limits. The factory's `defaults.limits` states all seven; a step's `limits` states those it changes. `@medrengard/core/defaults/limits.ts` exports a set, `limits`, to use as it is or to spread and change.

| Limit        | Unit    | Bounds                                                                                   | In that set |
| ------------ | ------- | ---------------------------------------------------------------------------------------- | ----------- |
| `idle`       | seconds | Time without output. At an attended step, without output or your typing.                 | 600         |
| `attempt`    | seconds | The whole attempt.                                                                       | 3600        |
| `transcript` | bytes   | Its stdout and stderr, with its notes and usage reports.                                 | 32 MiB      |
| `input`      | bytes   | All its input bodies together, with an agent's prompt and skill files.                   | 4 MiB       |
| `memory`     | bytes   | What its processes use together, shared memory included. There is no swap.               | 4 GiB       |
| `processes`  | count   | The processes and threads it runs at once.                                               | 1024        |
| `disk`       | bytes   | Its attempt directory: workspace, input, output, scratch paths and kind programs' areas. | 4 GiB       |

- `idle` and `attempt` are positive numbers, at most 2147483. Only an attended step may state `"unbounded"` for either. The rest are positive integers.
- Over `input`, the commission escalates before an attempt starts, so no budget is spent.
- Over `idle`, `attempt`, `transcript`, `memory` or `disk`, the engine stops the step and the commission escalates with the cause `limit`, naming the limit.
- At `processes`, the step cannot start another process. That failure is the step's own to handle.
- The engine measures `disk` once a second while a program runs and after each ends, so a step can overshoot by a second of writes.
- A kind's verifier and materialiser have limits of their own. See [Kinds](kinds.md).

## Money

Money limits are optional, in US dollars, and never a factory default. They count the cost a step reports on file descriptor 4; see [the step contract](step-contract.md).

- A step's `limits.usd` bounds one attempt of the step.
- A workflow's `usd` bounds all the commission's attempts since your latest decision. Your retry starts the count again, as it renews a budget.
- Reaching either escalates with the cause `money`. The engine stops an attempt as soon as a report puts it over.
- Unknown cost is not zero. An attempt with a step limit that ends without reporting a cost escalates, even with a valid claim. A commission with a workflow limit escalates before its next attempt if one since your latest decision ran and reported no cost.
- An attended step reports no cost, so it cannot state `usd`.
- An agent whose harness states `costs: false` reports no cost. Its step cannot state `usd`, and neither can a workflow with such a step.
- Children and commission steps cost nothing themselves. A child's spend counts against its own workflow's `usd`.

## Escalation routes

An escalation pauses the commission for you. With `escalate`, a command, agent or children step sends an escalation of one of its attempts to another step instead, by its cause.

```ts
implement: {
  kind: "agent",
  inputs: { earlier: { session: "implement" } },
  // An interrupted attempt continues its session. A failed one goes to diagnose.
  escalate: { interrupted: "implement", exit: "diagnose", limit: "diagnose" },
  budget: 3,
  // ...
},
```

Every escalation has one of sixteen causes. A step may route seven:

| Cause         | Meaning                                                    | Which step may route it  |
| ------------- | ---------------------------------------------------------- | ------------------------ |
| `limit`       | A declared limit was reached, other than money.            | command, agent, children |
| `claim`       | The claim was invalid, or its kind's verifier rejected it. | command, agent           |
| `exit`        | The step's program failed or could not start.              | command, agent           |
| `kind`        | A kind's verifier or materialiser failed.                  | command, agent           |
| `broker`      | A broker did not start.                                    | command, agent           |
| `interrupted` | No engine was running the attempt.                         | command, agent           |
| `unmet`       | A children step's wait can no longer be met.               | children                 |

The other nine always wait for you: `budget`, `money`, `repeat`, `inputs`, `engine`, `cancelled`, `withdrawn`, `upgrade` and `trigger`. A workflow that routes one is refused when commissioned.

- A route leads to a step of the workflow, never to `end`.
- `any` covers every cause the step may route that has no route of its own.
- Only an attempt's escalation is routed. One before an attempt starts, such as inputs over the input limit, waits for you whatever the step routes.
- A route renews nothing. The attempt spent a unit of its step's budget, so a step routed back to itself stops once its budget is spent, and then waits for you.
- The step the commission goes on at is told why. Its `input.json` holds `routed`: `{ "step": "implement", "attempt": 2, "cause": "exit", "reason": "Step implement exited with code 1." }`. It is given no transcript.
- `show` ends the routed attempt's line with `On to diagnose.`, and `record` gives the entry's `next`.

## Watching

A watching step waits on something outside the commission, such as CI or a review, without holding a program for the whole wait. It is a command step with `watch`.

```ts
ci: {
  kind: "command",
  run: ["node", "/path/to/factory/steps/ci-status.ts"],
  // Check every 60 s, at least 1. Wait at most three days, at most 2147483 s.
  watch: { interval: 60, wait: 3 * 86400 },
  workspace: "empty",
  inputs: { change: "subject" },
  claims: ["verdict"],
  on: { pass: "merge", fail: "fix" },
  budget: 1,
  access: { ...node, network: { hosts: ["api.github.com"] } },
},
```

The attempt is the wait, and spends one unit of the step's budget. Every `interval` seconds the program runs as a check, under the step's limits and access, with the attempt's inputs.

- A check that exits 0 without writing `output.json` found nothing yet. Nothing is recorded, and the next check runs an interval later.
- A check that writes `output.json` claims, as any step does. The attempt ends and follows the outcome's edge.
- A check that fails leaves the engine's note, `A check failed, and the wait goes on: …`, and the wait goes on. The third to fail in a row escalates with its reason.
- Past `wait`, the commission escalates with the cause `limit`: `Step ci waited 259200 s, its wait limit.` Cancelling escalates too.
- The workspace must be `"empty"`: each check runs in an empty workspace.
- Only one check runs at a time, however many engines look.
- An engine stopping does not interrupt the wait. The next engine to look carries it on.

[Landing on GitHub](github.md) has a watching step.

## What is refused when commissioned

The engine checks the whole workflow when you commission it and refuses one it could not run as written, recording nothing. `medrengard check` runs the same checks alone. Each message starts `Workflow <name> is invalid:`. It refuses, among others:

- an edge or a route to a step the workflow lacks;
- a step with no outcomes, or with a field its kind of step does not define;
- a step that may claim a kind whose outcome field has a value the step has no edge for;
- a workspace that may be built from a kind without a materialiser. For `"subject"` that is the document and every subject kind any step claims; for an input, the query's `kind`, or else every kind its `from` steps may claim;
- a workspace that may add branches of a kind whose materialiser cannot add them;
- a query that names a step or a kind there is not, or a field or value its form does not define.

The types refuse some combinations earlier: a money limit or unbounded time at the wrong step, a watching step with a workspace other than `"empty"`, a children step with both `each` and `count`, and one with `request` but no `count`.

## What a commission is pinned to

A commission runs on the definition it started with: its workflow, the workflows its children steps reach, the kinds and the factory's default limits. Editing the factory affects only new commissions. `medrengard definition <commission>` shows it.

- A prompt's text and the files of an agent's skills are in the definition. To pin a prompt, put its text there, not a path to it.
- A `run` is held as argv, not the program it names. Editing a script that `run` names changes every commission that runs it next.

The engine is pinned too. Commissioning and every attempt record the engine's version: a hash of the package's TypeScript source, its adapters and kinds' programs included, its tests not.

- Before an attempt on another engine, the commission escalates with the cause `upgrade`: `Commission first last ran on engine 3f9a2c1d; this engine is 7b01e4aa.`
- Your retry carries it on with this engine. Abandoning ends it. A decision at an approval step does not accept the engine.
- `medrengard accept` retries every commission escalated so, at once.

## The attempt directory

Each attempt has a directory beside the log, `attempts/<sha256 of the commission's name>-<attempt>`. It holds the attempt's workspace, input, output and kind programs' areas, and its transcript and errors as they arrive. So attempts use the log's disk, not `TMPDIR`.

The engine removes it once the attempt's end is written. An attempt whose engine died keeps it until the next engine to look finds the attempt interrupted.

## Inputs

A step sees only the inputs it names. Each input is a name and a query. The name is also a directory in the step's input, so it holds only letters, digits, `-` and `_`, and starts with a letter.

```ts
review: {
  kind: "agent",
  inputs: {
    // The current subject, such as the commit under review.
    subject: "subject",
    // Your request, a document.
    request: "request",
    // The latest document the design step claimed.
    plan: { from: ["design"], kind: "document", take: "latest" },
    // Every verdict about the current subject: the evidence.
    evidence: { kind: "verdict", about: "subject" },
    // Your latest decision about the current subject, with its feedback.
    feedback: { kind: "decision", about: "subject", take: "latest" },
  },
  // ...
},
```

There are six forms of query: `"subject"`, `"request"`, and the four below. Every input is a list in `input.json`, oldest first. A query that finds nothing gives an empty list, not an error.

**Over the record: `{ from?, kind?, about?, take? }`.** It searches every artifact in the commission: the request, each artifact a step claimed, and each of your decisions. Each field narrows it.

| Field   | Keeps                                                                                   |
| ------- | --------------------------------------------------------------------------------------- |
| `from`  | Artifacts claimed or decided at these steps. The request is from no step.               |
| `kind`  | Artifacts of one kind: one of the factory's kinds, or `decision`.                       |
| `about` | Judgements only: about the current `"subject"`, about `"earlier"` subjects, or `"any"`. |
| `take`  | `"latest"` for the last one, or `"all"`, the default.                                   |

- `{ kind: "verdict", about: "earlier" }` gives a fix step the verdicts on the subjects its earlier fixes replaced.
- A decision's fields are its `outcome` and the `subject` it names. Your feedback is its body, at most 1 MiB.
- A decision on an escalation is decided at the escalated step, so `from` keeps it. Without a `kind`, `{ from: ["design"], take: "latest" }` gives your retry, not the plan, once design has escalated and been retried.

**A session: `{ session: "implement" }`.** A session is a harness's conversation. A step's program leaves it in its output as the file `session`, and the engine keeps it however the attempt ends, if it is within the step's transcript limit.

- The query gives the latest session an attempt of the step left, or none. The step must be a command or agent step.
- The harness adapter continues it. A step that names its own session picks up where its last attempt left off, a failed one included.
- A session is no artifact. `input.json` lists it by its hash and body alone, and no workspace is built from it.
- Its bytes count toward the input limit.

**Children: `{ children: <step>, kind, take }`.** What the children of a children step claimed. See [Children](#children).

**Across commissions: `{ across: <relation>, from?, kind?, take? }`.** It reads the records of related commissions, one hop away. `{ across: "siblings", kind: "document", take: "latest" }` gives each sibling's latest document.

| Relation     | The commissions                                                            |
| ------------ | -------------------------------------------------------------------------- |
| `"origin"`   | The one that started this one, as its parent or through a commission step. |
| `"started"`  | Those this one started, in the order started.                              |
| `"siblings"` | Those the same attempt started, but this one.                              |

- `from` names steps of their workflows, which the engine cannot check. `take` applies to each commission.
- They are read as they are when the attempt starts, finished or not. A sibling's plan is there before the sibling ends.
- `input.json` names the `commission` each artifact came from.
- There is no `about`. No workspace is built from them, and none is added as a branch.

## Children

A children step fans out. It starts child commissions of another workflow and waits on them, for a bounded time. Each child is a commission of its own, with its own record, subject and budgets. It is named `<parent>.<step>.<attempt>.<n>`, so you show, decide, cancel or attend it by name like any other.

```ts
// One child per task document the plan step claimed, three at a time.
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
// Then a step reads each child's latest document.
gather: {
  kind: "agent",
  inputs: { results: { children: "fanOut", kind: "document", take: "latest" } },
  // ...
},
```

| Field         | Meaning                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `workflow`    | The factory's workflow each child runs.                                                                  |
| `each`        | A query with `kind: "document"`: one child per document, its request. State this or `count`.             |
| `count`       | A number of children, at most `width`, each on the parent's request.                                     |
| `request`     | Optional, with `count`: a document query with `take: "latest"`, to use in place of the parent's request. |
| `given`       | Optional. Artifacts every child starts with, as `{ <name>: <query> }`. Any query but a session.          |
| `width`       | The most children the step may have.                                                                     |
| `concurrent`  | The most children unfinished at once, at most `width`. The next is commissioned as one finishes.         |
| `until`       | What the step waits for.                                                                                 |
| `on`          | `done` alone, or `met` and `unmet`, as `until` decides.                                                  |
| `escalate`    | Optional. Routes for `limit`, `unmet` and `any`. See [Escalation routes](#escalation-routes).            |
| `budget`      | The attempts the step may start between your decisions. The attempt is the wait.                         |
| `limits.wait` | The wait limit, in seconds. A positive integer.                                                          |

A child starts with its request, then the artifacts `given` names. Its first subject is the latest subject among those, or else its request. With `given: { change: "subject" }`, a child reviews or builds on the parent's work. A `given` name may not be `each` or `request`.

A child succeeds when its workflow reaches its end. `until` says how many must:

- `"all"`, `"first"` or `{ atLeast: N }`: every child, one, or N. Once met, the step follows `done`. Once it can no longer be met, it escalates with the cause `unmet`.
- `{ all: "pass" }` or `{ atLeast: N, outcome: "pass" }`: every child, or N, must end on the outcome `pass`. The step follows `met`, or `unmet` once it can no longer be met. The child workflow must be able to end on that outcome.

A review panel is `count: 3`, `given: { change: "subject" }`, `until: { atLeast: 2, outcome: "pass" }` and `on: { met: "merge", unmet: "fix" }`.

- More documents than `width` escalates before any child starts, spending no budget: `Step fanOut has 9 children to start, over its width of 8.`
- A child that escalates waits for you, as any commission does, and the parent waits on.
- Past `limits.wait`, the step escalates with the cause `limit`: `Step fanOut waited 21600 s for its children, its wait limit.` Cancelling the parent escalates too.
- Once the wait is decided, the children still unfinished are withdrawn, an attempt in flight stopped first and its transcript kept. They finish as withdrawn, which is not your decision. A retry starts a fresh set.
- Children run on the workflow as the parent's commission pinned it. A children step may not lead back to a workflow it is within, so nesting is bounded.
- An engine stopping does not interrupt the wait. `advance` on the parent returns while it waits; `run` advances the children too, and carries the fan-out through.

**Reading the results.** `{ children: <step>, kind, take }` reads the children of the step's latest attempt. `take` is required: `"latest"` gives each child's latest artifact of the kind, `"all"` all of them.

- It reads every child that reached its workflow's end, on any outcome, in the order commissioned: a failed review, but not an abandoned or withdrawn child.
- `input.json` names the `commission` each artifact came from.

**Taking a child's artifact as the parent's.** A step may adopt one of its inputs instead of writing a claim out: `{ "outcome": "done", "artifacts": [{ "adopt": "<hash>" }] }`. The artifact must be of a kind the step may claim, and not the current subject. It is recorded as it is, with its kept files, and becomes the subject if it is a subject. So best-of-N is a children step, then a step that adopts the best child's commit.

## Triggers

A trigger is how a program outside the engine, such as a timer, cron or a webhook's receiver, starts a commission. The factory declares it. The engine runs none of those programs: it checks the trigger's caps when commissioning, and records the trigger as the commission's origin.

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
      unfinished: 1, // at most 1 of its commissions unfinished at once
      usd: 5, // optional: none once those it started in the last day cost $5
    },
  },
} satisfies Factory;
```

```sh
# A systemd timer's or cron's command. It prints the commission's name, nightly-1.
medrengard commission bump-deps --trigger nightly --title "Bump dependencies" --body-file bump.md
```

- A trigger states a `rate`, an `allowance`, or both. An allowance is the most commissions it may start until you renew it, with `medrengard renew <trigger>`.
- Past a cap, the commission is refused and nothing is recorded. The CLI prints the reason on stderr and exits 1:
  - `Trigger nightly started 1 commission in the last 86400 s, its rate.`
  - `Trigger nightly has started 5 commissions since it was last renewed, its allowance.`
  - `Trigger nightly has 1 unfinished commission, its limit.`
- `usd` counts the commissions started in the last `rate.per` seconds, or without a rate, since the trigger was last renewed. Unknown cost counts as over it, so leave `usd` out for a workflow whose harness reports no cost.
- Without a name, the commission is `<trigger>-<n>`, numbering the trigger's commissions from 1. To name it: `medrengard commission <workflow> [<name>] [--trigger <t>] --title … --body …`, or `engine.commission(workflow, request, { name, trigger })`.
- `show` says `Started by trigger nightly.`, and `record` has `origin: { trigger: "nightly" }`. Your own commissions have no trigger and no caps.
- Caps are read when commissioning, so editing a trigger affects the commissions it starts next.
- An engine refuses to start on a factory with an invalid trigger: `Trigger nightly is invalid: …`.

### Commission steps

A commission step starts top-level commissions through a trigger and goes on at once. Unlike a children step, it waits on none of them.

```ts
const steps = {
  spawn: {
    kind: "commission",
    trigger: "workers", // must have an allowance
    workflow: "build", // must be one the trigger may start
    each: { from: ["plan"], kind: "document" }, // one per document, its request; or "request"
    given: { brief: "request" }, // optional: artifacts each starts with, as a child's
    on: { done: "end" }, // done alone
    budget: 1,
  },
};

const triggers = { workers: { workflows: ["build"], allowance: 20, unfinished: 5 } };
```

- The trigger must have an `allowance`. Commissions that start commissions are a loop no budget bounds, and only you renew an allowance; a rate renews with time.
- An engine refuses to start on a factory whose commission step names a trigger it lacks, one without an allowance, or one that may not start the workflow.
- All or none. If the trigger cannot start every one now, the step starts none and the commission escalates with the cause `trigger`: `Step spawn would start 3 commissions through trigger workers, which has 2 of its allowance of 20 left.` Renew the trigger, or let some finish, and retry.
- Each is named after the trigger, `workers-1`, and runs on the factory's definitions as they are when it starts, not its starter's.
- Each is no child. Nothing withdraws it, and abandoning the starter leaves it running.
- `show` says `Started by trigger workers, from commission first's step spawn, attempt 2.`, and `record`'s `origin` adds `from: { commission, step, attempt }`.
- A trigger's caps count every commission it started, whether a step or a program outside the engine started it.

### Long-lived agents

An agent that keeps going across pieces of work, such as a foreman or a maintainer, is a chain of finite commissions. Each is a link that ends by starting the next.

```ts
const mayor = defineWorkflow({
  start: "work",
  steps: {
    // Works from its memory, the subject: the request in the first link, the approved memory after.
    work: {
      kind: "agent",
      workspace: "subject",
      claims: ["document"],
      on: { done: "remember" },
      // ...
    },
    // You approve each change to the memory.
    remember: { kind: "approval", on: { approve: "next" } },
    next: {
      kind: "commission",
      trigger: "mayor",
      workflow: "mayor",
      each: "request", // the same standing request
      given: { memory: "subject" }, // the approved memory: the next link's first subject
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

- **Identity** is the trigger. Its links are `mayor-1`, `mayor-2` and on, each naming the one before as its origin.
- **The bound** is the trigger's allowance, shared by the whole chain, and its money limit. Once either is spent the link escalates; `medrengard renew mayor` and a retry carry it on.
- **Memory** is a document you approve before it reaches the next link. A link reads the link before it with `{ across: "origin", … }`. Older history lives in the memory.
- **Definitions** are those current when each link starts, so an edited workflow reaches the chain at its next link.
- **Talking to it** is an attended step in its workflow.

## Preparing a workspace

`prepare` runs a shell command in the workspace before a step's program, such as installing dependencies. It wraps a command step's `run` or an agent's `harness.run`.

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

- The command runs with `sh -c` in the step's workspace, in the same attempt as the program.
- It has the step's access, network included, and counts toward the step's limits and transcript.
- If it fails, the step exits with its code before the program starts. The commission escalates with the cause `exit`, and the agent spends nothing. A note says `Preparation failed: npm ci exited with 1.`, and the command's stderr is in the attempt's errors.
- If it succeeds, a note says how long it took: `Prepared in 12 s: npm ci`.
- Nothing is cached. Every attempt prepares again.
