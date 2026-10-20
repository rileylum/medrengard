# Extensibility and configuration as a design: second pass

Slug: `extend-config`. Base: main at `42f174e`. Read only. Probes ran in a detached worktree, since removed. Four helper agents gathered primary sources (VS Code, Neovim, Zed, Emacs; Claude Code, Codex, opencode, Goose, MCP, LSP, ACP; Terraform, Kubernetes, Backstage, Grafana, Deno, Node, Extism; ESLint, Babel, Vite, Git, Nix, CUE/Pkl/Nickel/Dhall, Cargo, Compose, secrets). I checked the claims that carry a proposal against the source myself: MCP versioning, direnv's allow hash and AWS `credential_process`. The cloned no-mistakes, symphony and pi repositories were read directly.

## 1. Short answer

- **Sound, keep it.** The safety foundations are right, and they are better than most of the prior art:
  - Extensions run out of process, sandboxed, and speak JSON.
  - Grants are named and come only from the owner's own config.
  - The repository layer is read at the base SHA through an allow list.
  - Each seam has a contract test kit.
  - What ran is bound by hashes.

  The first pass's verdict stands for the mechanisms one at a time.
- **Wrong, or missing.** There is no extension *model*. The factory has eight one-off mechanisms. Each has its own declaration site, protocol, trust rule and identity record. None has a manifest, a version, a shared validator or a way to be shared.
- **Validation is shallow.** Only top-level config keys are strict. A typo anywhere deeper is accepted silently: inside a workflow stage, inside `sandbox` or inside a runtime entry. I reproduced each one (§3.1). In a headless factory, a silent typo is a wrong paid run that looks normal.
- **Provenance is thrown away.** The merge discards which layer set each value (`src/config.ts:81-83`). The effective config a cycle ran under is not recorded, apart from the workflow.
- **Repository trust has no floor.**
  - A repository layer can replace the owner's personal `checks` and `workflow` wholesale. Its workflow can drop every review and the human stage.
  - Merged-branch trust (A-095) stops working once the factory runs repositories whose history the owner does not control. Row 12 makes that likely.
- **What to change first:**
  1. One schema-driven loader for everything the owner writes. It is strict at every depth, keeps provenance, and gives each key a merge rule and the layers allowed to set it.
  2. Record the effective config on the cycle.
  3. Trust a repository workflow by content hash, the direnv model.
  4. Make runtime entries data, with model, effort and arguments.
  5. Then a single extension manifest plus a lock file, which gives sharing, pinning and identity for every kind of extension in one move.
- **A-113's principle holds**, with one caveat: every extension point costs a schema, a kit and a `doctor` line. Add one only when a second real policy needs it.

## 2. What we have

### 2.1 Inventory of extension points

| # | Mechanism | Declared in | Protocol | Who may set it | Identity recorded | Kit | Version |
|---|---|---|---|---|---|---|---|
| 1 | Workflow (stages, transitions, budgets, one-line role text) | TS module exporting data, imported into the controller (`src/config.ts:283-290`); JSON soon (A-111) | plain data, `checkWorkflow` (`src/lifecycle.ts:218-280`) | personal, repository (at base, merged only, `config.ts:161-173`), job | name + SHA-256 of `JSON.stringify` on the open row (`src/store.ts:26-27, 144`) | none | none |
| 2 | Command stage `run` with `{ file }` arguments | workflow (`lifecycle.ts:33-50`) | argv, `SF_REQUEST` file, `outputDir`, exit code (`src/verify.ts:194-206`) | as the workflow | SHA-256 of each `{ file }` on `verification` (`lifecycle.ts:116-118`) | `commandKit` | none |
| 3 | Job `checks` | config | argv, exit code | personal, repository, job | check name only | via `commandKit` | none |
| 4 | Runtimes | `claude`, `pi` built in (`src/runtime/registry.ts:15-19`); extension `{ module }` (`:22-36`) | one `RunRequest` on stdin, one `RunOutcome` on stdout (`src/adapter.ts:6-26`, `src/runtime/cli-adapter.ts:265-285`) | personal, job | runtime name; `moduleHash` for extensions only (`lifecycle.ts:102-108`) | `runtimeKit` | none |
| 5 | Role → runtime map | `runtime` | — | personal, repository, job | on each outcome | — | — |
| 6 | Sandbox backends | `BACKENDS`, closed on purpose (`src/sandbox.ts:53-57`) | — | personal, job | not recorded | — | — |
| 7 | Grants | `grants: { variable, file }` (`config.ts:259-273`); a command stage asks | value in the spawn environment, never argv (`sandbox.ts:35`, `verify.ts:206-207`) | personal, job; a repository workflow may not ask (`config.ts:229-232`) | grant names on `verification` | via `commandKit` | — |
| 8 | Observers | the user's own process: `events` (`src/main.ts:83-109`), `observe()` (`src/kits/observe.ts:39-58`) | pulled JSON lines (`src/stream.ts:38-51`); act only through `accept`/`cancel --source` (`observe.ts:16-21`) | anyone who can read the store | a `source` label, which anyone can claim | `observerKit` | none |

Adjacent knobs that are *not* configurable today:
- The reviewer's instruction files: `opts.instructions ?? ['AGENTS.md']` (`src/review.ts:83`). `main.ts` never sets it.
- Isolation mode and the output byte cap (`cli-adapter.ts:38-57`).
- The CLI flags of `claude` and `pi`, which are hard-coded (`cli-adapter.ts:211-341`).
- The model: the job file's `model` key is accepted and ignored (`config.ts:116-118`).
- A deadline per stage: there is one `deadlineMs` for all of them.

### 2.2 What it does well

- **Isolation.** Every user extension runs out of process in bwrap. Command stages have the network off by default. Pi, VS Code ("the extension host has the same permissions as VS Code itself"), opencode, Emacs and Neovim's Lua plugins all run extensions in-process with full user rights. Zed is the one peer with a capability model, and its default grant is all-wildcard.
- **A repository allow list read at a commit** (`config.ts:107-118`, `150-159`). Git, Claude Code and Codex all reached this shape after CVEs:
  - Git: CVE-2022-24765 and its "protected configuration" list.
  - Claude Code: CVE-2025-59536 and CVE-2026-21852.
  - Codex: CVE-2025-61260.

  The factory had it from the start. Top-level keys are strict, and every error names the file and the key (`config.ts:139-147`; `tests/config.test.ts:88-97`).
