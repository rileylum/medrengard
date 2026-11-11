# The step contract

What a step's program is started with, what it reads and writes, and the module that does both for a program written in TypeScript.

Every command and agent step is a program. An agent step's program is its harness adapter. The
contract is files and file descriptors, so a program in any language can meet it. A program in
TypeScript has the module `@medrengard/core/step/contract.ts` over them.

## What a step is started with

| What              | A step's program has                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Working directory | Its workspace, at `/workspace`.                                                                     |
| `MEDRENGARD_IN`   | `/input`: a read-only directory with `input.json`, its inputs' bodies and an agent's skills.        |
| `MEDRENGARD_OUT`  | `/output`: an empty directory for `output.json`, the bodies it claims and `session`.                |
| Environment       | Only what its [access](access.md) names, the two above and `PWD`. An attended step also has `TERM`. |
| stdin             | Empty. An attended step has the owner's terminal.                                                   |
| stdout and stderr | Its transcript. Its stderr alone is also kept, as the attempt's errors.                             |
| File descriptor 3 | For [notes](#notes).                                                                                |
| File descriptor 4 | For [usage reports](#usage-reports).                                                                |

A step whose access lists hosts or brokers also has the proxy variables and
`MEDRENGARD_BROKER_<NAME>`. See [access](access.md).

## In TypeScript

```ts
// steps/reply.ts, in your factory's repository
import {
  artifactsOf,
  bodyOf,
  claim,
  failed,
  note,
  readInput,
} from "@medrengard/core/step/contract.ts";

const given = readInput();
const [request] = artifactsOf(given, "request");

if (request === undefined) {
  failed("The step was given no request.");
}

note(`Replying to ${request.fields.title}`);

claim("done", [
  { kind: "document", fields: { title: "Reply" }, text: `Reply to: ${bodyOf(request)}` },
]);
```

Run it with the Node that runs the engine, under the default access `node`. Add your program's
directory, and the `node_modules` it finds the module through:

```ts
import { node } from "@medrengard/core/defaults/access.ts";
import { defineWorkflow } from "@medrengard/core/src/definition.ts";

export const replying = defineWorkflow({
  start: "reply",
  steps: {
    reply: {
      kind: "command",
      run: [process.execPath, "/path/to/factory/steps/reply.ts"],
      inputs: { request: "request" },
      claims: ["document"],
      workspace: "empty",
      on: { done: "end" },
      budget: 1,
      access: {
        ...node,
        paths: [
          ...node.paths,
          { path: "/path/to/factory/steps", mode: "read" },
          { path: "/path/to/factory/node_modules", mode: "read" },
        ],
      },
    },
  },
});
```

The module's functions:

| Function                                                       | Does                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `readInput(): Input`                                           | Reads `input.json`.                                                                                        |
| `artifactsOf(given: Input, name: string): Artifact[]`          | The artifacts the input `name` holds, oldest first. None for an input the step lacks. Leaves out sessions. |
| `bodyOf(listed: { body?: string }): string \| undefined`       | An artifact's or session's body as text. `undefined` when it has none.                                     |
| `claim(outcome: string, artifacts?: readonly Claimed[]): void` | Writes `output.json`: one outcome and the artifacts claimed, in order.                                     |
| `note(text: string): void`                                     | Writes one note to descriptor 3, on one line. An empty one writes nothing.                                 |
| `reportUsage(usage: Usage): void`                              | Writes a usage report to descriptor 4.                                                                     |
| `failed(why: string): never`                                   | Writes `why` to stderr and exits 1, so the commission escalates.                                           |
| `readClaim(): Claim`                                           | For a verifier: reads `claim.json`.                                                                        |
| `accept(keep?: readonly string[]): void`                       | For a verifier: accepts the claim, naming the files in its output to keep.                                 |
| `reject(reason: string): void`                                 | For a verifier: rejects the claim, so the commission escalates with `reason`.                              |
| `readArtifact(): Materialised`                                 | For a materialiser: reads `artifact.json`.                                                                 |
| `readBranches(): (Materialised & { branch: string })[]`        | For a materialiser: reads `branches.json`. None when the step adds no branches.                            |

Its other exports:

| Export         | Is                                                                             |
| -------------- | ------------------------------------------------------------------------------ |
| `input`        | The path `MEDRENGARD_IN` names.                                                |
| `output`       | The path `MEDRENGARD_OUT` names.                                               |
| `Input`        | `input.json`.                                                                  |
| `Artifact`     | An artifact as `input.json` lists it.                                          |
| `Session`      | A session as `input.json` lists it: `{ hash, body }`.                          |
| `Rules`        | A kind's rules, as `claims` in `input.json` gives them.                        |
| `Claimed`      | An artifact to claim: `{ kind, fields?, body?, text? }`, or `{ adopt: hash }`. |
| `Usage`        | A usage report: `{ usd?, tokens? }`.                                           |
| `Claim`        | A verifier's `claim.json`.                                                     |
| `Materialised` | A materialiser's `artifact.json`: an `Artifact` with its `kept` files.         |

- In a `Claimed`, `body` is the path of a file you wrote in the output. `text` is the body itself:
  the module writes it there, as `body-<n>`, `n` being the artifact's position from 1.
- The module imports nothing of the engine's. A step's access needs only the package's `step`
  directory to run it.
- A kind's verifier and materialiser use the same module. [Kinds](kinds.md) covers their files.

## With plain files

The same step as a shell script, with `jq`:

```sh
#!/bin/sh
title=$(jq -r '.inputs.request[0].fields.title' "$MEDRENGARD_IN/input.json")
body=$(jq -r '.inputs.request[0].body' "$MEDRENGARD_IN/input.json")

echo "Replying to $title" >&3

{ printf 'Reply to: '; cat "$MEDRENGARD_IN/$body"; } > "$MEDRENGARD_OUT/reply.md"

cat > "$MEDRENGARD_OUT/output.json" <<'EOF'
{
  "outcome": "done",
  "artifacts": [{ "kind": "document", "fields": { "title": "Reply" }, "body": "reply.md" }]
}
EOF
```

## input.json

```json
{
  "commission": "first",
  "step": "review",
  "attempt": 3,
  "outcomes": ["pass", "fail"],
  "routed": {
    "step": "implement",
    "attempt": 2,
    "cause": "limit",
    "reason": "Step implement reached its attempt limit of 3600 s."
  },
  "inputs": {
    "plan": [
      { "hash": "9f2c…", "kind": "document", "fields": { "title": "Plan" }, "body": "plan/9f2c…" }
    ],
    "evidence": [
      { "hash": "41ab…", "kind": "verdict", "fields": { "verdict": "pass", "subject": "77d0…" } }
    ],
    "earlier": [{ "hash": "c03e…", "body": "earlier/c03e…" }]
  },
  "claims": {
    "verdict": {
      "description": "Your verdict on what the workflow is about. …",
      "fields": {
        "verdict": { "limit": 4, "required": true, "values": ["pass", "fail"] },
        "summary": { "limit": 200 }
      },
      "body": { "required": false, "limit": 1048576 },
      "outcome": "verdict"
    }
  },
  "attended": false,
  "agent": {
    "model": "sonnet",
    "prompt": "Review the change against the plan.",
    "skills": [{ "name": "tdd", "path": ".skills/tdd" }]
  }
}
```

| Field        | There                                     | Meaning                                                                                       |
| ------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `commission` | always                                    | The commission's name.                                                                        |
| `step`       | always                                    | The step's name.                                                                              |
| `attempt`    | always                                    | The attempt's number.                                                                         |
| `outcomes`   | always                                    | The outcomes the step declares.                                                               |
| `routed`     | when an escalation was routed to the step | The step the commission left, its attempt, and the escalation's `cause` and `reason`.         |
| `inputs`     | always                                    | Each declared input's artifacts, by the input's name.                                         |
| `claims`     | always                                    | The rules of each kind the step may claim: `description`, `fields`, `body` and any `outcome`. |
| `attended`   | an agent step only                        | Whether the owner is in the agent's terminal.                                                 |
| `agent`      | an agent step only                        | The agent's `model`, `prompt` and `skills`.                                                   |

An input:

- is always a list, oldest first, even when it holds one artifact or none;
- lists an artifact as `hash`, `kind` and `fields`;
- adds `body` when the artifact has one: the path of its file, `<input>/<hash>`, relative to
  `MEDRENGARD_IN`;
- adds `kept` when the step's `kept` names the input and a verifier kept files for the artifact:
  the path of each, by its name, `<input>/<hash>.kept/<name>`, relative to `MEDRENGARD_IN`;
- adds `commission` for an artifact of a child or a related commission: the commission it came
  from;
- adds `branch` for an artifact the workspace added as a branch;
- lists a session by `hash` and `body` alone. A session is no artifact.

`routed.cause` is one of the causes a step may route: `limit`, `claim`, `exit`, `kind`, `broker`,
`interrupted` or `unmet`. [Workflows](workflows.md) covers inputs and routes.

Each skill is a directory under `.skills` in `MEDRENGARD_IN`, at the `path` listed.

## output.json

The step writes one outcome and the artifacts it claims:

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

A claim may adopt one of the attempt's inputs by its hash, in place of writing it out:

```json
{ "outcome": "done", "artifacts": [{ "adopt": "9f2c…" }] }
```

Rules:

- `outcome` is one of the step's declared outcomes.
- `artifacts` is optional. Each artifact is exactly `{ kind, fields, body? }` or `{ adopt }`.
- `fields` is required: `{}` when you claim none.
- `body` is the path of a file you wrote in `MEDRENGARD_OUT`, relative to it, in UTF-8.
- `output.json` is at most 64 KiB. Bodies are files, so only the fields count.
- A field must be one its kind defines, within its limit and among its `values`. A required field
  must be there.
- A body is within its kind's limit and inside the output.
- A kind's `outcome` field must equal the outcome.
- A judgement's claim does not name its `subject`. The engine adds it: the subject the attempt was
  given.
- The latest subject claimed becomes the subject. A judgement leaves the subject as it was.
- An adopted artifact is of a kind the step may claim and is not the current subject. It is
  recorded as it is, with the files its verifier kept, and is not verified again.
- No step claims a `decision`.

A claim that breaks a rule escalates the commission, cause `claim`. [Kinds](kinds.md) lists the
built-in kinds and what the commit verifier rejects.

## Notes

A note is a short line for the owner about what the step is doing. Write each as one line to
descriptor 3:

```sh
echo "Running the tests" >&3
```

- Each note is recorded as it arrives, so `watch` shows it at once.
- A note is at most 4096 bytes. A longer one stops the step, cause `limit`.
- Notes count toward the step's `transcript` limit.
- An empty line is no note.
- The record marks each note as from the step or from the engine. The engine notes a host its proxy
  refused, and what an attended step's `output.json` would amount to.
- The adapters cut each note they write at 200 characters, marked `…`. The transcript keeps the
  whole. See [agents](agents.md).

## Usage reports

A usage report says what the attempt has used so far. Write each as one JSON line to descriptor 4:

```sh
echo '{"usd": 0.42, "tokens": {"input": 10, "output": 20, "cacheRead": 30, "cacheWrite": 40}}' >&4
```

| Field    | Required | Meaning                                                                                    | Unit       |
| -------- | -------- | ------------------------------------------------------------------------------------------ | ---------- |
| `usd`    | no       | Money. 0 or more.                                                                          | US dollars |
| `tokens` | no       | `input`, `output`, `cacheRead` and `cacheWrite`, all four. Each a whole number, 0 or more. | tokens     |

- The latest report stands. It is recorded with the attempt however it ends, an interrupted one
  included. `show` prints it beside the attempt.
- A report is at most 4096 bytes, and counts toward the step's `transcript` limit.
- A line that is not a report stops the step, cause `claim`.
- A report is the step's claim: nothing verifies it.
- A step with a money limit must report `usd`. One that reports none escalates, cause `money`, and
  its claim is not recorded. One whose report goes over its limit, or the commission's, is stopped.

## Session

A step may leave a file `session` in `MEDRENGARD_OUT`: its harness's conversation, which a later
attempt may continue through a `session` input. The engine does not read what it holds.

- It is kept however the attempt ends, an interrupted one included.
- It must be a regular file of at most the step's `transcript` limit, in bytes.
- One over the limit is not kept, and the escalation's reason says so. An attempt that would
  otherwise complete escalates instead, cause `limit`.

## How an attempt ends

The exit code reports the step's health. The outcome reports its result. A test run that finds
failures exits 0 and claims a failing verdict.

| What happens                                                            | Then                                                           | Cause         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- | ------------- |
| Exit 0, a valid `output.json`, every claim accepted                     | The artifacts are recorded and the outcome's edge is followed. |               |
| Exit 0, `output.json` missing or invalid, or a verifier rejects a claim | The commission escalates.                                      | `claim`       |
| A kind's verifier or materialiser fails                                 | The commission escalates.                                      | `kind`        |
| A non-zero exit, a signal, or a program that cannot start               | The commission escalates.                                      | `exit`        |
| A limit reached                                                         | The engine stops the step. The commission escalates.           | `limit`       |
| A money limit reached, or no cost reported under one                    | The engine stops the step. The commission escalates.           | `money`       |
| A broker that does not start                                            | The step's program never starts. The commission escalates.     | `broker`      |
| The owner cancels                                                       | The engine stops the step. The commission escalates.           | `cancelled`   |
| Its parent withdraws the commission                                     | The engine stops the step. The commission escalates.           | `withdrawn`   |
| The engine fails on its own side, such as a full disk                   | The engine stops the step. The commission escalates.           | `engine`      |
| No engine is running the attempt, as when the engine died               | The next `advance` escalates the commission.                   | `interrupted` |

- To stop a step, the engine sends `SIGTERM`, then `SIGKILL` after 5 seconds.
- The limits that stop a step: `idle`, `attempt`, `transcript`, `memory`, `disk`, a note or usage
  report over 4096 bytes, and a filled `empty` path. Any output, on stdout, stderr or descriptor 3
  or 4, ends the idle time; so does the owner typing at an attended step.
- An escalation of an attempt whose program started carries its transcript, its errors when it
  wrote to stderr, its latest usage report and its session.
- A cancel also stops a kind's program running for the attempt. A cancel that arrives before the
  attempt's end is written wins: nothing the attempt claimed is recorded.
- What the step already did outside, such as a push, stays done.
- An engine failure names the error in the reason. If the store cannot keep the transcript, the
  reason says so. If the escalation cannot be written either, the next `advance` finds the attempt
  interrupted.
- A running attempt's transcript and errors are written as they arrive, to the `attempts` directory
  beside the log. So an interrupted attempt's escalation keeps what the step wrote.
- An escalation before the attempt starts, such as inputs over the `input` limit or a failure
  reading them from the store, spends no budget.
- A watching step's check that exits 0 without `output.json` found nothing yet. See
  [workflows](workflows.md).
