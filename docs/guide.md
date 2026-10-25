# Guide

This guide explains how Medrengard fits together. It is for a developer joining
the project or anyone curious enough to try it. It explains; it does not set
rules. Install and run commands are in the [README](../README.md). The rules
the core must keep are in [core.md](core.md), which wins wherever this guide
disagrees. Who can read, write or reach the network is in the
[threat model](security/threat-model.md).

## Words

- A **work** is one piece of work, such as an idea on its way to a PR, with an
  id like `3f9c2a1b`.
- A **workflow** is a graph of **stages** that a work moves through. Each stage
  ends with an **outcome** (`done`, `PASS`, `accept`), and the outcome picks
  the next stage.
- An **agent** stage runs an **agent**: role text, skills, MCP servers and a
  **sandbox**, run by a **runtime** such as headless Claude Code. A **command**
  stage runs a check command or an extension function. A **human** stage waits
  for the owner to **decide**.
- Each automatic stage produces an **artifact**: a **document** (a plan), a
  **commit** or a **verdict** (`PASS` or `FAIL` with findings). Whatever an
  agent returns is a **claim** until the controller has checked it.
- The **subject** is what the work is currently about: the latest document's
  hash or the latest commit's SHA. Verdicts and decisions must name it.
- The **event log** is an SQLite table, and the record of everything. The
  current state of a work is rebuilt from it on every read. An **observer** is
  a callback that sees each event as it is written and cannot change anything.

## The shape

| Path | Owns |
| --- | --- |
| [`src/index.ts`](../src/index.ts) | The public entry point. Code outside `src/` imports only this ([`tests/boundary.test.ts`](../tests/boundary.test.ts)). |
| [`src/primitives.ts`](../src/primitives.ts) | The types, [`checkWorkflow`](../src/index.ts) and the [`Controller`](../src/index.ts): the event log, replay, budgets, claim checks, the work's clone, retained commits and read-only snapshots. |
| [`src/sandbox.ts`](../src/sandbox.ts) | Bubblewrap: mounts, environment, network, output caps and killing. It is not exported; stages reach it through `StageContext.execute`. |
| [`src/command-runtime.ts`](../src/command-runtime.ts) | [`commandRuntime`](../src/index.ts), a runtime for any local process that speaks JSON on stdin and stdout. |
| [`extensions/claude-code`](../extensions/claude-code/index.ts) | `claudeCodeRuntime`, which runs `claude -p` and returns its final message as a document. |
| [`workflows/default.ts`](../workflows/default.ts) | `defaultWorkflows`, the shipped idea-to-PR policy, and `examplePlanner`, which builds a planner agent from [`workflows/example/`](../workflows/example/planner.md). |
| [`cli/medrengard.ts`](../cli/medrengard.ts) | `start`, `show` and `decide` against the `factory.ts` in the current directory. |
| [`tests/`](../tests/e2e/mvp.test.ts) | The proof. `tests/e2e/` drives the controller through the entry point with stub agents; the rest cover the sandbox, the runtimes, the CLI and these docs. |

Your factory, the directory holding `factory.ts`, sits outside this checkout
and imports the core the same way any other caller does.

## One run

From the owner's command to the event log:

```mermaid
flowchart LR
  O([Owner]) -- "1. start or decide" --> CLI[cli/medrengard.ts]
  CLI -- "2. loads" --> F[factory.ts]
  CLI -- "3. advance" --> C[Controller]
  C -- "4. runs a stage" --> R[Runtime]
  R -- "5. executes" --> B[bwrap]
  R -- "6. claim" --> C
  C -- "7. records" --> L[(Event log)]
```

The CLI builds a `Controller` from the factory's options. For each automatic
stage the controller repeats steps 4 to 7: it records `started`, hands the
runtime a context whose `execute` runs commands in bubblewrap, checks the
claim the runtime returns, and records `completed` or `escalated`. It stops at
a human stage, `DONE` or `ESCALATED`, and the owner's `decide` starts it again.

Command stages have no runtime: the controller calls `context.execute` with
the stage's argv and turns exit code 0 into `PASS` and anything else into
`FAIL`. A stage with `extension` calls the owner's function with the same
`context`. A command stage needs a commit as its subject, otherwise it escalates;
an extension stage does not.

`Controller.advance` loops until the work reaches a human stage, `DONE` or
`ESCALATED`. Before each run it escalates instead when the stage's budget is
spent, or when the stage already failed on this subject and the owner has not
decided since. If anything goes wrong during a run (a thrown error, an unknown
outcome, a claim that fails its check, the stage deadline), the work escalates
with the reason. Nothing is retried.

### What a stage sees

`StageContext.execute` runs a command in bubblewrap, with its working directory
chosen by the stage:

| Stage | Directory | Writable |
| --- | --- | --- |
| Produces a commit (develop, fix) | The work's clone of the owner repository, made the first time a stage needs it | Yes |
| Any other stage while a commit is the subject (check, review, PR) | A fresh snapshot of that commit's files, without `.git` | No |
| `workspace: 'repository'` before any commit (design) | The work's clone | No |
| Anything else | The work's directory: empty unless an earlier stage cloned into it | No |

Agent stages run under their agent's `sandbox`; command and extension stages
run under a bare one. The [threat model](security/threat-model.md#trust-boundaries)
says what each can read and reach.

### Checking a claim

Every result must be JSON under 1 MiB with an `outcome` that names one of the
stage's edges and an `artifact` of the kind the stage `produces`, if it declares one. A document
must have content. A commit's SHA must be the clone's `HEAD` and differ from
the current subject; its objects are then copied into a separate repository,
so the candidate cannot rewrite them later. A verdict must name the current
subject, and its `PASS` or `FAIL` must equal the outcome. Each stored artifact
is hashed.

### Subject, evidence and decisions

A commit becomes the subject. So does a document, unless it names a `subject`
itself, as a PR link does. A verdict is evidence about the current subject.
`State.evidence` lists only the artifacts about the current subject, so a new
commit drops the old reviews.

`decide` checks that the work is at a human stage and that the hash or SHA you
pass is the current subject; otherwise it refuses with `stale owner decision`.
An outcome with no edge is refused too. Feedback given with the decision
reaches the next agent runs as `AgentRequest.feedback`, until the next decision.

### Budgets and handoffs

Each `started` event spends one attempt at that stage. When a stage's spent
count reaches its `budget`, the work escalates. An edge can be a list, such as
`FAIL: ['fix', 'ESCALATED']`, which picks the first entry on the first attempt
and the second on the second. An edge to `{ workflow: 'develop' }` hands the work
to another workflow and resets its spending. The constructor refuses a cycle
of handoffs from automatic stages, so only an owner decision can lead back to a
fresh budget.

### Replay and recovery

`state` replays the work's events each time it is called, and there is no
other copy of the state. If the controller dies mid-run, `recover` escalates
the pending run instead of starting it again; see
[core.md](core.md#invariants).