- **Paths resolve against the file that set them** (`config.ts:80-99`). Babel, Cargo (`--config` paths are "relative to two levels up") and Compose (which added `include` to fix "the relative path problem") all learned this the hard way.
- **Grants.** A named, owner-given secret reaches one sandboxed stage, never argv, and is redacted from evidence. That is closer to systemd credentials and Deno than to any agent harness studied.
- **Hash binding.** The workflow definition is on the open row, `{ file }` hashes are on `verification`, and `moduleHash` is on outcomes.
- **Kits per seam.** Only LSP- and MCP-style conformance suites compare.
- **Pull for observers** (D-024). Kubernetes' KEP-3488 lists why out-of-process hooks on the critical path hurt: hosting, latency, and the forced choice between fail-open and fail-closed. Observers never sit on the critical path.

## 3. What we don't have

### 3.1 Validation below the top level (reproduced)

Probe on `42f174e`, through `checkWorkflow` and `loadConfig`:

- A default workflow with `VERIFYING.netwrok: true`, `VERIFYING.grnats: ['github']`, `STANDARD_REVIEW.budjet: 5`, `STANDARD_REVIEW.model: 'opus'` and a top-level `colour` → `checkWorkflow` returns `[]`.
- A personal file with `sandbox.reed: ['/opt/toolchain']`, `runtimes.local.netwrok: false`, `runtimes.local.model: 'x'` and `runtime.developr: 'claude'` → `loadConfig` accepts every one.
- A job with `deadlineMs: "900000"` is accepted at load. `checkDeadline` refuses a non-number later, without naming the layer.
- `model: "opus"` in the job file is accepted and ignored.

How each fails a real user:

- **`sandbox.reed`.** The owner adds a toolchain path with a typo. Preflight then says "add its directory to `sandbox.read`", which the owner believes they did.
- **`model: 'opus'` on a stage or a runtime.** This is exactly A-113's "stronger model for the last fix round". Nothing happens, and nothing says so.
- **`grnats`.** The grant stage runs without its token. Whether it fails loudly depends on the user's script.

Prior art agrees on strictness for files the owner writes:
- Claude Code plugins refuse unknown keys inside strict sub-objects. Its `-p` mode instead drops bad settings silently, and the docs tell users to run `claude doctor` afterwards. That is the failure mode to avoid, because the factory is always headless.
- Goose recipes refuse an unused parameter.
- no-mistakes decodes with `KnownFields(true)`.
- Kubernetes CRDs prune or refuse unknown fields.

### 3.2 Provenance and the effective config

- `rooted()` makes paths absolute and then forgets the layer (`config.ts:81-83`). Nothing can answer "which file set `runtime.developer`?" Git can (`git config list --show-origin --show-scope`), and so can Kubernetes server-side apply (`managedFields`).
- The open row records the workflow and the base, not the effective runtime map, sandbox, checks, deadline or grant names.
  - **Fails when:** the owner edits the personal file between a crash and `resume`. A-105 plans to hash the ticket and checks only. The runtime or sandbox can still change silently mid-cycle.
  - no-mistakes writes a full `command-config.ndjson` snapshot, with the trusted-config SHA and tool build, before each run.

### 3.3 A floor for the owner, and trust beyond "merged"

- **Precedence is personal < repository < job.** A repository's `checks` replace the owner's personal `checks` whole (A-078 Q3). A repository `workflow` replaces the personal one, and `checkWorkflow` passes a workflow with no review and no human stage (`docs/specs/core-lifecycle-v1.md`, "Workflows"). The factory never merges, so the direct harm is bounded. But:
  - An owner's personal secret-scan check silently stops running in any repository that commits `.factory/config.json` with `checks`.
  - Row 12's code-host sync and any auto-merge observer will read `ACCEPTED` as a signal.
- **Trust is "the base is on a branch or tag outside `sf/*`"** (A-095). That is right for the owner's own repositories. It means nothing for a repository the owner cloned from someone else, where every branch is "merged". A-078's own reopen condition names this case.
- Others draw the line by key, not by layer:
  - VS Code `restrictedConfigurations` and setting scopes.
  - Claude Code keys marked "User or managed"; "deny and ask rules apply right away", while allow rules wait for trust.
  - Codex ignores `model_provider`, `openai_base_url` and `notify` in project files even when the project is trusted.
  - no-mistakes accepts only additive machine-local commands ("never changes their strings or removes them").
  - Emacs uses a per-variable `safe-local-variable` predicate.

### 3.4 Runtime knobs

`RunRequest` is `{ runId, role, prompt, cwd }` (`src/adapter.ts:6-13`). An extension runtime that wraps Codex, opencode or a local model cannot learn:
- the model or effort wanted;
- whether the role writes;
- the deadline;
- the expected output shape;
- the protocol version.

The built-in specs cannot take a model or extra arguments at all.

**Fails when:** the owner wants Opus for reviews and Sonnet for the developer, or a stronger model on the last fix round (A-113 item 3). Today that needs a new extension runtime per model, each a hand-written wrapper.

no-mistakes solves this with data:
- `agent_config.<harness>.{model, effort}` is mapped to each CLI's flag.
- `agent_args_override` holds raw flags.
- `review_agents.{reviewer, fixer, fixer_after_round: {after_round}}` covers per-round profiles.
- All three are global-only, "because it decides which model runs with your credentials".

### 3.5 Extension points A-113 names, and others

| Missing point | User situation it fails in |
|---|---|
| **Dispatch / intake** (A-113 item 1) | Row 12: "start the next READY GitHub issue unless three cycles wait on me". Today a job file is the only intake, and nothing decides when. |
| **Observer verbs beyond accept/cancel** (A-113 item 2) | A stall watchdog sees no heartbeat and cannot stop one run. An observer cannot leave a note in the log ("Discord pinged at 14:02"), so its actions are invisible to replay and to the owner. |
| **Observer supervision and cursors** | The owner runs a Discord notifier. It dies at night; nothing restarts it, and it must store its own `after` seq or it replays the whole store. It runs unsandboxed as the owner, holding `accept` power. |
| **Model / effort / args per runtime** | See §3.4. |
| **Step types** | No agent stage can return structured data other than a commit or a verdict (A-109 asks for declared shapes). No stage waits on an outside event other than the human stage. Nothing composes sub-workflows. |
| **Instruction files and prompt material** | A repository whose conventions live in `CONTRIBUTING.md` and `docs/conventions.md` cannot give them to reviewers; only `AGENTS.md` is read (`review.ts:83`). |
| **Per-repository personal settings and profiles** | Row 12 makes the issue, not the job file, the unit: `sf run github:me/repo#42`. Per-repository runtime, sandbox paths and checks then have no home. Git solves this with `includeIf`, no-mistakes with `repository_overrides` keyed by remote URL, Cargo and Compose with profiles. |
| **Secret sources** | Tokens live in `pass`, `op` or `gh auth token`, not in a file. A grant needs a plaintext file on disk today. |
| **Extension identity for observers and checks** | `['npx', 'eslint']` records no ESLint version. An observer's `source` is a label anyone can claim. |
| **Sharing** | A colleague's "workflow with an acceptance-evidence stage" is a JSON file plus `{ file }` scripts plus a runtime module plus required grants. There is no package, no version, no pin, and no way to see what it will ask for before it runs. |

