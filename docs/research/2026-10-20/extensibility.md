# Extensibility: what well-regarded extensible software does, and what the factory should borrow

Slug: `extensibility`. Base: main at `a3c74ff`. Read only; probes ran in a detached worktree, now removed.

## Short answer

The factory's row-10 extension story is already sound where it matters most. Workflows are checked data. Extensions run out of process in the sandbox. Grants come only from the owner's layers. Hashes bind what ran. Observers act only through the owner's commands. Few of the systems studied isolate extensions this well: Pi, VS Code, Emacs and Neovim's Lua plugins all run extensions in-process with full user rights.

The gaps are in four places:

- **Preflight and health.** There is no `doctor` command. Check commands are only resolved after a paid developer run.
- **Lazy resolution.** One broken personal runtime entry blocks every command, including `cancel`.
- **Protocol versioning.** None of the three JSON contracts carries a version.
- **Workflow loading.** A repository workflow is loaded by executing it.

## Ranked findings

### 1. Resolve every check command before the paid developer run (bug-class gap)

`run()` already checks, before `develop`, that the sandbox starts, that file arguments have a folder and that grants are given (`src/run.ts:52-58`). It does not check that each command's program exists and is reachable inside the sandbox. That check happens only in `runCheck` (`src/verify.ts:383-388`), after the developer run.

**Failure scenario.** A job sets `checks: [{ name: 'test', command: ['npm', 'test'] }]`, and `npm` lives under `~/.nvm` or `~/.local`, which is not in `sandbox.read`. The owner pays for a full developer run. Then VERIFYING records `MISSING` ("resolves to …, outside the sandbox; add its directory to sandbox.read"), and the cycle escalates. The same applies to a `run` command on a custom command stage.

**Fix.** Before `develop`, check every command in `job.checks` and every `run` entry whose argv[0] has no slash. Use the same `executables` + `reachable` pair `runCheck` uses, with the policy's static roots. A slash path names a file in the candidate and cannot be checked before it exists, so skip it.

**Prior art.** Neovim `:checkhealth`. Terraform `init` validates providers before `plan`. VS Code refuses activation on `engines` mismatch at load, not at use.

- **Evidence:** `src/run.ts:51-58`; `src/verify.ts:378-389`; `src/sandbox.ts:135-143`.
- **Impact** 3, **Effort** S, **Confidence** high.
- **Implementable now?** Yes. Same pattern as the existing preflights, test-first with a fake adapter that counts calls.
- **Rows:** 11 (`resume` should run the same preflight) and 13 (pools multiply the waste).

### 2. Build runtimes lazily: one broken personal runtime blocks every job, `accept` and `cancel`

`runtimes()` builds an `extensionSpec` for every entry in `runtimes`, and `extensionSpec` reads and hashes the module at once (`src/runtime/registry.ts:23-34`, `src/runtime/cli-adapter.ts:271`). `loadConfig` calls it for every job (`src/config.ts:224`). So a personal-layer entry for a runtime the job never uses, whose file was moved, refuses everything. That includes `accept` and `cancel`, which go through `decisionConfig` → `loadConfig`. The error is a bare `ENOENT` that does not name `runtimes.<name>`.

**Reproduced** (worktree at `a3c74ff`):

- Personal `config.json`: `{ "runtimes": { "old": { "module": "./gone.ts" } } }`.
- Job file: `runtime` set to `claude` for every role.
- Both `node src/main.ts job.json` and `node src/main.ts cancel job.json` print `ENOENT: no such file or directory, open '…/software_factory/gone.ts'` and exit 2.

A-075 says "the module is hashed once, when its adapter is built". Hashing when `adaptersFor` selects the runtime matches that wording better than the current code does.

**Fix:**

- Keep the existence check and hash for runtimes a role selects, inside `adaptersFor`.
- Leave `reads()` as is: it needs only `dirname(module)`, not the bytes, so the grant check stays conservative.
- Name the key in the error message.
- Possibly skip the registry entirely for `accept`, `cancel` and `events`, which spawn nothing.

**Prior art.** lazy.nvim and VS Code activation events load a plugin only when something needs it, so a broken unused plugin costs nothing. Neovim's own guidance is to keep `plugin/` light and defer to `lua/`.

- **Evidence:** the reproduction above; `src/main.ts:46-58` (`decisionConfig`).
- **Impact** 2–3, **Effort** S, **Confidence** high.
- **Implementable now?** Yes.
- **Rows:** 11. Recovery must never be blocked by unrelated configuration; `cancel` is today's only way out of a stranded cycle.

