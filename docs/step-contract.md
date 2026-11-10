# The step contract

What a step's program is started with, what it reads and writes, and the module that does it for a program written in TypeScript.

Every command and agent step is a program, started:

- in its workspace, which it sees at `/workspace`;
- with `MEDRENGARD_IN`, `/input`: a read-only directory holding `input.json` and its inputs' bodies;
- with `MEDRENGARD_OUT`, `/output`: an empty directory for `output.json` and the bodies it claims;
- with only the environment its access names, and `PWD`, the workspace;
- with file descriptor 3 open for notes: short lines for the owner about what the step is doing,
  such as `echo "Running the tests" >&3`. Each note is recorded as it arrives, so `watch` shows
  it at once. A note is at most 4096 bytes, and notes count toward the transcript limit. The
  Claude Code adapter notes what the agent says, each tool it uses and how it finished, each cut
  at 200 characters and marked `…`; the transcript keeps the whole. The record marks each note
  `from` the step or the engine, which notes what an attended step's output holds;
- with file descriptor 4 open for usage reports: what the step has used so far, one JSON line
  each, `{"usd": 0.42, "tokens": {"input": 10, "output": 20, "cacheRead": 30, "cacheWrite": 40}}`,
  either field optional, none below zero, token counts whole. The latest report stands, and is
  recorded with the attempt however it ends, an interrupted one included; `show` prints it beside
  the attempt, `($0.42, 100 tokens)`. A report is at most 4096 bytes and counts toward the
  transcript limit; a line that is not one escalates. It is the step's claim: nothing checks it.
  The Claude Code adapter reports the tokens so far after each message, then the cost and tokens
  of its result. Claude Code's cost is its own estimate, even on a subscription, and an attended
  session reports nothing.
- with the option to leave a file `session` in its output: its harness's conversation, which a
  later step may continue (see [Inputs](workflows.md#inputs)). It is kept however the attempt ends, an
  interrupted one included, if it is a regular file of at most the step's transcript limit; one
  over it is not kept, and the reason says so, and an attempt that would otherwise complete
  escalates instead.

A step's program written in TypeScript has the contract as a module, `step/contract.ts`, in place
of the files and descriptors; a program in any other language uses those as they are:

```ts
// steps/reply.ts, in the factory's repository
import { artifactsOf, bodyOf, claim, note, readInput } from "@medrengard/core/step/contract.ts";

const given = readInput();
const [request] = artifactsOf(given, "request");

note(`Replying to ${request?.fields.title}`);
claim("done", [
  { kind: "document", fields: { title: "Reply" }, text: `Reply to: ${bodyOf(request ?? {})}` },
]);
```

```ts
import { node } from "@medrengard/core/defaults/access.ts";

const reply = {
  kind: "command",
  run: [process.execPath, "/path/to/factory/steps/reply.ts"],
  // node: contract, with Node and the module. The factory adds its program and its node_modules.
  access: {
    ...node,
    paths: [
      ...node.paths,
      { path: "/path/to/factory/steps", mode: "read" },
      { path: "/path/to/factory/node_modules", mode: "read" },
    ],
  },
  // ...
};
```

- `readInput()` gives `input.json`; `artifactsOf(given, name)` an input's artifacts, oldest first;
  `bodyOf(artifact)` its body as text.
- `claim(outcome, artifacts)` writes `output.json`. An artifact's `body` is a file the program
  wrote in its output, or `text` for the module to write there; `{ adopt: hash }` adopts an input.
- `note(text)` writes a note, `reportUsage({ usd, tokens })` a usage report, and `failed(why)`
  says why on stderr and exits 1, so the commission escalates.

A kind's programs use the same module, which the built-in kinds' access grants them:
`readClaim()` gives a verifier its `claim.json`, and `accept(keep)` or `reject(reason)` writes its
verdict; `readArtifact()` gives a materialiser its `artifact.json`, and `readBranches()` the
artifacts to add as branches, none when the step adds none.

The adapters, the GitHub forge's steps and the built-in kinds' programs are written with it.

`input.json` lists each input's artifacts, oldest first, always as a list. A body is a file at
`<input>/<hash>`, and `body` holds that path. An agent's skills are directories under `.skills`,
each listed with its path. `claims` holds the rules of each kind the step may
claim, so a program can tell its agent how to claim them:

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

`attended` and `agent` are there only for an agent step. An attended step's stdin, stdout and
stderr are its terminal. The step writes one outcome and any artifacts to
`output.json`, at most 64 KiB, with each body as a path relative to `MEDRENGARD_OUT`; bodies are
files, so only the fields count toward it:

```json
{
  "outcome": "done",
  "artifacts": [{ "kind": "document", "fields": { "title": "Plan" }, "body": "plan.md" }]
}
```

```json
{
  "outcome": "done",
  "artifacts": [
    { "kind": "commit", "fields": { "sha": "<the full SHA of HEAD>" }, "body": "report.md" }
  ]
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

The built-in kinds:

| Kind       | Role      | Fields                                   | Body                     | Checked by the engine                                                                                                                                                       |
| ---------- | --------- | ---------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document` | subject   | `title`, at most 200 bytes               | required, UTF-8, 1 MiB   | nothing more                                                                                                                                                                |
| `commit`   | subject   | `sha`, at most 64 bytes                  | optional report, 1 MiB   | the SHA is the workspace HEAD, not already the subject, its tree differs from its parent's and the subject's (a subject of any kind with a `sha`), and its history is whole |
| `verdict`  | judgement | `verdict` (`pass` or `fail`), `summary`? | optional findings, 1 MiB | `verdict` equals the outcome                                                                                                                                                |

Every body is UTF-8. A field the kind does not define escalates. The latest subject claimed becomes
the subject. A judgement such as a verdict leaves the subject alone, and the engine adds the
`subject` field: the subject the attempt was given. A claim that names its own `subject` escalates.
Only the owner makes a decision: a step that claims one escalates.

How the attempt ends:

- exit 0 with a valid `output.json`: the artifacts are recorded and the outcome's edge is followed;
- exit 0 with a missing or invalid `output.json`, or a claim the engine rejects: the commission
  escalates;
- a non-zero exit: the commission escalates. A test run that finds failures should exit 0 and claim
  a failing verdict;
- a limit reached, or the owner cancelling: the engine sends `SIGTERM`, then `SIGKILL` after 5
  seconds, and the commission escalates. A cancel also stops a kind's materialiser or verifier
  running for the attempt, and one that arrives before the attempt's end is written wins, so
  nothing the attempt claimed is recorded. What the step already did, such as a push, stays done;
- the engine failing on its own side, such as a full disk or a note it cannot write: the step is
  stopped and the commission escalates, naming the error, with the transcript and errors if the
  step ran; if the store cannot keep them, the reason says so. If even that cannot be written, the
  next `advance` finds the attempt interrupted, in this process or any other. A failure reading the
  step's inputs from the store escalates before the attempt starts, so no budget is spent;
- the engine dying mid-attempt: the next `advance` finds the attempt interrupted and escalates. A
  running attempt's transcript and errors are written as they arrive, to the `attempts` directory
  beside the log, so the escalation keeps what the step wrote before.
