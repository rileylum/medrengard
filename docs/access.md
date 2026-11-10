# Access

What a step's process may read, write and reach, the defaults to start from, and how a credential stays outside the sandbox.

Every command and agent step runs in bubblewrap under its `access`:

```ts
import type { Access } from "@medrengard/core/src/definition.ts";

const access: Access = {
  // In order of depth; on the same path, read wins. A path not listed is invisible.
  paths: [
    { path: "/usr", mode: "read" },
    { path: "/home/owner/dev/app", mode: "read" },
    // A fresh directory on disk, in the attempt's own area, which the step's disk limit bounds.
    { path: "/var/cache/build", mode: "scratch" },
    // A fresh directory of at most 256 MiB over whatever is there, held in memory.
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

`@medrengard/core/defaults/access.ts` holds four values to use as they are or to change one dial of, and
`gitIdentity(name, email)`, the `values` that make Git author and commit as that identity.
"The system" is `/usr`, `/etc`, `/opt`, `/bin`, `/sbin`, `/lib` and `/lib64` to read, where they
exist.

- `contract`: the system, a fresh `/tmp` of 256 MiB and `PATH`, without `sandboxes`. No home, no network and no `HOME`, so a
  program that needs a home or a cache, such as `npm`, must be pointed at `/tmp`.
- `node`: `contract`, with the Node that runs the engine and the step contract's module, for a
  step's program written in TypeScript. See [the step contract](step-contract.md#the-step-contract).
- `claudeCode`: what the Claude Code adapter needs: the system, a fresh `/tmp`, an empty home of
  256 MiB, Node and npm (Node's `bin` directory and npm's package, or the `node` executable
  alone when npm is not beside it; never other global packages), the `adapters` directory, the
  `claude` executable, no host of its own and the broker `anthropic`, the adapter's, which holds
  the subscription token from `~/.config/medrengard/claude-token` outside the sandbox and is the
  only way to the model API, `PATH`, `HOME` and `LANG`, the
  Git identity `Medrengard <medrengard@localhost>` as `values`, and no `sandboxes`, so what the
  agent runs cannot make namespaces. A step whose agent runs tools that sandbox themselves, such as
  bubblewrap, Codex or Chromium, grants them: `{ ...claudeCode, sandboxes: true }`. A namespace it
  makes still sees nothing the step's access hides and writes nothing it made read-only. Its home is empty, so the owner's settings, skills, hooks
  and MCP servers never load. A path under the home, such as a repository,
  stays invisible until you add it: the deeper entry wins.
- `codex`: what the Codex adapter needs: the system, a fresh `/tmp`, an empty home of 256 MiB,
  Node and npm as for `claudeCode`, the `adapters` directory, Codex's npm package
  (`@openai/codex`, beside npm's), no host of its own and the broker `openai`, the adapter's, which
  holds Medrengard's Codex login outside the sandbox, `PATH`, `HOME` and `LANG`, the same Git
  identity, and no `sandboxes`: Codex runs with no sandbox of its own, the step's being its
  boundary.

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