### 3.6 Is there a coherent model?

No. There is a coherent *set of principles*:
- out of process;
- sandboxed;
- JSON;
- claims, not state;
- a kit per seam.

It is applied through one-off mechanisms. Each kind of extension differs on every axis:

| | Command stage | Runtime | Observer |
|---|---|---|---|
| Declared in | workflow | config | not declared at all |
| Input | a file in `SF_REQUEST` | stdin | stream |
| Identity | hashes of `{ file }` arguments | module hash | a label |
| Capabilities | `network`, `grants` | none (network always on) | everything the owner has |
| Version | none | none | none |

What a unified model looks like, built from what the prior art converged on (§4):

- **Manifest** (one file per extension directory, e.g. `factory-extension.json`):
  - `name`, `version` and `protocol` (an integer major).
  - `provides`: runtimes, commands, workflows, observers, decisions; each with its entry file.
  - `needs`: network, grant names, read paths, programs.
  - `health`: an optional entry.

  Unknown keys are refused. Paths must stay inside the directory (Claude Code plugins).
- **Capabilities, two-sided.** The manifest declares; the owner's config grants. The controller enforces through bwrap policy. Default deny. That is Zed's design with Zed's mistake (a wildcard default) avoided.
- **Lifecycle.**
  - One process per call, no shared host. Neovim's maintainers call remote-plugin hosts "99% of the complexity" for little benefit, and VS Code needs Extension Bisect because faults in a shared host cannot be attributed.
  - Activation comes from what is declared (VS Code since 1.74), so a broken unused extension costs nothing. That generalises the lazy-runtime fix in A-102.
- **Versioning.**
  - `protocol: <int>` on every message. MCP's current revision (2026-07-28) dropped its `initialize` handshake: "every request declares the protocol version", and a server refuses with `UnsupportedProtocolVersionError` naming what it supports. That fits a one-process-per-call design better than a handshake.
  - Additions are capabilities, and an omitted capability means unsupported (ACP, LSP).
  - Keep old majors side by side (Zed's `since_vX` modules, Grafana's protocol policy).
