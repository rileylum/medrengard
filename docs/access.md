# Access

What a step's process may read, write and reach, the defaults to start from, and how a broker keeps a credential outside the sandbox.

Every command and agent step states an `access`. The engine starts the step's program in a sandbox
that enforces it: bubblewrap, in a systemd user scope that holds the step's `memory` and `processes`
limits. Start from a default and change what you need, or write one whole:

```ts
import type { Access } from "@medrengard/core/src/definition.ts";

export const access: Access = {
  paths: [
    { path: "/usr", mode: "read" },
    { path: "/home/owner/dev/app", mode: "read" },
    { path: "/var/cache/build", mode: "scratch" },
    { path: "/tmp", mode: "empty", size: 256 * 1024 * 1024 },
  ],
  network: false,
  environment: ["PATH", "LANG"],
  values: { TZ: "UTC" },
  workspace: "write",
  sandboxes: false,
};
```

## Fields

| Field         | Required | Meaning                                                                                             |
| ------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `paths`       | yes      | The paths of the machine the step sees, each with a mode. See [Paths](#paths).                      |
| `network`     | yes      | `true`: the engine's network. `false`: loopback only. `{ hosts, brokers? }`: only what it lists.    |
| `environment` | yes      | Names of variables passed through from the engine's environment, or `"all"`.                        |
| `values`      | no       | Variables set to text, over the engine's own. Recorded with the definition, so never a secret.      |
| `workspace`   | yes      | `"write"` or `"read"`: the mode of the step's workspace. A reviewer can have `"read"`.              |
| `sandboxes`   | yes      | Whether the step's processes may make namespaces of their own, as a sandbox inside the step's does. |
| `cgroups`     | no       | Whether the step has its own control group to divide. See [Control groups](#control-groups).        |
| `users`       | no       | `"range"`: the owner's range of users, as a container tool needs. See [Users](#users).              |

A commission is refused before it starts if a step's access breaks a rule below, or holds a field
this table lacks.

## Paths

| Mode      | What the step sees at the path                                                           | Bounded by                   |
| --------- | ---------------------------------------------------------------------------------------- | ---------------------------- |
| `read`    | What is there, read-only.                                                                |                              |
| `write`   | What is there, writable.                                                                 |                              |
| `scratch` | A fresh, empty directory on disk, in the attempt's own area. Gone when the attempt ends. | The step's `disk` limit      |
| `empty`   | A fresh, empty directory held in memory, over whatever is there.                         | Its `size`, in bytes, over 0 |

- A path is absolute and normalised: no `.`, `..` or doubled `/`.
- A path no entry covers is invisible.
- Where paths nest, the deeper entry decides. On the same path, `read` wins.
- Only an `empty` entry has a `size`.
- No path may be `/workspace`, `/input`, `/output` or `/network`, or under one.
- A step that fills an `empty` path escalates, cause `limit`, if it is still running when the engine
  next looks, once a second: `Step build filled /tmp, its area of 268435456 bytes.` A step that
  ends first only sees its writes fail.
- A step that grants `/` itself sees the machine as it is. Its workspace, input and output are then
  where the engine keeps them, not at `/workspace`, `/input` and `/output`; `MEDRENGARD_IN` and
  `MEDRENGARD_OUT` name them.

## What every step has

Whatever its access, a step has:

- its workspace at `/workspace`, in the mode `workspace` gives, as its working directory;
- its input at `/input`, read-only, and its output at `/output`, writable;
- `MEDRENGARD_IN`, `MEDRENGARD_OUT` and `PWD`, set to those three paths;
- its own `/proc`, and a minimal `/dev`, read-only but for `/dev/shm`. `/dev/shm` is a fresh area
  held in memory, which the step's `memory` limit bounds;
- a read-only root: nothing outside the paths above takes writes;
- namespaces of its own: user, cgroup, IPC, hostname and process, and network unless `network` is
  `true`. On a machine that cannot make one, the step fails;
- no swap: memory over the step's limit stops it.

And never has:

- the log's directory, which holds the log, the store and the attempts. The step finds it empty and
  read-only, whatever its access. Only the attempt's own workspace, input and output, and paths the
  access names under it, show there. So no access lets a step write a decision.

Without `sandboxes`, the kernel refuses the step's processes any user namespace. An agent that runs
tools that sandbox themselves, such as bubblewrap, Codex or Chromium, needs `sandboxes: true`. A
namespace the step makes still sees nothing the access hides and writes nothing it made read-only.

## Control groups

With `cgroups: true`, a step finds its own control group at `/sys/fs/cgroup`, and no group but its
own. It can make groups under it and bound the memory and processes of programs it runs.

- An engine inside the step does this for its own steps, with the same limits, since it cannot
  reach systemd. So Medrengard's own tests run in a step with `sandboxes: true, cgroups: true`,
  from a copy of the repository outside `/workspace`, which the engine under test keeps for its own
  steps.
- Whatever the step makes stays within its own memory and process limits.
- The step keeps the engine's control-group namespace, so `/proc/self/cgroup` names where its group
  sits on the machine.
- Going over its memory limit stops the process that went over, not every process of the step. The
  commission escalates naming the limit if the step then fails.
- A program the step bounded itself and lost is the step's own business: if the step fails for it,
  the escalation names the step's exit, not a limit.

## Users

A step has one user, the owner. With `users: "range"` it has the owner's range from `/etc/subuid`,
mapped by the machine's `newuidmap` and `newgidmap`, and is the first of them: user 0 inside, the
owner outside. A container tool needs this to unpack an image, whose files belong to many users,
and to run a program as its own user, as PostgreSQL insists on.

- It needs `sandboxes: true`.
- A machine with no range for the owner fails the step as it starts.

Rootless Podman then runs containers inside the step's sandbox, where its access and limits hold
them, given also:

- `cgroups: true`, for the runtime to put each container in a group;
- a network of the step's own, `network: false` or a list of hosts. The tool builds its containers'
  network there, and their published ports appear on the step's loopback;
- `/sys` to read, which the runtime wants before it mounts one for a container;
- scratch paths at `/run`, `/var/lib/containers`, `/var/tmp` and `/var/cache`, for the tool's state.

Once the step's programs end, the engine hands back to the owner whatever they left to another of
its users, such as a database's files, so it counts against the disk limit and is removed with the
attempt. While they run, a directory only such a user may read hides its bytes, as a locked one
does.

## Environment

- The step gets only the variables `environment` names, the ones `values` sets, and the three
  above.
- `PATH` is a variable like any other. Without it, a step finds commands only on the system's
  default search path.
- A name in `values` cannot also be in `environment`, and cannot be `MEDRENGARD_IN` or
  `MEDRENGARD_OUT`.
- With `environment: "all"`, a value still sets its variable over the engine's.

## Defaults

`@medrengard/core/defaults/access.ts` exports four accesses. Use one as it is, or spread it and
change a field. "The system" is `/usr`, `/etc`, `/opt`, `/bin`, `/sbin`, `/lib` and `/lib64`,
read-only, where they exist.

| Default      | For                            | Paths                                                                                                                                 | Network                     | Environment            |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------- |
| `contract`   | A command step                 | The system, and an `empty` `/tmp` of 256 MiB.                                                                                         | `false`                     | `PATH`                 |
| `node`       | A step's program in TypeScript | `contract`'s, the `node` executable that runs the engine, the package's `step` directory and its `package.json`.                      | `false`                     | `PATH`                 |
| `claudeCode` | The Claude Code adapter        | The system, `/tmp`, an `empty` home of 256 MiB, Node and npm, the package's `step` and `adapters` directories, `~/.local/bin/claude`. | Only the broker `anthropic` | `PATH`, `HOME`, `LANG` |
| `codex`      | The Codex adapter              | As `claudeCode`, with Codex's npm package (`@openai/codex`, beside npm's, when it is installed) in place of `claude`.                 | Only the broker `openai`    | `PATH`, `HOME`, `LANG` |

All four have `workspace: "write"` and `sandboxes: false`.

- `contract` has no home and no `HOME`. Point a program that needs a home or a cache, such as `npm`,
  at `/tmp`.
- `node` does not grant your program or your factory's `node_modules`. Add both. See
  [the step contract](step-contract.md).
- "Node and npm" is Node's `bin` directory and npm's package, never other global packages. When npm
  is not beside Node, it is the `node` executable alone.
- `claudeCode` and `codex` have an empty home, so none of your own settings, skills, hooks or MCP
  servers loads. A path under the home, such as a repository, stays invisible until you add it.
- `claudeCode` and `codex` set `values` to the Git identity `Medrengard <medrengard@localhost>`.
- The broker `anthropic` reads the subscription token from `~/.config/medrengard/claude-token`. The
  broker `openai` reads Medrengard's Codex login from `~/.config/medrengard/codex`. Both read it
  outside the sandbox, and each is the step's only way to its model. See [agents](agents.md).

`gitIdentity(name, email)` gives the `values` that make Git author and commit as that identity.

```ts
import { claudeCode, contract, gitIdentity } from "@medrengard/core/defaults/access.ts";
import type { Access } from "@medrengard/core/src/definition.ts";

// A command step that clones your repository into its empty workspace.
export const cloning: Access = {
  ...contract,
  paths: [...contract.paths, { path: "/home/owner/dev/app", mode: "read" }],
};

// An agent that commits as you, runs a browser, and reaches npm and GitHub.
export const implementing: Access = {
  ...claudeCode,
  values: gitIdentity("Owner", "owner@example.com"),
  sandboxes: true,
  network: { ...claudeCode.network, hosts: ["registry.npmjs.org", "github.com"] },
};
```

## Reaching only some hosts

`network: { hosts: [...] }` lets a step reach the hosts it lists and nothing else. Use it when a
step needs a registry or a forge but not the whole network. A host the step may reach is a way out
for whatever the step can read.

| Entry            | Reaches                                        |
| ---------------- | ---------------------------------------------- |
| `example.com`    | That host on port 443.                         |
| `example.com:22` | That host on that port.                        |
| `*.example.com`  | Any subdomain of it, not `example.com` itself. |
| `*`              | Any public host on port 443.                   |

How it works:

- The step has loopback only. The engine runs a proxy outside the sandbox, and a forwarder inside
  the sandbox relays a loopback port to it.
- `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY` and `http_proxy` name that port, as
  `http://127.0.0.1:<port>`.
- The proxy tunnels a `CONNECT` to a listed host and refuses everything else with `403`. So HTTPS
  gets through, and plain HTTP does not.
- `curl`, `git`, `npm`, `pip` and `claude` follow the proxy variables. A program that does not has
  no network at all.
- A host reached only by `*` is looked up by the proxy, outside the sandbox, and reached at the
  address found there. The proxy refuses it when any address it answers with is this machine's,
  a private network's or link-local, and refuses an address given in place of a name: so `*`
  reaches the public web and nothing beside the engine. A host listed by name is reached as
  before, wherever it is.
- The engine notes each target refused, once:
  `Step implement was refused network access to pastebin.com:443.`

`*` is a way out, to anywhere, for everything the step can read: its workspace, its inputs and
whatever its paths grant. Give it only to a step that holds nothing it must not lose, and whose
brokers can do no harm when asked to by a page the step read.

Rules:

- The list holds at least one host or one broker. For no network, write `network: false`.
- Matching ignores case.
- The paths cannot grant `/` itself: that leaves no place for the forwarder, which goes at
  `/network`.
- [Workspace preparation](workflows.md) runs inside the step, so it reaches the same hosts.
- A kind's verifier or materialiser has all of the network or none: `true` or `false`. See
  [kinds](kinds.md).

## Brokers

A broker is a program the engine runs outside the sandbox while an attempt runs. It holds a
credential and adds it to what it forwards, so the credential never enters the sandbox. What the
step runs can use the credential through the broker, but never read it. Use one when a step's
program needs a credential, as a harness does to reach its model.

Name each broker and its program in the step's network:

```ts
import { contract } from "@medrengard/core/defaults/access.ts";
import type { Access } from "@medrengard/core/src/definition.ts";

export const brokered: Access = {
  ...contract,
  network: {
    hosts: [],
    brokers: { forge: [process.execPath, "/path/to/factory/brokers/forge.ts"] },
  },
};
```

What the engine does, for each broker, before the step's program starts:

1. Starts the program outside the sandbox, with the engine's environment and `MEDRENGARD_SOCKET`,
   the path of a Unix socket for it to listen on. It runs in a systemd scope within the step's
   `memory` and `processes` limits.
2. Waits up to 10 s for it to listen.
3. Binds the socket into the sandbox. The forwarder relays a loopback port to it and names the port
   in `MEDRENGARD_BROKER_<NAME>`, the name in capitals: `MEDRENGARD_BROKER_FORGE=http://127.0.0.1:41231`.

When the attempt ends, the engine sends the broker `SIGTERM`, then `SIGKILL` after 5 s.

Rules:

- A broker's name is lowercase letters and digits, starting with a letter.
- A broker that ends, or does not listen in time, escalates the attempt with cause `broker` before
  the step's program starts. The reason ends with the start of the broker's stderr, at most 1024
  characters:
  `Step plan's broker anthropic ended before it listened: Cannot read the token file: ENOENT…`.
- The proxy variables are set too, and the proxy refuses any host the access does not list,
  loopback included. A program that follows them must reach its broker directly, as with
  `NO_PROXY=127.0.0.1`.

The adapters' brokers work this way: the harness speaks plain HTTP to the broker with the
placeholder credential `medrengard-broker` as its bearer token. The broker refuses any request
without the placeholder, puts the real credential in its place, and makes the TLS connection
upstream. Each vendor's headers, paths and token refresh are its broker's.
