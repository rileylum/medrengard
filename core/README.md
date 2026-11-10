# Medrengard

Medrengard is a framework for building a personal software factory: workflows that take an idea
to merged code, on your own machine.

You write a workflow as a graph of steps. Some steps run a coding agent, some run your own
programs, and some wait for you. Medrengard runs each step in a sandbox, records everything it
did, and stops to ask you whenever something goes wrong or needs your approval.

It gives you:

- **A record you can trust.** Every attempt, artifact and decision is kept in a log. An agent's
  output is a claim until it is checked: a claimed commit, for example, must be the workspace's
  `HEAD`.
- **Safety by default.** Steps run in [bubblewrap](https://github.com/containers/bubblewrap) with
  no network, no home directory and no credentials unless you grant them.
- **Bounds on everything.** Every step has a budget of attempts and limits on time, output, memory
  and disk. Nothing loops or grows without you renewing it.
- **You in the loop.** Approvals are steps. A failure pauses the work for you, with its cause.

Medrengard is one package, `@medrengard/core`, with no runtime dependencies. It is not published
yet: you install it from a checkout. [`docs/core.md`](../docs/core.md) holds its principles and
the exact rules it keeps.

## Contents

- [Requirements](#requirements)
- [A first factory](#a-first-factory)
- [The words](#the-words)
- [Writing a workflow](#writing-a-workflow)
- [When a step fails](#when-a-step-fails)
- [Access](#access)
- [Running a factory](#running-a-factory)
- [Writing a step's program](#writing-a-steps-program)
- [Using the engine from TypeScript](#using-the-engine-from-typescript)
- [Reference](#reference)

## Requirements

- Linux, with `bwrap` (bubblewrap) on your `PATH`.
- systemd, with your user manager running, so that `systemd-run --user` works. It bounds each
  step's memory and processes.
- Node 24. It runs the TypeScript files directly; nothing is built.
- Git, for workflows that make commits.
- A readable `/proc`. The engine uses it to tell a running attempt from one whose engine stopped.

## A first factory

A factory is a TypeScript module. It says where the log lives, which kinds of artifact steps may
claim, and which workflows there are. This one has two steps: a program writes a reply to your
request, then you approve it.

Make a directory for the factory and install Medrengard into it from your checkout:

```sh
mkdir my-factory && cd my-factory
npm init -y && npm pkg set type=module
npm install ~/dev/medrengard/core
```

Write the step's program:

```ts
// steps/reply.ts
import { artifactsOf, bodyOf, claim, note, readInput } from "@medrengard/core/step/contract.ts";

const given = readInput();
const [request] = artifactsOf(given, "request");

note(`Replying to ${request?.fields.title}`);
claim("done", [
  {
    kind: "document",
    fields: { title: "Reply" },
    text: `Hello. You asked: ${bodyOf(request ?? {})}`,
  },
]);
```

Write the factory:

```ts
// factory.ts
import { node } from "@medrengard/core/defaults/access.ts";
import { builtIn } from "@medrengard/core/defaults/kinds.ts";
import { limits } from "@medrengard/core/defaults/limits.ts";
import { defineWorkflow, type Access, type Factory } from "@medrengard/core/src/definition.ts";

const here = import.meta.dirname;

// What this factory's own steps may see: Node, the step contract's module, and these two.
const access = {
  ...node,
  paths: [
    ...node.paths,
    { path: `${here}/steps`, mode: "read" },
    { path: `${here}/node_modules`, mode: "read" },
  ],
} satisfies Access;

export default {
  log: "state/log.sqlite",
  kinds: builtIn,
  defaults: { limits },
  workflows: {
    greet: defineWorkflow({
      start: "write",
      steps: {
        // Runs steps/reply.ts, which claims a document: the reply.
        write: {
          kind: "command",
          run: [process.execPath, `${here}/steps/reply.ts`],
          workspace: "empty",
          inputs: { request: "request" },
          claims: ["document"],
          on: { done: "approve" },
          budget: 2,
          access,
        },
        // Waits for you.
        approve: { kind: "approval", on: { accept: "end", changes: "write" } },
      },
    }),
  },
} satisfies Factory;
```

`satisfies Factory` makes the compiler check the whole module as you write it. `defineWorkflow`
checks that every step name an edge uses exists.

Run it:

```sh
export MEDRENGARD_FACTORY=$PWD/factory.ts
alias medrengard="node node_modules/@medrengard/core/cli/medrengard.ts"

medrengard check
# greet: ok

medrengard commission greet first --title Greet --body "Say hello."
medrengard advance first
# awaiting at approve since event 3, about 3b662a27…

medrengard show first
# 1 write        done (0.1 s)
#     document  3b662a27  Reply  (no verifier)
# …
# Hello. You asked: Say hello.

medrengard decide first accept --subject 3b662a27… --since 3
# finished by end
```

`advance` runs steps until the commission needs you, fails or finishes. `decide` must name the
subject and the wait you saw, so you can never approve something that changed after you looked.
`--subject` takes the full hash, which `state` and `advance` print; it is shortened here.

## The words

| Word       | Meaning                                                                                |
| ---------- | -------------------------------------------------------------------------------------- |
| Factory    | Your workflows, kinds and defaults: one TypeScript module.                             |
| Workflow   | A graph of steps. Each step's `on` maps an outcome to the next step, or to `end`.      |
| Commission | One request taken through one workflow, with its whole history.                        |
| Attempt    | One run of a step's program within a commission.                                       |
| Artifact   | A hashed record of what a step produced, such as a document, a commit or a verdict.    |
| Kind       | What an artifact holds and how a claim of it is checked.                               |
| Subject    | The artifact the commission is currently about: its latest document or commit.         |
| Outcome    | The label a step ends on, such as `done` or `fail`. The engine follows its edge.       |
| Escalation | A step that could not go on. The commission pauses for you, with a cause and a reason. |
| Decision   | Your answer at an approval step or on an escalation.                                   |

## Writing a workflow

### Steps

There are five kinds of step.

| Kind         | What it does                                                                   |
| ------------ | ------------------------------------------------------------------------------ |
| `command`    | Runs your program. With `watch`, runs it again every interval until it claims. |
| `agent`      | Runs a coding agent through a harness adapter, such as Claude Code or Codex.   |
| `approval`   | Waits for your decision.                                                       |
| `children`   | Starts child commissions of another workflow and waits on them.                |
| `commission` | Starts separate commissions through a trigger and goes on at once.             |

A command or agent step states:

| Field       | Meaning                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| `workspace` | `"empty"`, `"subject"` (built from the current subject), or `{ input: "base" }`. |
| `inputs`    | What the step is given, by name. See [Inputs](#inputs).                          |
| `claims`    | The kinds of artifact it may claim, such as `["commit"]`.                        |
| `on`        | Where each outcome leads.                                                        |
| `budget`    | How many attempts it may start before it needs your decision.                    |
| `access`    | What its process may read, write and reach. See [Access](#access).               |
| `limits`    | Optional: the limits it changes from the factory's defaults.                     |
| `escalate`  | Optional: where to send a failure instead of to you.                             |

An agent step also names its agent:

```ts
import { claudeCode } from "@medrengard/core/defaults/access.ts";

const implement = {
  kind: "agent",
  agent: {
    harness: { run: ["node", "/path/to/medrengard/core/adapters/claude-code.ts"] },
    model: "sonnet",
    prompt: "Implement the plan and commit your work.",
  },
  workspace: "subject",
  inputs: { plan: { from: ["design"], kind: "document", take: "latest" } },
  claims: ["commit"],
  on: { done: "review" },
  budget: 3,
  access: claudeCode,
} as const;
```

Add `attended: true` to run an agent step with you in your terminal. See
[agents](../docs/agents.md).

### Inputs

A step sees only what its `inputs` name. Each input is a name and a query:

| Query                                       | Gives the step                                                       |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `"subject"`                                 | The current subject.                                                 |
| `"request"`                                 | Your request.                                                        |
| `{ from?, kind?, about?, take? }`           | Artifacts from this commission's record, oldest first.               |
| `{ session: "step" }`                       | The conversation an earlier attempt of that step left, to continue.  |
| `{ children: "step", kind, take }`          | What a children step's children claimed.                             |
| `{ across: "origin", kind?, from?, take? }` | Artifacts of related commissions: `origin`, `started` or `siblings`. |

```ts
inputs: {
  // The latest document the design step claimed.
  plan: { from: ["design"], kind: "document", take: "latest" },
  // Every verdict about the current subject.
  evidence: { kind: "verdict", about: "subject" },
  // Your latest decision about it, with your feedback.
  feedback: { kind: "decision", about: "subject", take: "latest" },
},
```

### Budgets and limits

- **Budget.** Each step may start `budget` attempts. Once they are spent the commission pauses
  for you. Only your decision renews a budget, so every loop ends.
- **Limits.** Every step has seven: `idle` and `attempt` in seconds, `transcript`, `input`,
  `memory` and `disk` in bytes, and `processes`. The factory's `defaults.limits` sets them all;
  a step's `limits` changes some. `@medrengard/core/defaults/limits.ts` has a set to start from.
- **Money.** A step may state `limits.usd`, and a workflow `usd`: the most an attempt, or the
  commission between your decisions, may cost, as the agent's harness reports it.

### Children

A children step fans work out and waits for it:

```ts
fanOut: {
  kind: "children",
  workflow: "implement",
  // One child per document the plan step claimed.
  each: { from: ["plan"], kind: "document" },
  width: 8,
  concurrent: 3,
  until: "all",
  on: { done: "gather" },
  budget: 1,
  limits: { wait: 6 * 3600 },
},
```

`until` is `"all"`, `"first"` or `{ atLeast: N }`. It can also count an outcome,
`{ atLeast: 2, outcome: "pass" }`, in which case the step ends on `met` or `unmet`.

## When a step fails

A step fails when its program exits non-zero, breaks a limit, or claims something invalid. The
commission then escalates: it pauses for you, with a reason in words and one of sixteen causes.

| Cause                                 | What happened                                               |
| ------------------------------------- | ----------------------------------------------------------- |
| `exit`                                | The program failed, or could not start.                     |
| `claim`                               | Its output was invalid, or its kind's verifier rejected it. |
| `limit`                               | A limit other than money was reached.                       |
| `interrupted`                         | The engine running it stopped.                              |
| `kind`, `broker`                      | A kind's program failed, or a broker did not start.         |
| `unmet`                               | A children step's wait can no longer be met.                |
| `budget`, `money`, `repeat`, `inputs` | It could not start another attempt.                         |
| `cancelled`, `withdrawn`              | You cancelled it, or its parent stopped waiting for it.     |
| `engine`, `upgrade`, `trigger`        | The engine failed, changed, or a trigger was past its caps. |

You answer an escalation with `retry` or `abandon`:

```sh
medrengard state first
# escalated at write since event 2, about 9cb2b2bf…
# cause: exit
# reason: Step write exited with code 1.

medrengard errors first 1       # what the attempt wrote to stderr
medrengard decide first retry --subject 9cb2b2bf… --since 2
```

A step can also send some failures to another step instead of to you:

```ts
implement: {
  kind: "agent",
  // An attempt whose engine stopped is tried again; a failed one goes to a diagnose step.
  escalate: { interrupted: "implement", exit: "diagnose", limit: "diagnose" },
  budget: 3,
  // ...
},
```

Only `limit`, `claim`, `exit`, `kind`, `broker`, `interrupted` and `unmet` can be routed, or `any`
for all of them. The rest always come to you. Each routed failure has already spent one of the
step's attempts, so a route cannot loop for ever.

## Access

Every command and agent step runs in a sandbox. Its `access` says what it can see. A path you do
not list is invisible.

```ts
import { contract } from "@medrengard/core/defaults/access.ts";
import type { Access } from "@medrengard/core/src/definition.ts";

// A step that may also read one repository and reach the npm registry.
const access = {
  ...contract,
  paths: [...contract.paths, { path: "/home/me/dev/app", mode: "read" }],
  network: { hosts: ["registry.npmjs.org"] },
} satisfies Access;
```

Start from one of the four defaults in `@medrengard/core/defaults/access.ts`:

| Default      | For                                                                                |
| ------------ | ---------------------------------------------------------------------------------- |
| `contract`   | Any program: the system's programs and a fresh `/tmp`. No network, no home.        |
| `node`       | A step written in TypeScript: `contract` plus Node and the step contract's module. |
| `claudeCode` | The Claude Code adapter.                                                           |
| `codex`      | The Codex adapter.                                                                 |

Credentials never enter a sandbox. A broker, a program the engine runs outside it, holds the token
and adds it to what the step sends. See [access](../docs/access.md).

## Running a factory

```text
medrengard <command> [--json] [--factory <path>]
```

| To                            | Command                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| Check your workflows          | `check [<workflow>]`                                         |
| Start a commission            | `commission <workflow> <name> --title <title> --body <text>` |
| Run one until it needs you    | `advance <name>`                                             |
| Run everything that is ready  | `run [--parallel <n>]`                                       |
| Take part in an attended step | `attend <name>`                                              |
| See where things are          | `commissions`, `state <name>`, `show <name>`, `watch <name>` |
| Read what an attempt wrote    | `transcript <name> <attempt>`, `errors <name> <attempt>`     |
| Read an artifact              | `artifact <hash>`                                            |
| Decide                        | `decide <name> <outcome> --subject <hash> --since <event>`   |
| Stop a running attempt        | `cancel <name>`                                              |
| Follow every event            | `events [--after <position>] [--follow]`                     |

With `--json`, each command prints one JSON value. Exit codes are 0 for success (an escalation
included), 1 when the engine refuses, and 2 for a usage error.

Leave `medrengard run` going to work through commissions unattended. A terminal UI shows what
needs you, what is running and what is waiting:

```sh
node node_modules/@medrengard/core/tui/medrengard-tui.ts
```

See [the CLI and the TUI](../docs/cli.md) for every command.

## Writing a step's program

A step's program can be in any language. It is started in its workspace with two directories:

- `MEDRENGARD_IN` holds `input.json` and the bodies of the step's inputs.
- `MEDRENGARD_OUT` is where it writes `output.json`: one outcome and the artifacts it claims.

```json
{
  "outcome": "done",
  "artifacts": [{ "kind": "document", "fields": { "title": "Plan" }, "body": "plan.md" }]
}
```

It exits 0 when it did its work, whatever the outcome: a test run that finds failures exits 0 and
claims a failing verdict. A non-zero exit means the step itself broke.

For a program in TypeScript, `@medrengard/core/step/contract.ts` reads and writes those files:

| Function                              | Does                                           |
| ------------------------------------- | ---------------------------------------------- |
| `readInput()`                         | Returns `input.json`.                          |
| `artifactsOf(given, name)`            | An input's artifacts, oldest first.            |
| `bodyOf(artifact)`                    | An artifact's body as text.                    |
| `claim(outcome, artifacts)`           | Writes `output.json`.                          |
| `note(text)`                          | Writes a note for you, shown as the step runs. |
| `reportUsage({ usd, tokens })`        | Reports what the step has spent.               |
| `failed(why)`                         | Says why on stderr and exits 1.                |
| `readClaim()`, `accept()`, `reject()` | For a kind's verifier.                         |
| `readArtifact()`, `readBranches()`    | For a kind's materialiser.                     |

See [the step contract](../docs/step-contract.md) for every file and field.

## Using the engine from TypeScript

The CLI is a thin layer over the engine, and so is any other client.

```ts
import { createEngine } from "@medrengard/core/src/engine.ts";
import factory from "./factory.ts";

const engine = createEngine({ ...factory, log: "/var/lib/my-factory/log.sqlite" });

engine.commission("greet", { title: "Greet", body: "Say hello." }, { name: "first" });

let state = await engine.advance("first");

if (state.status === "awaiting" || state.status === "escalated") {
  console.log(engine.artifact(state.subject));
  console.log(state.outcomes); // What you may decide, such as ["accept", "changes", "abandon"].

  state = engine.decide("first", {
    subject: state.subject,
    since: state.since,
    outcome: "accept",
    feedback: "Looks right.",
  });
}

console.log(engine.record("first").entries);
```

| Method                                                 | Does                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `check(workflow)`                                      | Returns the definition a commission would run on, or throws.   |
| `commission(workflow, request, { name, trigger? })`    | Starts a commission and returns its name.                      |
| `advance(name, { signal? })`                           | Runs ready steps until it needs you, escalates or finishes.    |
| `attend(name)`                                         | Runs the attended step it is ready at, in this terminal.       |
| `decide(name, { subject, since, outcome, feedback? })` | Records your decision and returns the new state.               |
| `cancel(name)`                                         | Stops its running attempt, which then escalates.               |
| `state(name)`, `commissions()`                         | Where one commission is, or all of them.                       |
| `record(name)`                                         | Its request and every attempt, escalation and decision.        |
| `definition(name)`                                     | The definition it was started with and runs on.                |
| `artifact(hash)`                                       | An artifact's kind, fields and body.                           |
| `transcript(name, attempt)`, `errors(name, attempt)`   | What an attempt wrote, as a `Buffer`.                          |
| `events(position)`, `next(position, { signal? })`      | Every event after a log position; `next` waits for more.       |
| `renew(trigger)`                                       | Renews a trigger's allowance.                                  |
| `register()`, `engines()`                              | Marks this engine as running on the log; lists those that are. |

A state has a `status`: `ready`, `attempting`, `awaiting`, `escalated` or `finished`. See
[the engine](../docs/engine.md) for what each method returns.

## Reference

| Document                                      | Covers                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| [Workflows](../docs/workflows.md)             | Steps, inputs, children, triggers, long-lived agents, preparation. |
| [Access](../docs/access.md)                   | Paths, the network, hosts and brokers.                             |
| [Artifact kinds](../docs/kinds.md)            | Defining a kind, its verifier and its materialiser.                |
| [Agents](../docs/agents.md)                   | Agents, the Claude Code and Codex adapters, attended steps.        |
| [Landing on GitHub](../docs/github.md)        | Steps that open, watch, land and rebase a pull request.            |
| [The step contract](../docs/step-contract.md) | `input.json`, `output.json`, notes, usage and sessions.            |
| [The engine](../docs/engine.md)               | Every method and what it returns.                                  |
| [The CLI and the TUI](../docs/cli.md)         | Every command and its output.                                      |
| [Principles](../docs/core.md)                 | What Medrengard guarantees, and its exact vocabulary.              |

## Development

`npm test` in this directory runs the type check and the tests. At the repository's root it also
runs the linter and the format check for every package. Tests write only under the system temp
directory.

## Licence

MIT: see [`LICENSE`](../LICENSE). [`tools/oxlint/anti-slop/`](../tools/oxlint/anti-slop/) is
vendored from [anti-slop](https://github.com/dmmulroy/anti-slop) under its own MIT licence.
