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
  - [Reaching only some hosts](#reaching-only-some-hosts)
- [Preparing a workspace](#preparing-a-workspace)
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

A workflow is a start step and its steps by name, and, optionally, `usd`: the most its
commission's attempts may cost between the owner's decisions, in US dollars, as their steps report
it. Before each attempt, and as each report arrives, the engine adds what the commission's attempts
have cost since its latest decision; past the limit, or with an attempt since then that reported no
cost, the commission escalates, and the owner's retry starts the count again, as it renews a
budget. `defineWorkflow` returns the workflow unchanged; it
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

  Besides these, a step may state `usd`, optional and never one of the factory's defaults: the most
  an attempt may cost, in US dollars, as its step reports it on file descriptor 4 (see
  [the step contract](#the-step-contract)). The attempt is stopped as soon as a report goes over it,
  and the commission escalates naming it. Unknown cost is not zero: an attempt that ends without
  reporting any cost escalates too, even with a valid claim. An attended step reports nothing, so
  it cannot state one.

A kind's verifier and materialiser have bounds of their own; see [Kinds](#kinds).

The engine refuses a workflow it could not run as written when it is commissioned, not halfway
through: among others, a step with no outcomes; a step that may claim a kind whose outcome field
has a value the step has no edge for, such as a verdict's `fail`; and a workspace that may be built
from a kind without a materialiser. For `"subject"` that is the document and every subject kind
any step claims; for an input, its `kind`, or else every kind its `from` steps may claim. A commission runs on the definition it started with, the factory's defaults included:
editing the factory affects only new commissions. The definition holds `run` as argv, not the program it names, so editing a script that
`run` points at changes every commission that runs it next. To pin a prompt, put its text in the
definition, not a path to it. An agent's skills are read when the commission starts and kept with
its definition, so editing a skill affects only new commissions. The engine is pinned as well:
commissioning and every attempt record the engine's version, a hash of its source, and an
upgraded engine never quietly changes how an unfinished commission goes on. Before its next
attempt, such a commission escalates, `Commission first last ran on engine 3f9a2c1d; this engine
is 7b01e4aa.`; the owner's retry carries it on with this engine, and abandoning ends it. Only a
decision on that escalation accepts the engine, not one at an approval step. A commission written
before engines recorded their version escalates the same way, once. A test keeps a log written on
2026-11-03 readable.

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

One more query is not over artifacts: `{ session: "implement" }` gives the latest session an attempt
of the step `implement` left, however that attempt ended, or none before it has left one. A session
is a harness's conversation, which the step's program leaves in its output as `session`; the
engine keeps it by hash and gives it to a later step whose query names it, which its adapter
continues. `input.json` lists it by its hash and body alone, with no kind or fields, and no
workspace is built from it. Its bytes count toward the input limit. A step that continues its own
session, `implement: { inputs: { earlier: { session: "implement" } } }`, picks up where its last
attempt left off, a failed one included, once the owner retries it.

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
  // true, false, or only some hosts: { hosts: ["api.anthropic.com", "registry.npmjs.org"] }.
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
  alone when npm is not beside it; never other global packages), the `adapters` directory, the
  `claude` executable, no host of its own and the broker `anthropic`, the adapter's, which holds
  the subscription token from `~/.config/medrengard/claude-token` outside the sandbox and is the
  only way to the model API, `PATH`, `HOME` and `LANG`, the
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

### Reaching only some hosts

`network: { hosts: [...] }` lets a step reach those hosts and nothing else: `host` on port 443,
`host:port` on another, `*.example.com` any subdomain of it. The step has no network of its own,
only loopback. The engine runs a proxy outside the sandbox that tunnels a CONNECT to a listed host
and refuses anything else, and a forwarder inside, on loopback, relays to it; `HTTPS_PROXY` and
`HTTP_PROXY`, in both cases, point there. `curl`, `git`, `npm`, `pip` and `claude` follow them; a
program that does not has no network at all, so it fails rather than leaks. Only HTTPS, as
CONNECT, gets through. Each host refused is noted once, from the engine,
`Step implement was refused network access to pastebin.com:443.`, so an agent that could not
fetch says why, and one that tried to send something somewhere shows it.

`claudeCode` lists no host, only its broker, so nothing the agent runs reaches anywhere but the
model API through it. List hosts for an agent that must, readably in the definition:

```ts
const access = {
  ...claudeCode,
  network: { ...claudeCode.network, hosts: ["registry.npmjs.org", "github.com"] },
};
```

### Brokers

A harness needs a credential to reach its model, and anything in the sandbox with it could read it
there. So a step's network may name brokers, `network: { hosts: [], brokers: { anthropic: [program,
...args] } }`, each a program the engine runs outside the sandbox while an attempt runs. The engine
starts it, in a systemd scope within the step's memory and process limits, with
`MEDRENGARD_SOCKET` naming a socket for it to listen on, waits up to 10 s for it to listen, binds
that socket into the sandbox, and stops it when the attempt ends. Inside, the forwarder relays a
loopback port to it and names that port in `MEDRENGARD_BROKER_<NAME>`, such as
`MEDRENGARD_BROKER_ANTHROPIC=http://127.0.0.1:41231`. The harness speaks plain HTTP to it with a
placeholder credential; the broker refuses any request without the placeholder, puts the real
credential in its place, and makes the TLS connection upstream. A broker that ends or does not
listen in time escalates the attempt before its program starts, with what it said on stderr:
`Step plan's broker anthropic ended before it listened: Cannot read the token file: ENOENT…`.