- **Discovery and distribution.**
  - No registry. An extension is a git repository or a directory.
  - The owner pins it in a personal lock file: source, commit, and a content hash of the directory, Terraform `h1:`-style (a hash of the contents, not of an archive).
  - Updates are shown as a diff, including manifest capability changes, and accepted by the owner (`vim.pack`'s `:packupdate` review buffer).
  - GlassWorm (Open VSX, 2025-2026) attacked through automatic updates and through `extensionDependencies` that installed unrelated publishers' code. So nothing transitive is installed without the same review.

## 4. What others do

Verdicts: **adopt** (take as is), **adapt** (take the idea, change the form), **avoid**.

### Editors

- **VS Code.** Manifest, `engines.vscode`, activation events, contribution points, Workspace Trust and setting scopes. Sources: https://code.visualstudio.com/api/references/extension-manifest, https://code.visualstudio.com/api/references/activation-events, https://code.visualstudio.com/api/extension-guides/workspace-trust, https://code.visualstudio.com/docs/configure/settings.
  - **Adapt** setting scopes: each key says which layers may set it, which is the factory's allow list made per key.
  - **Adapt** `restrictedConfigurations`: in Restricted Mode only the user's value counts.
  - **Adopt** "activation derived from contributions": since 1.74, hand-kept trigger lists drifted from what extensions actually contributed.
  - **Avoid** the shared extension host. https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security says it "has the same permissions as VS Code itself".
  - **Avoid** auto-installing transitive `extensionPack`/`extensionDependencies`. The March 2026 GlassWorm wave used 72 such extensions (https://socket.dev/blog/open-vsx-transitive-glassworm-campaign).
- **Neovim.**
  - `:checkhealth` with `health.lua` returning `ok`/`warn(msg, advice)`/`error(msg, advice)` (https://neovim.io/doc/user/health/). **Adopt** for `doctor` and a per-extension `health` entry.
  - The API contract: maps gain fields and never lose them; an omitted `opts` equals `{}`; "deprecated functions will not be removed until Nvim 2.0" (https://neovim.io/doc/user/api/). **Adopt** as the protocol's compatibility rule.
  - Lock files: lazy.nvim's `lazy-lock.json` and 0.12's `vim.pack` with `nvim-pack-lock.json` and a review buffer for updates (https://neovim.io/doc/user/pack/). **Adopt.**
  - Remote plugins: issue #27949 calls the shared host and manifest "99% of the complexity". **Avoid** long-lived plugin hosts. This confirms one process per call.
- **Zed.** WASM extensions with `extension.toml` and two-sided capabilities: the manifest declares `process:exec`, `download_file` or `npm:install`, and the user's `granted_extension_capabilities` allows them (https://zed.dev/docs/extensions/capabilities). Old WIT API versions stay loadable side by side.
  - **Adapt** the two-sided capability check, but default to deny; Zed's default is all-wildcard.
  - **Adopt** side-by-side protocol versions.
  - **Avoid** WASM for now. Node 24 has no component runtime without npm tools (`jco`), and `node:wasi` is experimental, preview1 only, "do not rely on it to run untrusted code" (https://nodejs.org/docs/latest-v24.x/api/wasi.html).
- **ACP** (https://agentclientprotocol.com/protocol/initialization). JSON-RPC over stdio between an editor and a coding agent. It has an integer `protocolVersion`; omitted capabilities are unsupported; extension data goes in `_meta` and custom methods start with `_`. The client answers `session/request_permission` and may serve `fs/*` itself. Zed moved external agents from its own extensions to an ACP registry.
  - **Adapt** later as a runtime kind. One ACP adapter could drive any ACP agent, and `session/update` notifications give the heartbeats A-113 item 2 needs. `request_permission` would let the controller decide tool use, which fits "controller decides". This is a guess at value: I did not probe whether `claude` or `pi` speak ACP natively. no-mistakes drives ACP agents through an `acpx` bridge.
  - **Adopt** now the `_meta` and `_`-prefix rules for the factory's own protocol extensions.
- **Emacs.**
  - `defcustom :type` checks values only in the Customize UI; `setq` bypasses it, and Emacs 29's `setopt` only warns. **Avoid** "validate in one entry point only".
  - `.dir-locals.el` with `safe-local-variable` predicates and the `y/n/!/i/+` prompt. **Adapt** per-key safety predicates.
  - Emacs 30's `trusted-content` after CVE-2024-53920: Flymake ran code from opened files. The lesson: background processing of untrusted content is code execution.

### Agent harnesses and tools in the same domain

- **no-mistakes** (cloned, `docs/src/content/docs/reference/global-config.md`, `provider-plugin-protocol.md`). The closest prior art.
  - **Adopt** `agent_config` (model and effort mapped to each CLI's flags; a knob a harness cannot express is a config error, not silently dropped).
  - **Adopt** `review_agents` with `*_after_round` overlays.
  - **Adopt** the rule that model, args and plugin choice are global-only: "it decides which model runs with your credentials".
  - **Adapt** `repository_overrides` keyed by remote URL.
  - **Adopt** additive-only machine-local checks: a matching global block adds checks after the repository's and can never remove one.
  - **Adopt** a `command-config.ndjson` snapshot of the resolved config, the trusted-config SHA and the tool build per run.
  - **Adopt** the provider plugin protocol:
    - one process per operation, JSON on stdout;
    - a `status` handshake returning `protocol_version: 1` and capabilities that default to false;
    - "a skip" when the plugin cannot serve the repository, versus "fail closed" when it breaks the contract;
    - bodies passed in a 0600 file, never argv.
  - **Avoid** the size. no-mistakes' config package is about 5,800 non-test lines, `config.go` alone 4,056, against the factory's whole 4,019-line `src/`. That is the configuration complexity clock (http://mikehadlow.blogspot.com/2012/05/configuration-complexity-clock.html) in motion.
- **Claude Code** (https://code.claude.com/docs/en/settings, `/plugins-reference`, `/hooks`, `/mcp`).
  - Precedence runs managed > `--settings` > local > project > user.
  - Lists such as `permissions.allow` concatenate across files. Ordered lists are taken whole. Some keys are "stricter wins" from any layer, and some keys are "user or managed" only.
  - **Adopt** the per-key merge table, including a "stricter wins" class for security flags.
  - **Adopt** the plugin manifest discipline: only `name` is required; paths stay inside the root; `claude plugin validate --strict` exists; dependency installs run from a lockfile with `--ignore-scripts`.
  - **Avoid** `/status` showing which files loaded but "not which file supplied each key".
  - **Avoid** the `-p` behaviour: invalid settings are dropped silently, and "`claude -p` loads project-scoped servers without asking".
  - Check Point's CVE-2025-59536 and CVE-2026-21852 show "config files are executable".
- **Codex CLI** (https://learn.chatgpt.com/docs/config-file/config-reference).
  - `-c key=value` is parsed as TOML. Project `.codex/config.toml` is read only for trusted projects, and even then it may not set the provider, base URL or `notify`. `requirements.toml` holds constraints, not defaults, and "the most restrictive decision wins". Profiles live in separate files since 0.134.
  - **Adopt** `-c` as a recorded CLI layer.
  - **Adapt** "constraints, not defaults" as an owner floor (proposal 3).
  - CVE-2025-61260: a repository `.env` set `CODEX_HOME`. **Avoid** resolving any config home from the working tree. The factory already uses only absolute `HOME`/`XDG_CONFIG_HOME` (`config.ts:67-76`), which is good.
- **opencode** (https://opencode.ai/docs/config/). Eight merged layers, JSONC, `$schema`, `{env:VAR}` and `{file:path}`, in-process plugins auto-loaded from `.opencode/plugins/`.
  - **Adopt** `$schema` for editor completion.
  - **Adapt** `{file:}` as a secret reference.
  - **Avoid** these: an unset `{env:VAR}` becomes `""`; project plugins load with no trust gate; npm plugins are installed at startup.
- **Goose** (cloned at `repos/block_goose`, `guides/recipes/recipe-reference.md`). MCP-only extensions. Recipes are YAML or JSON with typed parameters, a `response.json_schema`, `retry.checks` and `sub_recipes`. Validation is strict: an unused parameter is an error, and a file parameter may not have a default "to prevent importing sensitive files". Secrets live in the keyring.
  - **Adapt** recipe parameters for shareable workflows: a workflow declares the grants, programs and parameters it needs, and the factory refuses a job that does not supply them.
- **pi v1.1.0** (`packages/coding-agent/docs/packages.md`, `settings.md`, `security.md`).
  - Packages come from npm, git or a path. Versioned specs are pinned, and updates "do not move a configured ref". A package is identified by name or repository URL, without the ref.
  - `defaultTools` takes `+name`/`-name` deltas.
  - Some settings "can only be set in agent-directory settings".
  - Project trust is decided by an extension (`project_trust` event), and pi says it "is not a complete startup boundary".
  - Config values may be `!command` or `$VAR` (`src/core/resolve-config-value.ts`).
  - **Adopt** git-or-path sources with pinned refs.
  - **Adapt** `+`/`-` list deltas: only for lists where adding is safe.
  - **Avoid** in-process extensions.
- **OpenAI Symphony** (`repos/openai_symphony/repo/SPEC.md` §5-6). `WORKFLOW.md` has YAML front matter and a strict Liquid prompt body ("unknown variables MUST fail rendering"), hot reload with "last known good", and per-tick dispatch preflight. "Environment variables do not globally override YAML values" (only explicit `$VAR`). "Unknown keys SHOULD be ignored for forward compatibility." It also runs repository-owned shell hooks.
  - **Adopt** the explicit-`$VAR`-only rule and the strict template rendering.
  - **Avoid** ignoring unknown keys in owner-written files, and running repository shell hooks unsandboxed.

### Protocols

- **MCP** (https://modelcontextprotocol.io/specification/versioning, revision 2026-07-28, read by me).
  - The protocol version goes in each request's `_meta`.
  - `UnsupportedProtocolVersionError` lists what the server supports.
  - `server/discover` is optional for the client.
  - Deprecated features stay at least 12 months.
  - **Adopt** the version on every message, with a refusal that lists both sides. This sharpens A-111's `protocol: 1`.
- **LSP 3.17.** No version handshake; "a missing property should be interpreted as an absence of the capability". **Adopt** "omitted means unsupported".
- **AWS `credential_process`** (https://docs.aws.amazon.com/cli/v1/userguide/cli-configure-sourcing-external.html, read by me). The owner names a program. It prints `{"Version": 1, …}` JSON on stdout and exits non-zero on error. The docs warn against writing secrets to stderr. **Adopt** as a grant source.

### Infrastructure plugin systems

- **Terraform.**
  - go-plugin's handshake line and magic cookie ("not a security measure, just a UX feature").
  - Protocol majors 5 and 6, plus translators between them.
  - The registry advertises `protocols` per release.
  - `.terraform.lock.hcl` records version and `h1:` content hashes. Constraints are recorded but "Terraform doesn't actually use this information to make installation decisions".
  - Provider-defined functions must be pure, and the framework withholds provider configuration and credentials from them.
  - Sources: https://developer.hashicorp.com/terraform/language/files/dependency-lock, https://developer.hashicorp.com/terraform/plugin/framework/functions/concepts.
  - Verdicts:
    - **Adopt** the content-hash lock.
    - **Adopt** "pure functions get no credentials" as the decision-extension class (proposal 7).
    - **Avoid** a registry and GPG signing until there is a second publisher.
    - **Avoid** "use a real language" escapes: CDKTF was archived 2025-12-10 for lack of "product-market fit at scale" (https://github.com/hashicorp/terraform-cdk).
- **Kubernetes.** Sources: https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/, KEP-3488, https://kubernetes.io/docs/reference/using-api/server-side-apply/.
  - Structural CRD schemas prune or refuse unknown fields, with CEL rules carrying `message` and `fieldPath`.
  - Served and storage versions with conversion. `status.storedVersions` tracks every version ever stored.
  - ValidatingAdmissionPolicy moved policy in-process because webhooks are "inherently less reliable".
  - Server-side apply records who set each field.
  - Verdicts:
    - **Adopt** strict structural schemas.
    - **Adopt** the stored-versions idea for workflow definitions kept forever on open rows (proposal 4).
    - **Adopt** field provenance (proposal 2).
    - **Adapt** "policy as checked data where possible, sandboxed process where not".
    - Brian Grant's design note warns that "parameterized templates tend to become complex" and that "configuration tooling should manipulate configuration data, not convert configuration to code". **Avoid** templating workflows.
- **Backstage** (https://backstage.io/docs/backend-system/architecture/extension-points). The old backend "grew very organically". The new one has named extension points (`createExtensionPoint({ id })`), modules that contribute to one plugin only, a config schema per package with `@visibility secret`, and `config:check`.
  - **Adopt** the named-extension-point registry idea: each A-113 point gets an ID, a schema and a kit.
  - **Adopt** `secret` visibility for grant-like keys, so `doctor` and provenance dumps never print them.
- **Grafana** (https://grafana.com/developers/plugin-tools/key-concepts/backend-plugins/plugin-protocol). `plugin.json` has `grafanaDependency` as a semver range. `MANIFEST.txt` signs a SHA-256 of every file. The protocol policy: "a new major version … support both … for some time".
  - **Adopt** the per-file hash manifest as the lock's content hash.
  - **Adopt** the protocol policy wording.
  - **Avoid** signing levels for now.
- **Deno and Node 24.**
  - Deno has scoped `--allow-*`, `--deny-*` overrides, and named permission sets in `deno.json`. Its own lessons: `--allow-run` is an escape hatch, and FFI bypasses everything.
  - Node 24's `--permission` is stable but has no network restriction. A helper reproduced `fetch` succeeding under `--permission` on the local Node v24.13.0, and `--allow-net` is a "bad option". The docs call the model a "seat belt" that "does not provide security guarantees in the presence of malicious code" (https://nodejs.org/docs/latest-v24.x/api/permissions.html).
  - **Adapt** Deno's named permission sets as the `needs` block.
  - **Avoid** Node `--permission` as a boundary. It could be an extra layer under `sandbox.backend: none`, but is not worth the complexity.
- **Extism** (https://extism.org/docs/concepts/manifest). Its manifest carries a `hash` per wasm source, `allowed_hosts` (an empty list allows none, null allows all), `allowed_paths`, `timeout_ms` and memory caps.
  - **Adopt** the manifest fields' shape: a hash per source, and an explicit allow list where empty means none.
  - **Avoid** the runtime itself (WASM; see Zed).

### Configuration lessons

- **ESLint flat config** (https://eslint.org/blog/2022/08/new-config-system-part-1/, part 2, 2025 follow-up).
  - The cascade plus `extends` was "a mess that we would spend years trying to fix". The config went to JS to reuse `import` resolution ("our biggest regrets … recreating the Node.js `require` resolution"), at the cost of a printable, cacheable config.
  - `extends` came back in 2025, explicit and local. "An object with only `ignores` means global" was a shape-dependent trap.
  - Verdicts: **avoid** cascades and shape-dependent meaning; **adapt** explicit `extends` only if workflows ever need composition. Confirms A-111 (JSON, printable).
- **Babel** (https://babeljs.io/docs/config-files). Config found through the working directory and package boundaries silently ignored files. **Avoid** cwd-relative discovery. The factory's `runsDir` in the job file still resolves against the cwd (`config.ts:87`). Keep that for compatibility, but print it in provenance.
- **Rollup, Vite, tapable.** Hooks have declared result rules: first, sequential, parallel; bail, waterfall. **Adopt** if hooks with several handlers ever appear: give each extension point a declared rule for combining results, never load order.
- **Git** (https://git-scm.com/docs/git-config).
  - Scopes, `includeIf` (`gitdir:`, `onbranch:`, `hasconfig:remote.*.url:`), `--show-origin --show-scope`.
  - "Protected configuration" for `safe.directory`.
  - The 2.45.1 hook hardening was reverted in 2.45.2 because it broke Git LFS: tightening late breaks users.
  - Verdicts: **adopt** `--show-origin`, the protected-key idea, and `includeIf hasconfig:remote` as the model for personal per-repository sections; **adopt** "start strict".
- **Nix modules** (nixpkgs `lib/types.nix`).
  - Each option type carries its merge rule: scalars conflict and name both files, lists concatenate, attribute sets merge by key.
  - Priorities (`mkDefault`, `mkForce`) and `mkIf` exist to dodge infinite recursion.
  - Verdicts: **adopt** a merge rule per declared key; **avoid** numeric priorities and self-referential config.
- **CUE, Pkl, Nickel, Dhall, Jsonnet.**
  - CUE: unification is commutative, and its authors say inheritance makes it "hard to track where values are coming from".
  - Pkl: `amends` can only fill existing properties of typed objects.
  - Nickel: conflicts error at both sites.
  - Dhall: imports are frozen by hash.
  - **Adapt**, without adopting any of these languages (zero dependencies):
    - "repository may only fill or tighten", in Pkl's and CUE's spirit;
    - content-hash pinning, in Dhall's.
  - **Avoid** a new config language. JSON stays the artifact; an owner may generate it with anything.
- **Cargo, Compose, kubeconfig.**
  - Cargo: `--config` > environment > files, with some keys not settable from the environment, and `inherits` for profiles. **Adopt** the `-c` layer; **adapt** profiles.
  - Compose: per-field merge rules needed `!reset` and `!override` escape hatches. **Avoid** per-field rules nobody can remember.
  - kubeconfig: first-wins, and it drops non-conflicting sub-keys. **Avoid**.
- **Secrets.**
  - systemd credentials (https://systemd.io/CREDENTIALS/): environment variables "are inherited down the process tree". Credentials are files in `$CREDENTIALS_DIRECTORY`, not passed to children. **Adapt** as an optional grant delivery mode.
  - 1Password `op://` references; sops. **Adopt** "config holds a reference, never the value; an unresolved reference fails loudly".
- **Twelve-factor** (https://12factor.net/config). Environment variables for config have no type, no nesting and no provenance, and they leak to children. **Avoid** a general environment overlay. Symphony and Cargo both limit it.

## 5. Ranked proposals

Effort: S (hours), M (days), L (a row), XL (several rows).

### 1. One declared schema for everything the owner writes

**What.**
- One table in code, `key → { type, merge, layers, path, secret, safe? }`. It covers config layers, workflows, runtime entries, and later manifests and the lock.
- The loader refuses unknown keys at every depth, with a "did you mean" suggestion. Errors name the file, the JSON pointer and the layer, for example `.factory/config.json at 1a2b…: /stages/VERIFYING/netwrok: unknown key; did you mean network?`.
- The same table generates a JSON Schema for `$schema` editor completion.
- Each value is type-checked at load, not at use: `deadlineMs` is checked in `config.ts`, not in `controller.ts`.

**Decision.**
- `checkWorkflow` becomes strict about keys.
- The merge rule moves from the global `NESTED` list (`config.ts:57`) to the table.
- A `$schema` key is allowed in every file.

**Cost.** M. Widens A-078 Q3 (the merge rule becomes per key; arrays still replace by default) and A-111 (JSON workflows get the strict loader).

**Buys.** No silent typos in a headless factory. A single place where a new key gets its type, merge rule and trust level. Provenance (proposal 2) and `doctor` read the same table.

**Impact** 4. **Confidence** high: the gaps are reproduced, and every system studied that runs headless learned this.

**A-113.** A capability: the core states what can be configured. Policy stays in the values.

### 2. Provenance, and the effective config on the cycle

**What.**
- The loader keeps `{ value, file, layer, pointer }` for each value.
- `node src/main.ts config <job.json> [--show-origin]` prints the effective config. `secret` keys are masked, and grant values are never printed.
- The open row records a canonical hash of the effective config: runtime map, sandbox, checks, deadline, grant names, extension identities. The full document goes beside the store.
- `resume` compares the hash (it subsumes A-105's ticket-and-checks hash) and names the keys and layers that changed.

**Decision.** Widens A-105 item 2 from "ticket and checks" to "the effective config". Adds a `config` command; `doctor` (A-111) reuses it.

**Cost.** M. One field on the open row.

**Buys.**
- An answer to "why did this run use pi?"
- A safe `resume`.
- The improvement loop can group runs by config.

**Impact** 4. **Confidence** high (git `--show-origin`, server-side apply, no-mistakes' snapshot).

**A-113.** A core capability: observability of config.

### 3. A floor for the owner, and repository trust by content hash

**What.**
- **Two-part rule.**
  - (a) Repository-layer keys that *replace* owner policy apply only when the owner has approved that exact content: `workflow`, `checks`, and `runtime` choice. This is direnv: the allow key is SHA-256(path + content), and an edit re-blocks (direnv `internal/cmd/rc.go`). The approval lives in the personal data directory: `sf trust <job.json>` shows the repository workflow and checks, and records `{ remote, path, sha256 }`. An unapproved change fails with a message saying what changed.
  - (b) A personal `require` block the repository cannot override: required checks that always run (additive only, as in no-mistakes), a human stage required, and a minimum budget per verdict role. `checkWorkflow` takes the floor and refuses a workflow below it.
- A-095's merged-branch check stays as a second gate.

**Decision.** Reopens A-078 Q1 and Q2 and widens A-095. Changes A-074's "the repository layer may set checks, the workflow and runtimes" into "may propose them; they apply once approved, and never below the owner's floor".

**Cost.** M.

**Buys.**
- The owner's personal checks survive any repository config.
- A cloned third-party repository cannot drop human acceptance.
- A-078's reopen condition ("repositories whose base the owner does not control") is met before row 12 makes it common.
- It replaces "merged by someone" with "approved by me".

**Impact** 4. **Confidence** medium-high: the mechanism is proven (direnv, mise, VS Code Workspace Trust), but the exact floor keys need owner choice.

**A-113.** Challenges it slightly. Here the *default* must be a hard floor the owner sets, not a policy a repository workflow may lower. The principle should say: "policy lives in workflows, but the owner's floor binds every workflow a repository supplies".

### 4. Canonical workflow hash and a format version

**What.**
- `workflowHash` hashes canonical JSON: sorted keys, RFC 8785-style, about 20 lines with no dependency. Probe: reordering the top-level keys of the default workflow changes its hash today.
- Workflows (and config, and manifests) carry `"format": 1`. The core keeps a checker per format and an upgrader to the current one.
- Stored definitions on open rows are replayed under their own format, which is Kubernetes' storage-version idea.

**Decision.** Widens A-056 (plain data) and A-112 item 6 (replay under the recorded workflow).

**Cost.** S for the hash. M for format upgraders when the first change lands. Named outcomes (A-074 Q8, parked) will be the first.

**Buys.** A JSON workflow reformatted by `jq -S` or an editor no longer becomes a "different workflow". Years-old open rows stay replayable after the format grows.

**Impact** 3. **Confidence** high.

**A-113.** Core capability.

### 5. Runtime entries become data: model, effort, arguments, per-role and per-round profiles

**What.**
- `runtimes.<name>` gains `{ base: 'claude' | 'pi' | <module>, model?, effort?, args?, network?, env? }`, so `opus-reviewer` is `{ base: 'claude', model: 'opus' }`.
- The built-in specs map `model` and `effort` to each CLI's flags. A knob a runtime cannot express is an error at load, not dropped (no-mistakes).
- `RunRequest` gains `protocol`, `model`, `effort`, `writes`, `deadlineMs` and `kind: develop | fix | review`, so extension runtimes can honour them.
- The repository layer may name a runtime per role, but may never define runtimes, models or arguments: "it decides which model runs with your credentials".
- The job file's ignored `model` key is removed or mapped.
- A workflow's "stronger model for the last fix" is two commit stages with two roles (A-113 item 3). A per-round overlay (no-mistakes `fixer_after_round`) is the alternative to weigh.

**Decision.** Widens A-074 Q7 and D-024's runtime protocol, A-112 item 4 (`network`) and A-113 item 3.

**Cost.** M.

**Buys.** Model choice per role without writing wrappers. Recorded `model` on each run, which A-111's run records want.

**Impact** 4. **Confidence** high.

**A-113.** A capability in the core (runtimes take knobs). The choice of model is policy in config.

### 6. One extension model: manifest, capabilities, identity, lock

**What.**
- **An extension is a directory or git repository** with `factory-extension.json`:
  - `name`, `version`, `protocol`;
  - `provides` (runtimes, commands, workflows, observers, decisions);
  - `needs` (network, grant names, programs, read paths);
  - `health`.
- **The owner's personal `extensions.lock.json`** records the source (path or git URL), the commit and a content hash (sorted file list + SHA-256, like Terraform `h1:` and Grafana `MANIFEST.txt`).
- **At load.** The controller verifies the hash and refuses any capability the manifest does not declare or the owner has not granted. Every event an extension influenced records `name@version#hash`.
- **Updates.** `sf ext update` fetches into a staging folder and prints a diff of the manifest and files, new capabilities first. The owner accepts. Nothing transitive is installed.
- **The workflow file** names extension components (`acme-evidence:screenshot`) as well as `{ file }`.
- **No registry.** Sharing is "here is my git URL"; pinning is the lock.

**Decision.** Unifies D-024's three shapes under one manifest without changing their protocols. Widens A-075 (module hash becomes extension hash), A-081 Q3 (`{ file }` hashes) and A-112 item 4 (`/sf/kits` becomes the in-sandbox SDK, versioned `/sf/kits/<protocol>/`).

**Cost.** L.

**Buys.** Distribution and sharing for workflows, runtimes and kits. One answer to "what ran" for all extension kinds. A place for capability review before a shared extension runs.

**Impact** 4. **Confidence** medium: the shape is well proven (Claude Code plugins, pi packages, Zed, lazy.nvim), but the timing is a judgement. It is worth doing before the first workflow is shared, not before.

**A-113.** This *is* "extension points in the core".

### 7. A decision extension shape, for dispatch and other policy

**What.**
- A fourth protocol beside step, runtime and observer: a pure function. One JSON request in, one JSON answer out, in bwrap with no network, no grants and no writes, and a short deadline. That is Terraform's provider-defined functions, which get no credentials.
- The controller records the request hash and the answer as an event, so replay never re-asks.
- First uses:
  - dispatch: given open cycles and candidate tickets, which may start (A-113 item 1; the default refuses while K cycles wait);
  - escalation routing;
  - model choice per round, if not done in config.
- Kubernetes' lesson applies: keep simple policy as checked data (the default dispatch rule is a number in config), and use a function only when data cannot express it.

**Decision.** Widens D-024 ("two shapes") to three.

**Cost.** M.

**Buys.** A-113's "the check for what and when a ticket becomes available should be extensible", with determinism and replay intact.

**Impact** 3. **Confidence** medium.

**A-113.** Exactly its intent.

### 8. Observers: more verbs, cursors, optional supervision

**What.**
- **New owner commands an observer may call:**
  - `stop-run <runId>` (A-113 item 2; `run_failed`, cause infra);
  - `note <text>`: an annotation event that changes no stage.
- **A store-kept cursor per observer name**: `events --consumer discord` resumes where it left off.
- **An optional `sf observe` supervisor** (a separate process, not the controller) runs observers declared in personal config. Each runs in bwrap with its declared network and grants, and is restarted with backoff.
- Pull stays.

**Decision.** Keeps D-024's pull and "the controller does not start observers". Adds a separate supervisor and two verbs.

**Cost.** M.

**Buys.** A watchdog and notifiers that survive the night, can be sandboxed, and leave traces in the log.

**Impact** 3. **Confidence** medium.

**A-113.** The watchdog becomes an extension, as the owner asked.

### 9. Personal per-repository sections and profiles

**What.**
- `repos: { "<remote URL or path glob>": { …personal keys } }`, matched like git's `includeIf hasconfig:remote.*.url`.
- Named `profiles` (`fast`, `deep`) chosen with `--profile`, each a personal-layer overlay.
- Both are recorded in provenance as their own layers.

**Decision.** Widens A-074's four layers to defaults < personal < personal repository match < profile < repository < job < `-c`, with the floor (proposal 3) applied after all of them. Needed before row 12, where an issue reference replaces the job file.

**Cost.** M.

**Buys.** No copy-pasted job files per repository. A home for row 12's per-repository settings.

**Impact** 3. **Confidence** medium (the need is row 12's; the shape follows git and no-mistakes).

### 10. Secret references and credential delivery

**What.**
- A grant may be `{ variable, file }` (today) or `{ variable, command: [argv] }`. A command runs on the host, as the owner, when the stage starts; it is AWS `credential_process` and pi's `!command`. It is allowed only in the personal and job layers, and a non-zero exit or empty output fails the stage before it runs.
- An optional `deliver: 'file'` binds the value read-only at `/run/sf/credentials/<name>` instead of the environment (systemd credentials).

**Decision.** Widens A-083 Q1.

**Cost.** S-M.

**Buys.** No plaintext token files. Fewer leaks through tools that dump the environment.

**Impact** 2-3. **Confidence** high.

### 11. A `-c key=value` layer; no general environment overlay

**What.** A one-off override on any command, recorded as its own layer in provenance (git `-c`, Cargo `--config`, Codex `-c`). No `SF_*` environment mapping, beyond `XDG_CONFIG_HOME` and `HOME`.

**Decision.** Confirms the current absence of environment overrides.

**Cost.** S.

**Impact** 2. **Confidence** high.

### 12. Protocol versions per message, with a written compatibility rule

**What.**
- `protocol: <int>` on every message the factory sends or reads: `RunRequest`, `RunOutcome`, `request.json`, stream lines, decision messages.
- The refusal names both sides, as MCP 2026-07-28 does.
- Additions are optional fields or capabilities; omitted means unsupported (ACP, LSP).
- Extension-specific data goes in `_meta`.
- Old majors are kept side by side for a stated period (Grafana, Zed).
- Readers of protocol messages ignore unknown fields. Readers of owner-written files refuse them (proposal 1). Write the asymmetry down.
- No handshake: one process per call makes a per-message version enough.

**Decision.** Refines A-111's `protocol: 1` and A-112 item 4.

**Cost.** S.

**Impact** 3. **Confidence** high.

### 13. `doctor` with extension health

A-111 already plans `doctor`. Add the `:checkhealth` shape (`ok`, `warn(msg, advice)`, `error(msg, advice)`), config origin (proposal 2), and an optional `health` entry per extension (proposal 6). **Impact** 3, **Effort** M, **Confidence** high.

### 14. JSONC for owner files

Comments in config and workflows: a tiny comment-stripper, with no dependency. Owners annotate why a check or budget exists. **Impact** 1-2, **Effort** S, **Confidence** medium (tsconfig, VS Code and opencode all accept JSONC).

### Considered and not recommended

- **WASM / Extism / the component model.** No zero-dependency runtime in Node 24, and `node:wasi` is not a sandbox.
- **Node `--permission` as a boundary.** It does not restrict network on Node 24 (reproduced by a helper), and its docs disclaim protection against malicious code.
- **In-process TS plugins** (pi, opencode, VS Code style).
- **A registry, signing, or auto-update.** GlassWorm shows auto-update is the attack path. A lock plus reviewed diffs is enough until there is a second publisher.
- **Templating or `extends` inside workflows.** If composition is needed, an owner generates JSON with any tool. The factory loads only the artifact.
- **A general `SF_*` environment overlay.**
- **ACP as the runtime protocol now.** Worth a probe later (§4), not a foundation change today.

## 6. Challenged and confirmed decisions

**Revisit:**

- **A-078 Q1 and Q2, A-074 ("the repository layer may set checks, the workflow and runtimes"), A-095.**
  - The allow list is right, but the precedence lets a repository *replace* owner policy. It removes personal checks and can drop reviews and human acceptance.
  - "Merged" is no trust signal for a foreign repository.
  - Move to approval by content hash plus an owner floor (proposal 3).
- **A-078 Q3 (arrays replace whole) and the `NESTED` list.** Keep replace as the default. Make the rule per key in a schema, and add "additive only" for owner-required checks.
- **A-056 (workflow as a TS module exporting data) and A-111 (JSON workflows).**
  - Go further than A-111: the controller loads only JSON for every layer, and TypeScript remains only as a generator the owner runs.
  - Hash canonical JSON, not key order.
  - Make `checkWorkflow` strict about unknown keys.
- **A-105 item 2 (hash the ticket and checks).** Widen it to the whole effective config (proposal 2).
- **D-024 "two shapes" and "runtime protocol only".** Widen to a decision shape (proposal 7). Keep pull for observers, but give them verbs, cursors and an optional supervisor (proposal 8).
- **A-074 "the repository may set runtimes per role".** Keep the name choice, but models and arguments must stay owner-only once runtimes take them (proposal 5).
- **A-113.** Confirmed as a direction. Add two qualifiers from the evidence:
  1. The owner's floor binds repository-supplied workflows. Not every default is lowerable policy.
  2. Each extension point carries a schema, a kit and a `doctor` line. Add one when a real second policy needs it, or the factory walks the configuration complexity clock (no-mistakes: about 5,800 lines of config code).

**Confirmed by the evidence:**

- **D-023: out-of-process extensions, JSON over stdio.** Neovim's maintainers regret shared remote-plugin hosts. VS Code needs Extension Bisect. Grafana and Terraform run plugins as subprocesses so a crash cannot take down the host.
- **D-024: pull observers, the controller does not start them.** KEP-3488 shows the cost of hooks on the critical path.
- **A-074 and A-078: a repository allow list read at the base SHA.** Git's protected configuration, Codex's project-file key refusals and Claude Code's "user or managed" keys all arrived at the same shape after CVEs.
- **A-083: grants from personal or job only, through the environment, never argv.** Proposal 10 only adds sources and a file mode.
- **A-102 and A-075: lazy runtime resolution with a module hash.** It matches VS Code activation derived from contributions.
- **A-111: `protocol: 1`, JSON workflows and `doctor`.** All confirmed, with refinements in proposals 1, 4, 12 and 13.
- **A-112 item 4: `/sf/kits` and runtime `network`.** Confirmed. Version the path by protocol.
- **The `sandbox` backend registry being closed** (`sandbox.ts:53`). Confirmed: no system studied lets a plugin decide its own confinement.

## Evidence notes

- Probes (on `42f174e`):
  - `probes/p1.ts`: `checkWorkflow` accepts four misspelled or unknown stage keys and an unknown top-level key; key reorder changes `workflowHash`.
  - `probes/p2.ts`: `loadConfig` accepts `sandbox.reed`, `runtimes.local.netwrok`/`model`, `runtime.developr`, `deadlineMs: "900000"` and `model`.
  - The worktree is removed. The probe scripts are kept in `/var/tmp/software_factory/research-foundations/extend-config/probes/`.
- Helper notes: `/var/tmp/software_factory/research-foundations/extend-config/notes/` (`claude-code.md`, `probe-node24.md`).
- Unverified or guessed:
  - whether `claude` or `pi` speak ACP natively;
  - the exact Node version that adds network permissions (the Node 26.12 docs show it);
  - the value of a decision-extension shape before row 12 exists;
  - the cost estimates.
- Helpers marked several secondary claims as unverified. None of them carries a proposal above.