### 3. A `doctor` command, modeled on `:checkhealth`

Every probe exists already, but each runs only at the point of use:

- `checkScopes` runs when an adapter is built (`cli-adapter.ts:144`).
- `checkBwrap` runs from `run` (`sandbox.ts:154`).
- Runtime binaries are found only inside `start` (`cli-adapter.ts:85`).
- Layer errors appear only from `loadConfig`.

**Proposal.** `node src/main.ts doctor <job.json>` prints one section per subsystem, with `ok`, `warn` or `error` lines, and a piece of advice on each `warn` and `error`. That is Neovim's `vim.health.start/ok/warn/error(msg, advice)` shape. The sections:

- Each configuration layer: found or not, and which keys it set. This gives the four layers provenance, like `git config --show-origin` or Neovim's `:verbose set`. Today `rooted()` throws provenance away on merge (`config.ts:84`).
- Workflow: `checkWorkflow` and hash.
- Per role: runtime and binary resolution, and the extension module's hash.
- systemd scope probe.
- bwrap probe.
- Every check command's resolution (finding 1).
- Each grant: refused or accepted, by name only, never the value.
- The store: exists, positions present.

Exit non-zero on any `error`. It must spawn no `claude` or `pi`; resolving the binary path is enough.

A per-extension health hook (Neovim's `lua/<plugin>/health.lua` with `check()`) needs a protocol message, so it waits for finding 4.

- **Evidence:** the files above; https://neovim.io/doc/user/health/ (the module path convention, `vim.health` functions, advice argument).
- **Impact** 3, **Effort** M, **Confidence** high.
- **Implementable now?** Yes, as a core-only `doctor`. The only owner question is the command's name and output format, a light Fast-route question. Per `HANDOFF.md`, a new `main.ts` command also needs a line in the guide (`learn/start.html#use`).
- **Rows:** 11 (doctor before resume), 12 (checks for `gh` or a token file by name), 13 (pools: check a machine before scheduling on it).

### 4. Version the three extension contracts, with a handshake

None of the JSON contracts says which version of itself it is:

- `RunRequest` on a runtime extension's stdin (`cli-adapter.ts:277`).
- `request.json` for command stages (`src/kits/request.ts`).
- `Line` on the observation stream (`src/stream.ts:9`).

`SHAPE` tolerates extra fields "so an older controller can read newer logs" (`lifecycle.ts:151`), but an extension cannot tell which controller it is talking to.

**How others do it:**

- **Terraform / go-plugin.** The plugin prints `CORE|APP-PROTOCOL-VERSION|network|addr|grpc` as its first stdout line. The host refuses an unknown version with a human-readable message. A magic-cookie environment variable stops a plugin being run by hand.
- **MCP.** The `initialize` call carries `protocolVersion`, and the side that does not support it disconnects.
- **LSP.** `initialize` exchanges capability objects.
- **Neovim.** `api_level`, with a written contract: nothing removed or changed incompatibly at a level; deprecated functions stay.

**Proposal, the smallest version.** Add `protocol: 1` to all three records. Allow an optional `protocol` on `RunOutcome`. If an extension answers with a protocol the controller does not know, record a failed run whose reason names both versions. Write the rule into the spec: additive fields keep the level, and any removal or meaning change bumps it. `doctor` and a `version` command print the levels. Each kit asserts the field.

This matters before row 11. A cycle opened under one factory version may be resumed by a later one, and an extension must be able to tell.

- **Evidence:** the files above; https://github.com/hashicorp/go-plugin/blob/main/docs/internals.md; https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle; https://neovim.io/doc/user/api.html (api-contract).
- **Impact** 3, **Effort** S–M, **Confidence** high on the gap, medium on the exact shape.
- **Implementable now?** Mostly. Adding the field is additive. The compatibility rule is a contract change, so the owner should approve its wording (one question).
- **Rows:** 11, 12 (a tracker observer pins the stream version), 13.

### 5. Let a workflow be JSON, and decide whether a repository workflow must be

A workflow is "plain data, so it can be checked and hashed" (`lifecycle.ts:52`; A-056), and the store already keeps it as JSON (`store.ts:140`, `definition`). Yet `loadWorkflow` gets it by `import()`, which runs the module's code in the controller (`config.ts:268`).

For a repository workflow this is accepted risk A-078: it runs unsandboxed and, per A-085, could read a grant file at import time. The accepted-risks row names its own reopen condition: "a workflow can be loaded as data".

**How others do it.** VS Code contribution points and `activationEvents` are static JSON in `package.json`, so the editor knows what an extension adds without running it. Workspace Trust then gates code. Git refuses to clone hooks at all. Terraform keeps configuration as HCL data and puts code in providers.

**Proposal:**

- **(a)** `loadWorkflow` accepts a `.json` file: `JSON.parse`, then `checkWorkflow`. This is additive; TypeScript workflows keep working.
- **(b)** Owner decision: a repository-layer workflow must be `.json`. That closes A-078. The alternative is to evaluate a TypeScript workflow in a child `node` under bwrap, with no network and no writes, printing JSON. That is effort M and keeps TypeScript authoring.

`{ file }` arguments are already plain objects, so nothing is lost in JSON.

- **Evidence:** `src/config.ts:146-155, 265-273`; `docs/work/accepted-risks.md` (A-078 row); https://code.visualstudio.com/api/extension-guides/workspace-trust; https://code.visualstudio.com/api/references/activation-events; https://git-scm.com/docs/githooks.
- **Impact** 4 (closes an accepted security risk), **Effort** S for (a), M for the sandboxed-eval variant, **Confidence** high.
- **Implementable now?** (a) yes. (b) needs the owner to reopen A-078 and choose between JSON-only and sandboxed evaluation.
- **Rows:** 12 (repositories the owner does not control become likelier once GitHub issues drive runs) and 13.

### 6. Record the runtime CLI's version, and the factory's own, on each run

A-054's guarantee is that "every run records the versions of the workflow, prompts and extensions it used". `RunVersions` records `runtime` (a name) and `moduleHash`, but `moduleHash` covers only extension runtimes (`lifecycle.ts:102-107`). A built-in runtime is recorded as `claude` or `pi` whatever binary ran. When pi moves from 1.1.0 to 1.2.0, the log cannot show it, and the improvement loop (row 13) cannot separate a model or harness change from a prompt change. The controller's own commit and Node's version are not recorded either.

**How others do it.** Terraform's `.terraform.lock.hcl` records provider versions and hashes. Neovim's lazy.nvim keeps `lazy-lock.json`. Temporal workers carry a build ID, so history shows which code ran each step.

**Proposal:**

- Add `binary: { path, sha256 }` to `RunVersions`, hashed once per adapter build and cached by path, size and mtime.
- Record `node` and `factory` (the factory's `git rev-parse HEAD`) on the open row.

Hashing the binary avoids running `claude --version`, which the tests must not do.

- **Evidence:** `src/lifecycle.ts:102-107`; `src/runtime/cli-adapter.ts:57-63` (`hostReads` already resolves the real binary); `docs/decisions.md` A-054.
- **Impact** 3, **Effort** S–M, **Confidence** high on the gap. Hashing a large native binary (claude) is a guess of about 100–300 ms, so cache it.
- **Implementable now?** Needs one owner choice: binary hash or `--version` text, and whether the open row gains fields. The rest is mechanical (four places per `HANDOFF.md`'s new-field lesson).
- **Rows:** 13 (improvement loop, release tracking) and 11 (resume should warn when the runtime binary changed mid-cycle).

### 7. A capability manifest for extension runtimes

A command stage declares its capabilities as data: `network` and `grants`. An extension runtime declares nothing. It always gets the network (`cli-adapter.ts:96`, `network: true`) and a read-only bind of its module's whole folder (`cli-adapter.ts:279`). A runtime that only wraps a local model, or a deterministic test double, cannot opt out.

**How others do it.** Deno's `--allow-net=host`. VS Code's `capabilities.untrustedWorkspaces`. Claude Code plugin manifests declare hooks and servers. Extism host functions grant capabilities one by one.

**Proposal.** `runtimes.<name>: { module, network?: boolean }`. Keep today's default (`true`) to stay compatible, or flip it. Flipping it is the owner's decision.

- **Evidence:** the lines above; https://docs.deno.com/runtime/fundamentals/security/.
- **Impact** 2, **Effort** S, **Confidence** high.
- **Implementable now?** Only with the default kept at `true`. A default of `false` needs the owner.
- **Rows:** 13.

### 8. Host-provided helpers inside the sandbox (easier extensions)

A command's file argument and a runtime module run "as one file with nothing beside it". So `readRequest` is copied by hand, not imported (`src/kits/request.ts:3-4`; `cli-adapter.ts:267-268`, "must be bundled into one file"). There is no `serve()` helper for runtimes that reads `RunRequest` from stdin and writes one `RunOutcome`.

**How others do it.** Pi supplies its own packages to every extension through virtual modules and asks authors to declare them as `peerDependencies "*"` (pi `docs/packages.md`, "Declare dependencies"; `src/core/extensions/virtual-modules.ts`). MCP and Extism ship a small SDK (PDK) per language.

**Proposal.** Bind `src/kits/` read-only at a fixed path inside each command or runtime sandbox, for example `/sf/kits`. Extensions then `import { readRequest, serve } from '/sf/kits/request.ts'`. Add `serve()`. Version the path with the protocol from finding 4.

- **Evidence:** as cited.
- **Impact** 2, **Effort** S–M, **Confidence** medium.
- **Implementable now?** No. The owner must accept a fixed in-sandbox path as part of the stable contract.
- **Rows:** 12 (a merge or PR stage written as a command) and 13.

## Considered and not recommended

- **Push hooks or autocommands that the controller starts** (Neovim autocmds, Emacs hooks, Git hooks, Claude Code hooks, Pi's `pi.on`). D-024 chose pull: the controller does not start observers. In the factory, the blocking or veto kind of hook is already a command stage, and the notify kind is an observer. Pi itself separates the two: `agent_before_settle` is actionable, `agent_settled` is notification-only. Row 12's tracker sync should be built as an observer through `observe()` (`src/kits/observe.ts`), which proves the seam. One small, buildable gain: `events --type <t>` and `--stage <s>` filters, so a Discord-style notifier does not filter by hand (like autocommand patterns). Impact 1.
- **WASM / Extism in-process plugins.** They would need a dependency and give little over bwrap processes.
- **Pinned hashes for extension modules** (Terraform-lock style). Owner-layer modules are trusted, and repository `{ file }` arguments are already pinned by the base SHA. Low value.
- **msgpack-RPC long-lived plugins** (Neovim remote plugins, Pi `--mode rpc`). The one-process-per-run model makes cancel, deadline and evidence binding simple. A long-lived host would undo that.

## What the factory already does as well as or better than the prior art

- **Out-of-process extensions in a sandbox.** Pi's own docs say extensions "run inside the Pi process with the same operating-system permissions" (`docs/extensions.md`, `docs/security.md`). VS Code runs all extensions in one shared host process.
- **Layered configuration with a repository allow list read at the base SHA** (`config.ts:110-114`). This is stronger than Pi's project trust, which its docs call "not a complete startup boundary".
- **Contract test kits for each seam** (`src/kits/`). Comparable to the conformance suites of LSP and MCP.
- **The workflow definition recorded on the open row and verified by hash on replay** (`stream.ts:27-32`). This is close to Temporal's history plus its versioning rules.

## Pi v1.1.0 notes (from the cloned tag)

- **Extensions:** TypeScript loaded in-process through jiti. A default-export factory receives `ExtensionAPI` and registers tools, commands, flags, providers, MCP servers and handlers through `pi.on(event, handler)`.
- **Events:** about 45 typed events in `src/core/extensions/types.ts`. Some notify, some transform, some cancel (`tool_call` can block; `user_bash` can take over).
- **Handler order and errors:** handlers run in load order. Errors are reported and execution continues. A failing `tool_call` handler blocks the tool, failing closed.
- **No sandbox and no API-version handshake for extensions.** Compatibility comes from host-provided virtual modules, including a `pi-ai/compat` shim (`loader.ts:91-113`). Packages are pinned by npm version or git ref.
- **Project trust** gates project-local `.pi/` resources. `--no-approve` skips them, which the factory already passes (`cli-adapter.ts:301, 323`).
- **RPC mode** is JSONL over stdin and stdout. Its documentation names the factory's own past bug class: Node `readline` splits on U+2028 and U+2029. Its session header carries `version: 3`.

## External sources

- https://neovim.io/doc/user/health/
- https://neovim.io/doc/user/api.html
- https://neovim.io/doc/user/remote_plugin.html
- https://lazy.folke.io/spec/lazy_loading
- https://code.visualstudio.com/api/references/activation-events
- https://code.visualstudio.com/api/extension-guides/workspace-trust
- https://code.visualstudio.com/api/advanced-topics/extension-host
- https://github.com/hashicorp/go-plugin/blob/main/docs/internals.md
- https://developer.hashicorp.com/terraform/language/files/dependency-lock
- https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
- https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#initialize
- https://docs.deno.com/runtime/fundamentals/security/
- https://git-scm.com/docs/githooks
- https://docs.temporal.io/develop/typescript/versioning
- Pi at tag `v1.1.0`, `packages/coding-agent/docs/{extensions,security,packages,rpc}.md` and `src/core/extensions/`.

Only the Neovim health page and the go-plugin internals were fetched this session. The other links are cited from prior knowledge and were not re-read.
