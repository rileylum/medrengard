# Medrengard

A framework for building a personal software factory: workflows that take an idea to merged code.

[`docs/core.md`](../docs/core.md) holds what Medrengard is and the rules it keeps; this file shows how
to use what exists so far. The engine, the sandbox, the CLI, the TUI, attended steps and a Claude
Code adapter run, and the engine and CLI let an observer follow the log.

## Contents

- [Requirements](#requirements)
- [A first factory](#a-first-factory)
- [Workflows](#workflows)
- [Inputs](#inputs)
- [Access](#access)
- [Kinds](#kinds)
- [Agents and the Claude Code adapter](#agents-and-the-claude-code-adapter)
- [Attended steps](#attended-steps)
- [The step contract](#the-step-contract)
- [The engine in TypeScript](#the-engine-in-typescript)
- [The CLI](#the-cli)
- [The TUI](#the-tui)
- [Development](#development)

## Requirements

- Linux, with [bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`) on `PATH`: every agent
  and command step runs inside it.
- systemd, with the owner's user manager running (`systemd-run --user` works): each step and kind
  program runs in a scope of its own, which bounds its memory and processes.
- Node 24. It runs the TypeScript files directly; nothing is built.
- Git, for commits.
- A readable `/proc`, in one PID namespace for every engine on a log: an engine records its pid,
  start time and boot on each attempt it starts, so another can tell a live attempt from an
  interrupted one. Without its own entry in `/proc` the engine refuses to start.

Medrengard is the package `@medrengard/core`, in this directory, and is not published. A factory
outside this repository depends on it by path, `npm install ~/dev/medrengard/core`, and imports only
the modules its `exports` names.

## A first factory

A factory is a TypeScript module whose default export is the engine's options: where the log lives,
the kinds of artifact its steps claim, the workflows by name, and its defaults: the limits every
step has unless it names its own. This one replies to the request, checks the reply and asks the
owner.

```ts
// factory.ts
import { defineWorkflow } from "@medrengard/core/src/replay.ts";
import { contract } from "@medrengard/core/defaults/access.ts";
import { builtIn } from "@medrengard/core/defaults/kinds.ts";
import { limits } from "@medrengard/core/defaults/limits.ts";

export default {
  // Relative to this file.
  log: "state/log.sqlite",
  // Document, commit and verdict. See Kinds.
  kinds: builtIn,
  // Every step's limits, unless it names its own. See Workflows.
  defaults: { limits: { ...limits, idle: 60, attempt: 600 } },
  workflows: {
    greet: defineWorkflow({
      start: "write",
      steps: {
        // Reads the request and claims a document, which becomes the subject.
        write: {
          kind: "command",
          workspace: "empty",
          inputs: { request: "request" },
          claims: ["document"],
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
        },
        // Judges the reply in its workspace and claims a verdict. The subject stays the reply.
        check: {
          kind: "command",
          workspace: "subject",
          inputs: {},
          claims: ["verdict"],
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
          // A check is quick; the rest are the factory's.
          limits: { attempt: 60 },
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
alias medrengard="node medrengard/core/cli/medrengard.ts"

medrengard commission greet first --title Greet --body "Say hello."
medrengard advance first
# awaiting at approve since event 4, about 51da8742…
medrengard artifact 51da8742…
# document
# title: Reply
#
# Reply to: Say hello.
medrengard decide first accept --subject 51da8742… --since 4
# finished by end
```

`advance` runs ready steps until the commission awaits the owner, escalates or finishes. `decide`
must name the current subject and the wait, by the event that began it, so a decision can
never approve something the owner has not seen: not another subject, and not the same subject at a
later gate or escalation, with evidence the owner has not read. At any approval step, as on any
escalation, `abandon` finishes the commission as abandoned, so an approval step cannot declare it.

## Workflows

A workflow is a start step and its steps by name. `defineWorkflow` returns the workflow unchanged; it
exists so the compiler checks every step name an edge or query uses. Each step's `on` maps an
outcome to the next step or to `end`.

There are three kinds of step:

| Kind       | Runs                                 | Fields besides `kind` and `on`                                                       |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| `command`  | the owner's program, `run`           | `run`, `workspace`, `inputs`, `claims`, `budget`, `access`, `limits`?                |
| `agent`    | an agent through its harness adapter | `agent`, `attended`?, `workspace`, `inputs`, `claims`, `budget`, `access`, `limits`? |
| `approval` | nothing: it waits for the owner      | none                                                                                 |

The fields of a command or agent step:

- `workspace`: `"empty"`; `"subject"` to build the working directory from the current subject; or
  `{ input: "base" }` to build it from the one artifact the step's input `base` names, whatever the
  subject is, such as the commit a change starts from. That input must be `"subject"`, `"request"`
  or a query that takes the latest; if it names nothing, the commission escalates before an attempt
  starts. A commit is checked out with its history; a document is written to the file `document`.
- `inputs`: what the step is given, by name. See [Inputs](#inputs).
- `claims`: the artifact kinds the step may claim, such as `["commit"]`; `[]` for none. A claim of
  any other kind escalates. A step need not claim what it lists. See
  [the step contract](#the-step-contract) for the kinds.
- `budget`: the attempts the step may start between the owner's decisions, above zero. It bounds
  every loop: a step that has spent its budget escalates.
- `access`: what the step's process may read, write and reach. See [Access](#access).
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

A kind's verifier and materialiser have bounds of their own; see [Kinds](#kinds).

The engine refuses a workflow it could not run as written when it is commissioned, not halfway
through: among others, a step with no outcomes; a step that may claim a kind whose outcome field
has a value the step has no edge for, such as a verdict's `fail`; and a workspace that may be built
from a kind without a materialiser. For `"subject"` that is the document and every subject kind
any step claims; for an input, its `kind`, or else every kind its `from` steps may claim. A commission runs on the definition it started with, the factory's defaults included:
editing the factory affects only new commissions. The definition holds `run` as argv, not the program it names, so editing a script that
`run` points at changes every commission that runs it next. To pin a prompt, put its text in the
definition, not a path to it. An agent's skills are read when the commission starts and kept with
its definition, so editing a skill affects only new commissions. The engine itself is not pinned:
upgrading Medrengard can change how an unfinished commission runs from then on, so finish or
abandon commissions before upgrading. A test keeps a log written on 2026-11-03 readable.

`src/replay.ts` exports the types `Workflow`, `Agent`, `Access` and `Query`. A `run` is a non-empty
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

A decision on an escalation is decided at the escalated step, so `from` keeps it too. Without a
`kind`, `{ from: ["design"], take: "latest" }` gives the owner's retry, not the plan, once design
has escalated and been retried.

A decision's fields are its `outcome` and the `subject` it names; the owner's feedback is its body,
at most 1 MiB.

An input name is also a directory in the step's input, so it may hold only letters, digits, `-` and
`_`, starting with a letter.

## Access

Every command and agent step runs in bubblewrap under its `access`:

```ts
import type { Access } from "@medrengard/core/src/replay.ts";

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
  // Optional: variables set to text, over the engine's own. Recorded with the definition, so no secrets.
  values: { TZ: "UTC" },
  // A reviewer can get "read".
  workspace: "write",
  // Whether its processes may make namespaces of their own, as a sandbox inside it does.
  sandboxes: false,
};
```

The workspace, the input (read-only) and the output are always there, at `/workspace`, `/input`
and `/output`, paths that name nothing of the machine, the same for every step; `MEDRENGARD_IN` and
`MEDRENGARD_OUT` are always set to the last two. A path in `paths` cannot be one of them or under one.
A step whose access grants `/` itself sees the machine as it is, its directories where the engine
keeps them. `PATH` is passed like any other variable, only when `environment`
names it; without it a step finds commands only in the system's default search path. A name in
`values` cannot also be in `environment`, nor be `MEDRENGARD_IN` or `MEDRENGARD_OUT`; with
`environment: "all"`, a value is set over the engine's. A step has
namespaces of its own (user, cgroup, IPC, hostname, process and, without `network`, network): on a
machine that cannot make one, the step fails rather than run without it. Without `sandboxes` it
cannot make more: the kernel refuses user namespaces, which keeps more of it out of reach of what
the step runs. It has its own `/proc` and a minimal `/dev`, read-only but for `/dev/shm`, a fresh
area held in the step's memory and bounded by its memory limit. A step that fills an `empty` path of its access
escalates, if it is still running when the engine next looks, once a second; a step that ends first
only sees its writes fail.

The log's directory, which holds the log, the store and the attempts, is hidden from every step and
kind program whatever its access: it is empty and read-only, but for the attempt's own workspace,
input and output and any path the access names under it. So no access can let a step write a
decision without naming the log's directory itself.

`@medrengard/core/defaults/access.ts` holds two values to use as they are or to change one dial of, and
`gitIdentity(name, email)`, the `values` that make Git author and commit as that identity.
"The system" is `/usr`, `/etc`, `/opt`, `/bin`, `/sbin`, `/lib` and `/lib64` to read, where they
exist.

- `contract`: the system, a fresh `/tmp` of 256 MiB and `PATH`, without `sandboxes`. No home, no network and no `HOME`, so a
  program that needs a home or a cache, such as `npm`, must be pointed at `/tmp`.
- `claudeCode`: what the Claude Code adapter needs: the system, a fresh `/tmp`, an empty home of
  256 MiB, Node and npm (Node's `bin` directory and npm's package, or the `node` executable
  alone when npm is not beside it; never other global packages), the `adapters` directory, the `claude` executable and the token
  file `~/.config/medrengard/claude-token` to read, the network, `PATH`, `HOME` and `LANG`, the
  Git identity `Medrengard <medrengard@localhost>` as `values`, and `sandboxes`: the adapter runs `claude` in a sandbox of its own, in which what
  the agent runs cannot make namespaces. Its home is empty, so the owner's settings, skills, hooks
  and MCP servers never load. A path under the home, such as a repository,
  stays invisible until you add it: the deeper entry wins.

```ts
import { contract } from "@medrengard/core/defaults/access.ts";

// A step that clones the owner's repository into its empty workspace.
const cloning = {
  ...contract,
  paths: [...contract.paths, { path: "/home/owner/dev/app", mode: "read" as const }],
};
```

## Kinds

A kind says what an artifact of it holds, and how the engine checks a claim of it. The factory
passes its kinds by name; `@medrengard/core/defaults/kinds.ts` exports the built-ins as `builtIn`, to use
as they are, change, or add to:

```ts
import { contract } from "@medrengard/core/defaults/access.ts";
import { builtIn } from "@medrengard/core/defaults/kinds.ts";
import type { Kind } from "@medrengard/core/src/kinds.ts";

// A judgement, so the subject stays the commit it was opened for.
const pullRequest: Kind = {
  role: "judgement",
  description: "The pull request you opened for what the workflow is about.",
  fields: { url: { limit: 2048, required: true }, number: { limit: 16, required: true } },
  body: { required: false, limit: 64 * 1024 },
};

export const kinds = { ...builtIn, "pull-request": pullRequest };
```

- `role`: a `subject`, which becomes what the commission is about, or a `judgement` about it. The
  engine adds a judgement's `subject` field, so a judgement cannot define one.
- `description`: one line that tells a step what the kind is and how to claim it. The Claude Code
  adapter passes it to the agent.
- `fields`: each field's rule by name. Every field is text of at most `limit` bytes; `required:
  true` makes it required, and `values` limits it to a list.
- `body`: whether a UTF-8 body is required, and its `limit` in bytes.
- `outcome`, optional: a required field with `values` that must equal the claimed outcome, as a
  verdict's `verdict` does. A judgement with one routes the step, so a claim of it beside a new
  subject escalates: it would be about the subject that claim replaces.
- `verifier` and `materialiser`, optional: programs, each a `run`, an `access`, a `limit` in
  seconds, `memory` in bytes and `processes`, bounded like a step's; a verifier also `kept`, the
  bytes of all the files it keeps for an artifact, 0 for one that keeps none. Each runs in its own sandbox, like a step;
  leaving the sandbox is an access you write, such as one that writes `/`. The built-ins' have 60 s, 4 GiB and
  1024 processes, and the commit verifier keeps 1 GiB, its bundle holding the whole history.

The kinds must include `document`, the kind of the owner's request, and cannot include `decision`,
which only the owner makes. Since the engine makes the request a document, with a title and a
body, `document` must be a subject, define `title`, require no other field and have no verifier, and
a request whose title or body breaks its rules is refused before it is commissioned. A name holds letters, digits and `-`, starting with a letter. A
commission records the kinds it started with, beside its workflow: editing a kind affects only new
commissions.

A verifier runs after a claim of its kind parses, in the attempt's workspace, in the mode its access
gives. Its `MEDRENGARD_IN` holds `claim.json`, with the claim's `fields`, its `body` as a path to
the file `body` when it has one, and the commission's current `subject`. It writes `output.json`:
exactly `{ "accepted": true, "keep": [...] }`, naming files in its `MEDRENGARD_OUT` for the store to
keep, together at most its `kept` bytes, `[]` for none; or exactly `{ "accepted": false, "reason": "..." }`, and
the commission escalates with the reason. Anything else, a field more included, fails the verifier.

A materialiser builds a later step's workspace from a subject, the current one or an input's, in an
empty workspace. Its
`MEDRENGARD_IN` holds `artifact.json`, with the artifact's `hash`, `kind`, `fields`, `body` and
`kept` files as paths, and those files. A workflow whose workspace may be built from a kind without
one is refused when it is commissioned.

A verifier or materialiser gets less than a step: no fd 3 for notes, its stdout is discarded, and
its stderr is kept only when it fails, ending the escalation's reason (its last 1024 bytes). A
failure, a reached limit or a signal escalates the commission, naming the program and its step;
a step whose workspace could not be built never starts.

## Agents and the Claude Code adapter

An agent is a harness adapter to run, a model, a prompt and any skills. The adapter is a program
like any command; `adapters/claude-code.ts` runs the agent through `claude -p`:

```ts
import { claudeCode } from "@medrengard/core/defaults/access.ts";

const design = {
  kind: "agent",
  agent: {
    harness: {
      // An absolute path: the program runs in its workspace.
      run: [
        "node",
        "/path/to/medrengard/core/adapters/claude-code.ts",
        "--permission-mode",
        "bypassPermissions",
      ],
    },
    model: "sonnet",
    prompt: "Read the request and write a plan for it.",
    skills: ["/path/to/skills/tdd"],
  },
  workspace: "empty",
  inputs: { request: "request" },
  claims: ["document"],
  on: { done: "approve" },
  budget: 1,
  access: claudeCode,
  limits: { idle: 300, attempt: 3600, transcript: 16 * 1024 * 1024, input: 1024 * 1024 },
} as const;
```

- `skills` are paths to skill directories, each holding a `SKILL.md`: the Agent Skills format,
  which harnesses other than Claude Code read too. A skill is named by its
  directory; an agent cannot have two of one name. Leave `skills` out for none.
- `--permission-mode acceptEdits`, the default, lets the agent edit files but not run commands.
  `bypassPermissions` lets it do anything its access allows, so the sandbox is its only boundary.
- `--tools Bash,Read,Write` names the Claude Code tools the agent gets, `Bash,Read,Edit,Write` if
  left out. An agent with skills also gets `Skill`, and its skills load as the plugin
  `medrengard`, named `medrengard:<skill>`.
- `--effort low|medium|high|xhigh|max` and `--max-budget-usd 2` pass on to `claude`. The budget
  is checked after each turn, so a run can spend a little past it; over it, the attempt fails.
  Without it, an attempt's spend is bounded only by its time limit.
- A run `claude` reports as an error, such as running out of turns or budget, or one that ends
  without reporting at all, fails the attempt whatever `claude`'s exit code, saying why in its
  errors: a claim the agent wrote before is not recorded.
- Nothing else of Claude Code's own loads: no bundled skills or built-in plugins, no settings
  files, no MCP servers, no memory, no `CLAUDE.md` or `AGENTS.md`, and no `Co-Authored-By` in the
  agent's commits. Nothing the workspace holds configures `claude` either: not its `.mcp.json`,
  `.claude/` settings, hooks, skills or subagents, nor its `CLAUDE.md`. Some of the settings that
  do this are undocumented, as of Claude Code 2.1.318.
- Claude Code's managed settings in `/etc/claude-code`, which no flag turns off, are hidden from
  `claude` when they exist. Managed settings an organisation's token brings from the server are
  not; a personal subscription has none.
- `claude` silently ignores settings with an invalid value, all of them at once, so the adapter's
  carry a canary hook. If it has not run by the time `claude` says what it loaded, the adapter
  stops `claude` before its first turn and the attempt fails, saying why in its errors and a note.
  A setting a release renames is ignored on its own, which the canary cannot see.
- So too if `claude` did not load a skill the agent declares, such as one whose `SKILL.md` it
  cannot read, which it drops without an error, or reports a plugin it could not load.
- If `claude` loads tools, skills, plugins or MCP servers the agent did not declare, the adapter
  records them as the attempt's errors and as a note, and the attempt carries on. If it never says
  what it loaded, the adapter records that instead. Its subagents
  count only when it has the `Task` tool.
- A `CLAUDE.md` or rules file `claude` loads, at its start or later, when the agent reads a
  directory holding one, is recorded the same way, through Claude Code's `InstructionsLoaded`
  hook. `AGENTS.md` fires no such hook, so its loading cannot be seen; it is kept out by turning
  off the built-in plugin that loads it.
- The adapter tells the agent where its inputs are, and how to claim each kind its step's `claims`
  lists, from the kinds' rules in `input.json`.
- `--token <file>` is the file holding the subscription token, `~/.config/medrengard/claude-token`
  if left out; `claudeCode` grants that default. `claude` runs in a nested sandbox of its own and
  reads the token from a file descriptor, so nothing the agent runs, such as a dependency's install
  script, can read it from a process's environment or from the file. A
  `CLAUDE_CODE_OAUTH_TOKEN` the step is given is not passed on.
- `claudeCode` commits as `Medrengard <medrengard@localhost>`, whatever the engine's environment
  holds. For another identity, `{ ...claudeCode, values: gitIdentity("Name", "email") }`.
- `claudeCode` grants the adapter's real directory. If you reach this repository through a
  symlink, pass the adapter's real path (`fs.realpathSync`), or the sandbox cannot see it.
- A file path in `run`, such as the adapter's, must be absolute: every step's program starts in its
  workspace.

## Attended steps

An agent step with `attended: true` runs with the owner, in their terminal: for designing a change
together, or reviewing one. `run` and `advance` never start it. The commission stays `ready` at it,
its state's step marked `attended: true`, and `run` says so once, `ready at design, to attend`.

```sh
medrengard attend first
```

`attend` starts the step's agent in the terminal it is run in; a herdr pane or a UI runs the same
command. It returns once the agent's program ends, printing where the commission is now, and `run`
carries on from there. With the Claude Code adapter:

- the agent's prompt and how to claim are its system prompt, so compacting a long session keeps
  them, and the agent begins at once. It writes `output.json` once the owner agrees the work is
  done, and again if they want changes. The owner ends the session with `/exit`; the last
  `output.json` written is the claim, judged as any other. Leaving without one escalates;
- each time it writes `output.json`, the engine notes what that would amount to, `Step design's
  output is ready: outcome done, with 1 artifact: document.`, or why it would escalate. The note
  cannot be drawn inside Claude Code's screen, so it is in the record for `watch`, `events` or a
  pane beside the session;
- Claude Code's first-run questions are answered in a home that has not run it;
- a session does not say what it loaded, so before it opens, the same `claude`, with the same
  flags, home and workspace, runs headless with a token that cannot authenticate, and is stopped
  once it has said, before its first request: it costs nothing. What it loaded is checked as an
  unattended attempt's is, and one unfit to run opens no session: the attempt fails. This assumes
  `claude` loads the same in a session as headless, which nothing checks. Instruction files the
  session loads are recorded as an unattended attempt's are;
- `--max-budget-usd`, which `claude` keeps only with `-p`, is refused: the attempt escalates.

The step runs under `script(1)`, in a pseudo-terminal of its own: its window follows the owner's
terminal, Ctrl-C reaches the agent, and it cannot push input into the owner's terminal. `TERM` is
passed on. The transcript is what the terminal showed, escapes included; what the owner types
counts as activity for the idle limit and is not kept. An idle session writes nothing, so a
default idle limit of 600 s stops a session in which neither the agent nor the owner did anything
for ten minutes; declare `idle: "unbounded"` for one that may wait for the owner longer. A cancel,
or a limit, stops the step as any other. If the owner's terminal closes, the attempt is
interrupted and escalates when next advanced. `attend` refuses a commission not ready at an
attended step, and stdin or stdout that is not a terminal.

## The step contract

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
  `from` the step or the engine, which notes what an attended step's output holds.

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

## The engine in TypeScript

The CLI is a thin layer over `createEngine`, and so is any other client:

```ts
import { createEngine } from "@medrengard/core/src/engine.ts";
import factory from "./factory.ts";

const engine = createEngine({
  log: "/var/tmp/factory/log.sqlite",
  kinds: factory.kinds,
  workflows: factory.workflows,
});

// Starts a commission: the request is its first subject.
engine.commission("greet", "first", { title: "Greet", body: "Say hello." });

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

| Method                                                       | Returns                                                                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commission(workflow, commission, { title, body })`          | nothing; refuses an unknown workflow or an invalid one                                                                                                                                         |
| `advance(commission, { signal? })`                           | the state it stopped at, which may be ready at an attended step; once `signal` aborts, it starts no further attempt                                                                            |
| `attend(commission)`                                         | the state once the attended step it is ready at ends, run in this process's terminal                                                                                                           |
| `events(position)`                                           | `{ position, commission, event }[]`: every commission's events after the log position, oldest first                                                                                            |
| `next(position, { signal? })`                                | the same, once there are any, woken by any engine's write; none once `signal` aborts                                                                                                           |
| `state(commission)`                                          | the state, replayed from the log                                                                                                                                                               |
| `commissions()`                                              | `{ commission, state }[]`, oldest first; `{ commission, error }` for one the engine cannot read                                                                                                |
| `decide(commission, { subject, since, outcome, feedback? })` | the new state; refuses a stale subject or wait, an undeclared outcome, or feedback over 1 MiB                                                                                                  |
| `cancel(commission)`                                         | nothing; the engine running the attempt stops it and escalates, or, with none, it escalates at once                                                                                            |
| `record(commission)`                                         | `{ state, request, entries }`: every attempt, escalation and decision, oldest first; each claimed artifact with its `verifier`, the command that accepted it, or `null` when its kind has none |
| `errors(commission, attempt)`                                | what the attempt wrote to stderr, as a `Buffer`; empty for none                                                                                                                                |
| `transcript(commission, attempt)`                            | the attempt's stdout and stderr as a `Buffer`                                                                                                                                                  |
| `artifact(hash)`                                             | `{ kind, fields, body? }`; refuses a hash the log does not name as an artifact                                                                                                                 |

A state has a `status`:

- `ready` or `attempting`, at an agent or command `step`, about a `subject`; an attended step is
  marked `attended: true`;
- `awaiting`, at an approval `step`, about a `subject`;
- `escalated`, at a `step`, about a `subject`, with a `reason` of at most 4096 bytes, longer ones
  cut and marked `… (cut to 4096 of N bytes)`;
- `finished`, `by` `"end"` or `"abandoned"`: abandoned only by the owner's `abandon`, at an
  approval step or an escalation; an approval's own edge to `end` finishes it by `"end"`.

Every state but `finished` also carries `decision`: the hash of the owner's latest decision about
the subject, if there is one.

## The CLI

```text
medrengard <command> [--json] [--factory <path>]

  commission <workflow> <commission> --title <title> (--body <text> | --body-file <path>)
  advance    <commission>
  attend     <commission>
  state      <commission>
  show       <commission>
  watch      <commission>
  events     [--after <position>] [--follow]
  commissions
  run        [--parallel <n>]
  decide     <commission> <outcome> --subject <hash> --since <event>
             [--feedback <text> | --feedback-file <path>]
  cancel     <commission>
  transcript <commission> <attempt>
  errors     <commission> <attempt>
  artifact   <hash or a prefix of at least 8 characters>
  definition <commission>
```

- The factory is `--factory <path>`, or else `MEDRENGARD_FACTORY`. The CLI never guesses one,
  because loading a factory runs its code.
- With `--json`, stdout holds exactly one JSON value: the method's return, or `null` for
  `commission` and `cancel`. An error goes to stderr as `{"error": "…"}`. Without `--json`, the
  output is for people, not for parsing.
- Exit codes: 0 when the call succeeded, an escalation included; 1 when the engine refused or
  failed; 2 for a usage error.
- `show` prints the commission's record: one line per attempt with what it claimed and how long
  it took, each escalation and each decision with its feedback, then the current subject and every judgement
  about it in full. Each artifact says whether a verifier accepted it, `(verified)`, or its kind has
  none, `(no verifier)`; in full, it names the verifier's command. It is what the owner reads at a
  gate. With `--json` it prints
  `engine.record`, whose times are milliseconds since the epoch. A log written before events
  carried times shows no durations.
- `watch` follows a commission as the log records it: each attempt as it starts, its notes as
  they arrive, its ending, and each escalation and decision. It stops once the commission awaits
  the owner, escalates or finishes; on one that already has, it prints the whole story. `show`
  leaves the notes out. It is woken by each new event, rather than looking every so often.
- `attend` starts the attended step a commission is ready at in the terminal it is run in. See
  [Attended steps](#attended-steps).
- `events` prints every commission's events after `--after`, 0 if left out, one line each with its
  position; `--follow` then prints each new one as it is written, until stopped. With `--json`,
  each line is one JSON value, `{ position, commission, event }`, for a UI or another observer to
  read.
- `transcript` prints everything an attempt wrote; `errors` prints its stderr alone. Both write the
  bytes unchanged to a file or program, and to a terminal as text with control characters made
  visible, as below.
- Every control character a terminal would act on rather than show (C0 but newline and tab, DEL,
  C1 and the bidi controls) is printed as `\uXXXX`, on stdout and stderr, readable or `--json`. A
  step's text can hold them, and could otherwise move the cursor, rewrite what the owner reads at a
  gate, set the clipboard or reorder a line. In JSON the escape is the same value; the engine's
  record keeps the text as claimed, so a program showing it to people must do the same.
- `artifact` takes a hash, or a unique prefix of at least 8 characters, as `show` prints them, and
  refuses one the log does not name as an artifact. `decide` takes the full hash.
- `definition` prints the definition a commission was commissioned with and runs on: its
  workflow, with each step's access, agent and harness command, and its limits made whole from the
  factory's defaults it recorded; its kinds; and its skills by file hash. It is what a step was
  allowed, whatever the factory says now. With `--json` it prints `engine.definition`.
- `run` advances every ready commission, at most `--parallel` steps at once (1 by default), oldest
  commission first. It prints one line per result, and keeps looking for ready commissions until it
  is stopped. A first Ctrl-C starts nothing new and waits for the running steps, leaving each
  commission ready at its next step; a second exits at once, and each interrupted attempt
  escalates when next advanced. A commission the engine cannot read is left alone, its error printed
  once on stderr; `commissions` lists it as unreadable. A commission ready at an attended step is
  left for the owner, said once. `run` is woken by each new event, and looks at least once a
  second, so it finds an attempt whose engine died.

## The TUI

```text
node medrengard/core/tui/medrengard-tui.ts [--factory <path>]
```

The owner's terminal UI, a default a factory can replace: it calls the engine's methods as the CLI
does, and needs the owner's terminal as stdin and stdout. The factory is found as for the CLI.

- Home lists what needs the owner (awaiting, escalated with its reason, or ready at a step to
  attend), then what is running, then what waits for `run`, each with how long since it last
  changed; finished commissions are folded under `f`. Enter opens a commission's record, which
  grows as the log does.
- On a commission, Enter opens the request, an attempt's transcript or an artifact in full in
  `$PAGER` (`less` if unset), and `e` an attempt's errors, with control characters made visible.
- `d` decides: an outcome, then no feedback, a line, or text from `$VISUAL` or `$EDITOR` (`vi` if
  unset), then a confirmation. The decision names the subject and wait the owner saw when they
  pressed `d`, so the engine refuses it if the commission has moved on.
- `x` cancels a running attempt, `a` attends a step in the same terminal and comes back after,
  `n` commissions a request (workflow, name, title, then the body in the editor), `?` lists the
  keys, `q` quits.
- The TUI never runs steps but the one the owner attends: keep `medrengard run` going beside it.
  An idle `run` writes nothing, so the TUI cannot show whether one is running; a ready commission
  says it waits for `run`, and how long it has.

## Development

`npm test` here runs the type check and the tests; at the repository's root it also runs the linter
and the format check, for every package. Tests write only under the system temp directory.

## Licence

MIT: see [`LICENSE`](../LICENSE). [`tools/oxlint/anti-slop/`](../tools/oxlint/anti-slop/) is vendored from
[anti-slop](https://github.com/dmmulroy/anti-slop) under its own MIT licence, beside it.