What the step runs can use the credential through its broker while the attempt runs, but never
read it. A broker is a harness adapter's program: the vendor's headers, paths and token refresh are
its, and `adapters/broker.ts` has what they share. A broker name is lowercase letters and digits.

Workspace preparation runs in the same step, so it reaches the same hosts. The paths may not name
`/network`, where the forwarder goes, nor grant `/` itself with a list of hosts, which leaves no
place for it. A kind's verifier or materialiser has all of the network or none.

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
- `claude` sends no telemetry, error reports or feedback, and fetches no feature flags
  (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), so it runs on its own defaults rather than on flags
  that could change between attempts of one commission; features Anthropic gates by flag stay
  off. If `claude` says it still sends telemetry, the adapter records it as a leak.
- The adapter keeps the conversation `claude` had as the attempt's session, however it ended, so a
  later step can continue it: `inputs: { earlier: { session: "plan" } }`. When a step declares one,
  `claude` continues it as a fork (`--resume`, `--fork-session`, under the attempt's own session
  id), so the session kept never changes; the agent is told its workspace was rebuilt from the
  latest commit, and is given this step's prompt, not the one its conversation began with. Before
  the step's first session there is none, and the agent starts afresh. A session `claude` cannot
  continue, such as another harness's, fails the attempt; it never starts afresh instead. An
  attended step continues one the same way.
- A run the account's usage limit refused, such as the five-hour or weekly window of a
  subscription, fails the attempt like any other, but its errors and a note say so, and when the
  window resets: `Claude Code's five-hour usage window is used up; it resets at
  2026-11-09T14:00:00.000Z.` Retry once it has.
- A tool `claude` refused the agent, such as `Bash` under `acceptEdits`, is noted:
  `Claude Code denied Bash: npm test`. An attended session shows its refusals on screen.
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
- Each attempt notes which Claude Code ran it and in what session:
  `Claude Code 2.1.319, session <uuid>.` The version is the one `claude` says it is; the session is
  a random id the adapter gives it with `--session-id`, so the note is there for an attempt that
  fails too. If `claude` never says what it is, the version is unknown; if it ran another session,
  the note names both. The session's files are still discarded with the attempt's home.
- The adapter tells the agent where its inputs are, and how to claim each kind its step's `claims`
  lists, from the kinds' rules in `input.json`.
- The subscription token never enters the step's sandbox. `claude` reaches the model API only
  through the step's broker `anthropic`, `claude-code-broker.ts [--token <file>]`, which reads the
  token from `~/.config/medrengard/claude-token` unless given another file; `claudeCode` names it.
  `claude` is given a placeholder in its place and the broker's address as `ANTHROPIC_BASE_URL`, so
  nothing the agent runs, such as a dependency's install script, can read the token, from a
  process or a file. A step whose access names no `anthropic` broker is refused. `claude` runs in a
  nested sandbox of its own, where what the agent runs sees only `claude` and itself.
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
  flags, home and workspace, runs headless with a token its broker refuses, and is stopped
  once it has said, before its first request: it costs nothing. What it loaded is checked as an
  unattended attempt's is, and one unfit to run opens no session: the attempt fails. This assumes
  `claude` loads the same in a session as headless, which nothing checks. Instruction files the
  session loads are recorded as an unattended attempt's are, and the version noted is the dry
  run's; the dry run keeps no session, so the session's id is the session's own;
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
  later step may continue (see [Inputs](#inputs)). It is kept however the attempt ends, an
  interrupted one included, if it is a regular file of at most the step's transcript limit; one
  over it is not kept, and the reason says so, and an attempt that would otherwise complete
  escalates instead.

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
| `check(workflow)`                                            | the definition it would be commissioned with, as `definition` gives a commission's; refuses as `commission` would, recording nothing                                                           |
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
| `register()`                                                 | a function that withdraws it; records this engine as running on the log, removing this machine's engines that ended                                                                            |
| `engines()`                                                  | `{ host, pid, since, status }[]`, oldest first: `alive` or `dead`, judged on this machine, or `unknown` on another                                                                             |

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
  check      [<workflow>]
  advance    <commission>
  attend     <commission>
  state      <commission>
  show       <commission>
  watch      <commission>
  events     [--after <position>] [--follow]
  commissions
  engines
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
- `check` checks each of the factory's workflows, or the one named, as `commission` would, skills
  included, and records nothing: `build: ok`, or `build:` and the refusal `commission` would give.
  It exits 1 if any fails, so a hook or CI can run it on every change to a factory. With `--json`
  it prints `{ workflow, error? }[]`; with a workflow named, the definition it would be
  commissioned with, in the shape `definition` prints a commission's, so comparing a factory with
  what a commission runs on is
  `diff <(medrengard definition first --json) <(medrengard check build --json)`.
- `engines` lists the engines registered on the log, oldest first, one line each:
  `alive    <host>  pid <pid>  since <time>`. `run` registers while it runs. On the log's own
  machine an engine is `alive` or `dead`, judged by its process, so a `run` killed without
  stopping shows as `dead` until the next one registers; one on another machine is `unknown`,
  since it can only be asked there.
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
  Home's first line says whether one is: `run: alive on <host>, pid <pid>, since <time>`, or
  `run: not running`, from the engines registered on the log, looked at every few seconds. A ready
  commission says it waits for `run`, and how long it has.

## Development

`npm test` here runs the type check and the tests; at the repository's root it also runs the linter
and the format check, for every package. Tests write only under the system temp directory.

## Licence

MIT: see [`LICENSE`](../LICENSE). [`tools/oxlint/anti-slop/`](../tools/oxlint/anti-slop/) is vendored from
[anti-slop](https://github.com/dmmulroy/anti-slop) under its own MIT licence, beside it.
