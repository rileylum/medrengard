# Medrengard

A framework for building a personal software factory: workflows that take an idea to merged code.

Medrengard is being rewritten from first principles. [`docs/core.md`](docs/core.md) holds what it is
and the rules it keeps; this file shows how to use what exists so far. The engine, the sandbox, the
CLI and a Claude Code adapter run. Observers, attended steps and kinds as definitions do not exist
yet.

## Contents

- [Requirements](#requirements)
- [A first factory](#a-first-factory)
- [Workflows](#workflows)
- [Inputs](#inputs)
- [Access](#access)
- [Agents and the Claude Code adapter](#agents-and-the-claude-code-adapter)
- [The step contract](#the-step-contract)
- [The engine in TypeScript](#the-engine-in-typescript)
- [The CLI](#the-cli)
- [Development](#development)

## Requirements

- Linux, with [bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`) on `PATH`: every agent
  and command step runs inside it.
- Node 24. It runs the TypeScript files directly; nothing is built.
- Git, for commits.

There is no package yet. The examples import from `medrengard/…`: replace that with the path to your
checkout of this repository.

## A first factory

A factory is a TypeScript module whose default export is the engine's options: where the log lives,
and the workflows by name. This one replies to the request, checks the reply and asks the owner.

```ts
// factory.ts
import { defineWorkflow } from "medrengard/src/replay.ts";
import { contract } from "medrengard/defaults/access.ts";

const limits = { idle: 60, attempt: 600, transcript: 1024 * 1024, input: 1024 * 1024 };

export default {
  // Relative to this file.
  log: "state/log.sqlite",
  workflows: {
    greet: defineWorkflow({
      start: "write",
      steps: {
        // Reads the request and claims a document, which becomes the subject.
        write: {
          kind: "command",
          workspace: "empty",
          inputs: { request: "request" },
          run: [
            "sh",
            "-c",
            `body=$(ls "$MEDRENGARD_IN"/request/*)
             { printf 'Reply to: '; cat "$body"; } > "$MEDRENGARD_OUT/reply.md"
             echo '{"outcome":"done","artifacts":[{"kind":"document","fields":{"title":"Reply"},"body":"reply.md"}]}' \\
               > "$MEDRENGARD_OUT/output.json"`,
          ],
          on: { done: "check" },
          budget: 2,
          access: contract,
          limits,
        },
        // Judges the reply in its workspace and claims a verdict. The subject stays the reply.
        check: {
          kind: "command",
          workspace: "subject",
          inputs: {},
          run: [
            "sh",
            "-c",
            `if grep -q hello document; then v=pass; else v=fail; fi
             echo "{\\"outcome\\":\\"$v\\",\\"artifacts\\":[{\\"kind\\":\\"verdict\\",\\"fields\\":{\\"verdict\\":\\"$v\\"}}]}" \\
               > "$MEDRENGARD_OUT/output.json"`,
          ],
          on: { pass: "approve", fail: "write" },
          budget: 2,
          access: contract,
          limits,
        },
        approve: { kind: "approval", on: { accept: "end", changes: "write" } },
      },
    }),
  },
};
```

Run it with the CLI:

```sh
export MEDRENGARD_FACTORY=$PWD/factory.ts
alias medrengard="node medrengard/cli/medrengard.ts"

medrengard commission greet first --title Greet --body "Say hello."
medrengard advance first
# awaiting at approve, about 51da8742…
medrengard artifact 51da8742…
# document
# title: Reply
#
# Reply to: Say hello.
medrengard decide first accept --subject 51da8742…
# finished by end
```

`advance` runs ready steps until the commission awaits the owner, escalates or finishes. `decide`
must name the current subject, so a decision can never approve something the owner has not seen.

## Workflows

A workflow is a start step and its steps by name. `defineWorkflow` returns the workflow unchanged; it
exists so the compiler checks every step name an edge or query uses. Each step's `on` maps an
outcome to the next step or to `end`.

There are three kinds of step:

| Kind       | Runs                                 | Fields besides `kind` and `on`                               |
| ---------- | ------------------------------------ | ------------------------------------------------------------ |
| `command`  | the owner's program, `run`           | `run`, `workspace`, `inputs`, `budget`, `access`, `limits`   |
| `agent`    | an agent through its harness adapter | `agent`, `workspace`, `inputs`, `budget`, `access`, `limits` |
| `approval` | nothing: it waits for the owner      | none                                                         |

The fields of a command or agent step:

- `workspace`: `"empty"`, or `"subject"` to build the working directory from the current subject. A
  commit is checked out with its history; a document is written to the file `document`.
- `inputs`: what the step is given, by name. See [Inputs](#inputs).
- `budget`: the attempts the step may start between the owner's decisions, above zero. It bounds
  every loop: a step that has spent its budget escalates.
- `access`: what the step's process may read, write and reach. See [Access](#access).
- `limits`, each over zero:
  - `idle`: seconds without output before the step is stopped;
  - `attempt`: seconds in all;
  - `transcript`: bytes of stdout and stderr;
  - `input`: bytes of all input bodies together. Over it, the step never starts.

The engine refuses a workflow it could not run as written when it is commissioned, not halfway
through. A commission runs on the definition it started with: editing the factory affects only new
commissions.

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
    // The latest artifact the design step claimed: the plan, after the subject became a commit.
    plan: { from: ["design"], take: "latest" },
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

An input name is also a directory in the step's input, so it may hold only letters, digits, `-` and
`_`, starting with a letter.

## Access

Every command and agent step runs in bubblewrap under its `access`:

```ts
import type { Access } from "medrengard/src/replay.ts";

const access: Access = {
  // In order of depth; on the same path, read wins. A path not listed is invisible.
  paths: [
    { path: "/usr", mode: "read" },
    { path: "/home/owner/dev/app", mode: "read" },
    // A fresh directory of at most 256 MiB over whatever is there.
    { path: "/tmp", mode: "empty", size: 256 * 1024 * 1024 },
  ],
  network: false,
  // Variable names passed through from the engine's environment, or "all".
  environment: ["LANG"],
  // A reviewer can get "read".
  workspace: "write",
};
```

The workspace, the input (read-only) and the output are always there, and `PATH`, `MEDRENGARD_IN`
and `MEDRENGARD_OUT` are always set.

`medrengard/defaults/access.ts` holds four values to use as they are or to change one dial of:

- `full`: everything the engine can reach; in practice no sandbox.
- `home`: the system, and the owner's home to read and write, with the network and environment.
- `contract`: only the step contract and the system's programs.
- `claudeCode`: what the Claude Code adapter needs. Its home is empty, so the owner's settings,
  skills, hooks and MCP servers never load.

```ts
import { contract } from "medrengard/defaults/access.ts";

// A step that clones the owner's repository into its empty workspace.
const cloning = {
  ...contract,
  paths: [...contract.paths, { path: "/home/owner/dev/app", mode: "read" as const }],
};
```

## Agents and the Claude Code adapter

An agent is a harness adapter to run, a model and a prompt. The adapter is a program like any
command; `adapters/claude-code.ts` runs the agent through `claude -p`:

```ts
import { claudeCode } from "medrengard/defaults/access.ts";

const design = {
  kind: "agent",
  agent: {
    harness: {
      run: ["node", "medrengard/adapters/claude-code.ts", "--permission-mode", "bypassPermissions"],
    },
    model: "sonnet",
    prompt: "Read the request and write a plan for it.",
  },
  workspace: "empty",
  inputs: { request: "request" },
  on: { done: "approve" },
  budget: 1,
  access: claudeCode,
  limits: { idle: 300, attempt: 3600, transcript: 16 * 1024 * 1024, input: 1024 * 1024 },
} as const;
```

- `--permission-mode acceptEdits`, the default, lets the agent edit files but not run commands.
  `bypassPermissions` lets it do anything its access allows, so the sandbox is its only boundary.
- The adapter tells the agent where its inputs are and how to claim a document, a commit or a
  verdict.
- `claudeCode` passes `CLAUDE_CODE_OAUTH_TOKEN` and the `GIT_AUTHOR_*` and `GIT_COMMITTER_*`
  variables from the engine's environment. Set them before you run the engine.

## The step contract

Every command and agent step is a program, started:

- in its workspace;
- with `MEDRENGARD_IN`: a read-only directory holding `input.json` and its inputs' bodies;
- with `MEDRENGARD_OUT`: an empty directory for `output.json` and the bodies it claims;
- with only the environment its access names.

`input.json` lists each input's artifacts, oldest first, always as a list. A body is a file at
`<input>/<hash>`, and `body` holds that path:

```json
{
  "commission": "first",
  "step": "review",
  "attempt": 3,
  "outcomes": ["pass", "fail"],
  "inputs": {
    "plan": [
      { "hash": "9f2c…", "kind": "document", "fields": { "title": "Plan" }, "body": "plan/9f2c…" }
    ],
    "evidence": [
      { "hash": "41ab…", "kind": "verdict", "fields": { "verdict": "pass", "subject": "77d0…" } }
    ]
  },
  "agent": { "model": "sonnet", "prompt": "Review the change against the plan." }
}
```

`agent` is there only for an agent step. The step writes one outcome and any artifacts to
`output.json`, with each body as a path relative to `MEDRENGARD_OUT`:

```json
{
  "outcome": "done",
  "artifacts": [{ "kind": "document", "fields": { "title": "Plan" }, "body": "plan.md" }]
}
```

```json
{
  "outcome": "done",
  "artifacts": [{ "kind": "commit", "fields": { "sha": "<the full SHA of HEAD>" } }]
}
```

```json
{
  "outcome": "fail",
  "artifacts": [
    {
      "kind": "verdict",
      "fields": { "verdict": "fail", "summary": "Two tests fail." },
      "body": "findings.md"
    }
  ]
}
```

The kinds a step can claim:

| Kind       | Role      | Fields                                   | Body                     | Checked by the engine                                     |
| ---------- | --------- | ---------------------------------------- | ------------------------ | --------------------------------------------------------- |
| `document` | subject   | `title`, at most 200 bytes               | required, UTF-8, 1 MiB   | nothing more                                              |
| `commit`   | subject   | `sha`                                    | none                     | the SHA is the workspace HEAD and not already the subject |
| `verdict`  | judgement | `verdict` (`pass` or `fail`), `summary`? | optional findings, 1 MiB | `verdict` equals the outcome                              |

The latest subject claimed becomes the subject. A verdict leaves the subject alone, and the engine
records it as about the subject the attempt was given. Only the owner makes a decision: a step that
claims one escalates.

How the attempt ends:

- exit 0 with a valid `output.json`: the artifacts are recorded and the outcome's edge is followed;
- exit 0 with a missing or invalid `output.json`, or a claim the engine rejects: the commission
  escalates;
- a non-zero exit: the commission escalates. A test run that finds failures should exit 0 and claim
  a failing verdict;
- a limit reached, or the owner cancelling: the engine sends `SIGTERM`, then `SIGKILL` after 5
  seconds, and the commission escalates.

## The engine in TypeScript

The CLI is a thin layer over `createEngine`, and so is any other client:

```ts
import { createEngine } from "medrengard/src/engine.ts";
import factory from "./factory.ts";

const engine = createEngine({ log: "/var/tmp/factory/log.sqlite", workflows: factory.workflows });

// Starts a commission: the request is its first subject.
engine.commission("greet", "first", { title: "Greet", body: "Say hello." });

// Runs ready steps until the commission awaits the owner, escalates or finishes.
let state = await engine.advance("first");

if (state.status === "awaiting" || state.status === "escalated") {
  // The artifact the commission is about, by hash.
  console.log(engine.artifact(state.subject));

  // At an approval step, an outcome it declares; on an escalation, retry or abandon.
  state = engine.decide("first", {
    subject: state.subject,
    outcome: "accept",
    feedback: "Shorter.",
  });
}

// What attempt 1 wrote to stdout and stderr.
console.log(engine.transcript("first", 1).toString());

// Every commission in the log, oldest first, with its state.
console.log(engine.commissions());
```

| Method                                                | Returns                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `commission(workflow, commission, { title, body })`   | nothing; refuses an unknown workflow or an invalid one         |
| `advance(commission)`                                 | the state it stopped at                                        |
| `state(commission)`                                   | the state, replayed from the log                               |
| `commissions()`                                       | `{ commission, state }[]`, oldest first                        |
| `decide(commission, { subject, outcome, feedback? })` | the new state; refuses a stale subject or undeclared outcome   |
| `cancel(commission)`                                  | nothing; the engine running the attempt stops it and escalates |
| `transcript(commission, attempt)`                     | the attempt's stdout and stderr as a `Buffer`                  |
| `artifact(hash)`                                      | `{ kind, fields, body? }`                                      |

A state has a `status`:

- `ready` or `attempting`, at an agent or command `step`, about a `subject`;
- `awaiting`, at an approval `step`, about a `subject`;
- `escalated`, at a `step`, about a `subject`, with a `reason`;
- `finished`, `by` `"end"` or `"abandoned"`.

Every state but `finished` also carries `decision`: the hash of the owner's latest decision about
the subject, if there is one.

## The CLI

```text
medrengard <command> [--json] [--factory <path>]

  commission <workflow> <commission> --title <title> (--body <text> | --body-file <path>)
  advance    <commission>
  state      <commission>
  commissions
  run        [--parallel <n>]
  decide     <commission> <outcome> --subject <hash> [--feedback <text> | --feedback-file <path>]
  cancel     <commission>
  transcript <commission> <attempt>
  artifact   <hash>
```

- The factory is `--factory <path>`, or else `MEDRENGARD_FACTORY`. The CLI never guesses one,
  because loading a factory runs its code.
- With `--json`, stdout holds exactly one JSON value: the method's return, or `null` for
  `commission` and `cancel`. An error goes to stderr as `{"error": "…"}`. Without `--json`, the
  output is for people, not for parsing.
- Exit codes: 0 when the call succeeded, an escalation included; 1 when the engine refused or
  failed; 2 for a usage error.
- `run` advances every ready commission, at most `--parallel` steps at once (1 by default), oldest
  commission first. It prints one line per result. A first Ctrl-C starts nothing new and waits for
  the running steps; a second exits at once, and each interrupted attempt escalates when next
  advanced.

## Development

`npm test` runs the type check, the linter, the format check and the tests. Tests write only under
the system temp directory.
