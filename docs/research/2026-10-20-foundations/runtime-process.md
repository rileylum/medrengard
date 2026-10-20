# Runtime and process model: how the factory runs agents, and how the controller runs

Slug `runtime-process`. Research date 2026-10-20. Read at main `42f174e`. Nothing in `/home/riley/dev/software_factory` was changed. No paid CLI was run. One probe (workspace sizes, below) ran under `/var/tmp/software_factory/research-foundations/runtime-process/probe/`, now deleted.

Sources: the factory's `src/` and `docs/`; the cloned repositories (T3 Code at `571d3bc`, Symphony, no-mistakes, treehouse, gnhf, firstmate, backpass, pi at tag `v1.1.0`); vendor docs fetched today. Six sub-agents read the repositories and the web in parallel. I re-fetched the two Claude Code pages the main claims rest on (headless mode, Agent SDK hosting). Issue numbers marked *(agent-reported)* come from a sub-agent's web pass, and I did not re-open them.

## 1. Short answer

- **Sound: a separate process for each run, driven by the vendor's CLI over stdio.** Both vendor SDKs work this way themselves. Anthropic's hosting page says: "When your code calls `query()`, the SDK spawns a separate `claude` CLI process and talks to it over stdio … One agent session maps to one subprocess." The Codex SDK spawns `codex exec --experimental-json`. So an SDK would add a dependency, and the 289 MB native binary that comes with the Claude SDK, without adding any capability. The factory's choice keeps D-002 and the zero-dependency rule. The cgroup kill matches what T3 Code ended up with.
- **Wrong: the factory reads only the last blob of output and throws the rest away.** `claude --output-format json` already reports cost, tokens and model. pi's `--mode json` reports usage, cost, model and stop reason on every assistant message. `parse` reads neither (`src/runtime/cli-adapter.ts:217-227, 239-256`). Nothing keeps the stream (`src/runtime/spawn.ts:3`: "No retries, no streaming").
- **Change first: stream and keep.** Switch claude to `--output-format stream-json --verbose`. Read pi's JSONL line by line. Write every byte to `runsDir` as it arrives, and pull out usage, model and liveness while the run goes on. That one change covers A-112 (raw output), most of A-111 (cost, tokens, model, `run_failed.cause`) and the heartbeat half of A-113. It needs no new dependency.
- **Second: a wider seam for adapters, and structured claims.** Give adapters `start(req, signal, onEvent)`, and give the extension protocol progress lines under `protocol: 1`. Then take claims through the CLI's own schema feature (`--json-schema` for claude, `--output-schema` for codex, a terminating extension tool for pi). The fenced `json` block stays as the fallback.
- **Don't build a daemon now (O-006).** The systems that run one (T3 Code, Symphony, no-mistakes) do it to serve an interactive UI, to accept a git push, or to poll a tracker. no-mistakes' CHANGELOG has 56 entries about its daemon: stale sockets, binary drift, orphaned children, a minimal service environment. The factory's next needs (recovery, cancel, a watchdog, observers) fit one-shot commands over SQLite. What it lacks is a run that outlives its controller and leaves its output and exit code on disk. That is the conmon pattern from podman, and `systemd-run --user` can provide it.
- **Workspace: 562 MB per cycle can fall to a few MB without weakening A-038.** Measured on a 509 MB checkout:
  - A `--shared` clone cut `.git` from 110 MB to 4.1 MB.
  - A bwrap overlay on a read-only base checkout cut the per-cycle working tree from about 400 MB to 3.9 MB, and set-up time from 1.3 s to 0.17 s.
  - Both work because the controller already runs git in the clone only inside the sandbox.
  - Avoid `git worktree` for untrusted writers: hooks, config and refs are shared with the owner's repository.

## 2. What we have

**The run seam.**
- An `Adapter` has one method, `start(req, signal): Promise<RunOutcome>`. The outcome is `completed{claim, sessionId}`, `failed{reason}` or `cancelled` (`src/adapter.ts:20-37`).
  - It carries no usage, no model and no failure cause.
  - It has no channel for progress.
- **Good:** `bounded` resolves on the deadline or a settled cycle whatever the adapter does, so a deaf adapter cannot hold a cycle (`src/controller.ts:172-196`). The controller round-trips outcomes through JSON and normalises them (`:124-140`).

**Spawning.**
- `spawnRuntime` writes the prompt to stdin and buffers both streams up to 8 MiB each (`src/runtime/spawn.ts:51, 144-158`). It resolves once, at `close`.
- It cancels with SIGTERM to the process group, then SIGKILL, plus `cgroup.kill` on the `sf-<runId>` user scope (`:112-130`; `cli-adapter.ts:113`).
- **Good:** T3 Code converged on the same design (`agentScope.ts`: one systemd scope per agent, killed by cgroup). no-mistakes and gnhf kill the process group too, after bugs: "kill child process group on cancel (no orphan subprocesses)" and "reap agent process group on clean exit to prevent daemon OOM crash".
- **Gap:** on overflow, the output is dropped (`spawn.ts:174-180`), so the evidence of why a run went wild is lost.

**The claude adapter.**
- It runs `claude -p --output-format json --no-session-persistence …` (`cli-adapter.ts:214, 314, 334`).
- `parse` reads `is_error`, `result` and `session_id`, then takes the last fenced `json` block (`:217-227`; `claimFrom` at `:172`).
- It discards `total_cost_usd`, `usage`, `modelUsage`, `num_turns`, `permission_denials` and `terminal_reason`. The 03-a spike recorded all of these (`docs/work/03-a-findings.md`, "Ping" row).

**The pi adapter.**
- It runs `pi -p --mode json --no-session …` (`:233, 321, 341`).
- `parse` finds `agent_end` and the last `turn_end`, and since 04-f it checks `stopReason: error` (`:239-256`).
- It discards `message.usage` (tokens and `cost.total`), `model`, `provider` and the `auto_retry_*` and `compaction_*` events. These are documented in pi's `docs/json.md` and `docs/message-types.md:72-139` at v1.1.0.
- pi's `--mode json` exits 0 on a failed model call; only text mode sets exit 1 (`src/modes/print-mode.ts:139-148`). 04-f already handles that.
- The true end of a pi run is `agent_settled`, not `agent_end`, because retries and compaction can follow `agent_end` (`docs/json.md:48, 56`). 1.1.0 added `agent_settled.aborted`.

**Extension runtimes.** One JSON `RunRequest` goes in on stdin and one JSON `RunOutcome` comes out on stdout (`cli-adapter.ts:265-285`; D-024). There is no way for an extension to report progress.

**The process model.**
- Each command is its own `node src/main.ts` process (`src/main.ts:158-225`).
- They coordinate through SQLite: `busy_timeout = 5000` (`src/store.ts:107`), `BEGIN IMMEDIATE` for upgrades (`:46`), a once-a-second cancel watch (`controller.ts:30, 188`) and a 500 ms follow poll (`src/stream.ts:25`).
- **Good:** `apply` is the only writer of state, and the store dedups one outcome per run ID (`store.ts:117-118`). Recovery and adoption (below) can rely on that.
- **Gaps:**
  - The CLI is spawned `detached` (`spawn.ts:116`) into its own scope. If `node main.ts` dies, the agent keeps running and writes into a pipe nobody reads, so its output and exit status are lost.
  - `resume` exists but nothing calls it (`src/run.ts:62`).

**The workspace.**
- Each cycle gets a `git clone --no-hardlinks` (`src/developer.ts:197-204`) and a separate verify checkout `<runsDir>/<cycleId>-verify` (`src/verify.ts:166`). Nothing deletes either.
- The sweep measured 562 MB per cycle on a repository with a 508 MB `.git` (`docs/research/2026-10-20/sweep.md:96`).
- The branch comes back by a sandboxed `upload-pack` fetch into `refs/sf/incoming/<cycleId>` (`developer.ts:213-239`).
- **Good:** the controller never runs git in the clone outside the sandbox (`developer.ts:61, 250-256`). That discipline makes the cheaper workspace in section 5 possible.

## 3. What we don't have

1. **No record of why a run did what it did.** The 2026-10-20 live run could not show why the developer did not commit (`docs/plan.md`, Run records row). A run's whole transcript existed on stdout and was dropped at the parse. Every system that runs agents unattended keeps it:
   - T3 Code writes NDJSON per thread with rotation (`provider/EventNdjsonLogger.ts:29-36`).
   - no-mistakes writes a log per step (`pipeline/executor.go:1154-1173`).
2. **No liveness while a run is in flight.** A run that has stalled and a run that is thinking hard for 14 minutes look the same until the deadline. Symphony separates three timeouts: startup read (5 s), silence per turn (1 h) and orchestrator stall (5 min, since the last event) (`SPEC.md:823-829, 1146-1148`). The factory has only the wall clock, 120 s by default (`main.ts:185`).
3. **No cost or token data**, although both CLIs already print it (section 2).
4. **No failure cause.** One free-text `reason` covers crash, timeout, cancel, a malformed claim and a refused claim (`controller.ts:73-90`). The CLIs report causes the factory could map:
   - claude result subtypes `error_max_turns`, `error_max_budget_usd`, `error_during_execution`;
   - `system/api_retry.error` values such as `rate_limit`, `billing_error`, `authentication_failed` (headless docs);
   - pi `stopReason`, `auto_retry_end.finalError`, `compaction_end.errorMessage`.
5. **No structured output.** The claim is free text that the factory searches for its last fenced block (`cli-adapter.ts:172-200`). Both CLIs can enforce a schema.
6. **A controller crash loses finished work.** The run's output goes to a pipe owned by the dead process. Even a run that finished with a valid claim must escalate (A-105), because the claim is gone.
7. **Stopping claude loses its result.** The headless docs say SIGTERM exits 143 and "records no result" for the turn, so the final cost is lost too. SIGINT ends the turn cleanly. The factory sends SIGTERM first (`spawn.ts:132-135`).
8. **Disk grows by about a full repository per cycle.** Twenty cycles use about 11 GB (sweep 6).

## 4. What others do

### 4.1 Agent integration

| Interface | What it gives | What it costs | What bit people | Verdict |
|---|---|---|---|---|
| **`claude -p --output-format stream-json --verbose`** ([headless docs](https://code.claude.com/docs/en/headless)) | NDJSON: `system/init` (model, tools, MCP servers, `capabilities` for feature detection), `assistant`/`user` messages, `system/api_retry` (attempt, delay, error category), `permission_denied`, final `result` with cost, usage and `structured_output`. `--json-schema` enforces a schema. `--max-turns`, `--max-budget-usd`. SIGINT ends a turn cleanly | Nothing new: same binary, same auth. No versioned schema; the docs say to feature-detect on `capabilities`. A request for a versioned envelope is open (claude-code #98165 *(agent-reported)*) | `-p` stays alive for background work, up to 10 min by default (docs). Hangs after the result and orphaned shells (#103116, #103313 *(agent-reported)*). Without `--bare`, `-p` runs a project's `.claude/settings.json` hooks and `.mcp.json` "even in a folder you've never trusted" (docs). The factory's `--restricted --strict-mcp-config` covers this | **Adopt** for output. Keep the prompt on stdin, not `--input-format stream-json`: the stdin control protocol (interrupt, `can_use_tool`) appears only in SDK source |
| **Claude Agent SDK (TS)** ([hosting](https://code.claude.com/docs/en/agent-sdk/hosting)) | Typed iterator over the same messages; `canUseTool`, hooks, `interrupt()`, `setModel`, resume/fork, `outputFormat`, `spawnClaudeCodeProcess` (where bwrap would go) | Peer deps `zod`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`; a 289 MB per-platform native binary pinned to the SDK version; "All rights reserved", under Commercial Terms; claude.ai login not allowed for third-party products "unless previously approved" | `interrupt()` never settles mid-call (#425); the iterator hangs (#333, #403); MCP zombies (#219); Write/Edit bypass host permission mechanisms (#493); `canUseTool` has no timeout (#470); a sandbox silently unarmed without bwrap (#239) *(all agent-reported)*. T3 Code works around several: "Iterate the Query itself … never settles while the CLI is idle" (`ClaudeAdapterV2.ts:600-606`); "The CLI can label an abort as success with is_error=false" (`:2942-2948`); its own process-group kill because MCP grandchildren keep "writing to a pipe nobody reads" (`:308-312`) | **Avoid** as a dependency. It is the same protocol plus a dependency. Its one real extra, `canUseTool` mid-run, matters only to a human approving tools in real time, and the factory's runs are unattended by design |
| **pi `--mode json`** (what the factory runs) | JSONL events with usage, cost, model and stop reason per assistant message; `tool_execution_*`; `auto_retry_*`; `agent_settled` | Nothing new | 0.84.0 made `message_update` delta-only, a breaking wire change; no protocol version on the wire (CHANGELOG.md:811, rpc dir grep) | **Adopt fully:** parse line by line, sum `usage.cost.total` over assistant `message_end` events (my inference; RPC's `get_session_stats` gives totals), end on `agent_settled` |
| **pi `--mode rpc`** (`docs/rpc.md`) | `prompt`, `steer`, `follow_up`, `abort` (waits for idle), `get_session_stats` (cumulative tokens and cost), extension UI requests; correlation by `id` | Nothing new | Do not split on U+2028/2029 with `readline` (`rpc.md:50-56`); T3 Code splits by hand for this reason (`provider-pi/src/server/rpc.ts:1-5`). "Pi's generic abort does not cancel manual compaction" (T3 `adapter.ts:2685-2705`) | **Adapt later.** It is still one process per run. Worth it only for a stop that keeps the session (`abort`) or for steering. The first pass ruled out "long-lived" rpc (`extensibility.md`, "Considered"); this differs, because streaming is not the same as long-lived |
| **pi SDK** (`docs/sdk.md`) | In-process `AgentSession`, `tool_call` handlers that can block | Pulls pi-ai with the Anthropic, OpenAI, Google and AWS SDKs, undici and jiti | Extensions run in-process with full permissions (`docs/security.md`) | **Avoid** |
| **`codex exec --json`** ([non-interactive docs](https://learn.chatgpt.com/docs/non-interactive-mode)) | JSONL `thread.*`, `turn.*`, `item.*`; `turn.completed.usage` (tokens only, no USD); `--output-schema`; `-o` last message; `exec resume`; `--ephemeral` | Nothing new if Codex is added | Codex's own sandbox inside another bwrap fails: it cannot re-exec, `pivot_root` fails, or it exits 0 with no command run (#47941, #34008, #46246 *(agent-reported)*). Hangs (#53537) | **Adopt** as the third built-in runtime when wanted: a `CliSpec` with codex's own sandbox off (`danger-full-access`) inside the factory's bwrap |
| **Codex app-server** (JSON-RPC) | Threads and turns, `turn/interrupt`, approval requests per command and file change, `thread/tokenUsage/updated`; schema from `generate-ts` | "experimental and not supported for production" ([docs](https://learn.chatgpt.com/docs/app-server)) | T3 Code pins Codex to 0.156.1 and patches generated schemas ("Codex omits [additionalProperties]"; `generate.ts:295-301`); a field is "not in the generated request schema yet" (`CodexAdapterV2.ts:6644-6679`); a second `initialize` is rejected (`:1789-1806`). Symphony never uses `turn/interrupt`; it closes the port (`app_server.ex:966-980`) | **Avoid** for now |
| **ACP** ([schema](https://agentclientprotocol.com/protocol/schema)) | Vendor-neutral JSON-RPC: `session/prompt`, `session/update` (chunks, tool calls, plan, `usage_update` with optional cost), `session/cancel`, `session/request_permission`; protocol version negotiated | Claude, Codex and pi need adapters, and the Claude adapter pulls in the Agent SDK. The SDK itself is dependency-free (7.9 MB). No structured output | v2 in progress; `PromptResponse.usage` semantics "implementations already diverge" (#1860 *(agent-reported)*). no-mistakes and backpass shell out to `acpx` and "never speak ACP" themselves (`acpx.go:25`). gnhf embeds the `acpx` library and appends the schema to the prompt, because ACP cannot enforce it (`acp.ts:44-51`) | **Adapt as an extension runtime**, never core. One `acp` extension reaches about 50 agents; a built-in is still better for claude, codex and pi |
| **MCP as the controller's channel** | `--permission-prompt-tool <mcp tool>` routes headless approvals; a controller-served `submit_result` tool gives a schema-checked claim on any MCP-capable agent (claude, codex, pi) | A stdio MCP server is a small JSON-RPC process the CLI spawns inside the sandbox; buildable without dependencies | `--mcp-config` entries that fail validation are skipped silently; check `mcp_server_errors` in `system/init` (docs) | **Adapt** as the vendor-neutral path for structured claims (Proposal 3) |
| **opencode `serve` / `run --format json`** | HTTP + SSE, `/abort`, a permissions endpoint, per-message cost | Server per run | A killed run was resumed by its background service without its permissions or step limit, and ran 1,660 steps for about $24 (anomalyco/opencode #55076 *(agent-reported)*) | **Avoid** the server shape; the lesson is that a supervisor must never relaunch on its own |
| **OpenHands agent server, SWE-ReX, Aider, Goose** | Whole runtimes (Python, Docker) or unstable APIs. Aider's Python API is "not officially supported … could change" ([docs](https://aider.chat/docs/scripting.html)). Goose's stream-json schema is unpublished | — | — | **Avoid** as integration targets; Goose is reachable through ACP |

**How the reference harnesses drive agents.**
- **T3 Code** keeps provider processes alive across turns:
  - Claude runs through the Agent SDK in streaming-input mode, one CLI process per session.
  - Codex runs as a shared `app-server`, pi as `--mode rpc`, and others through ACP.
  - It does this because a human chats and approves tools live; approvals park on a Deferred (`ClaudeAdapterV2.ts:8688-8780`).
  - Restart cancels in-flight turns: "No provider process outlives the server" (`ProviderRuntimeRecoveryService.ts:529`).
- **Symphony** runs one `codex app-server` per worker run, for up to 20 turns, and polls Linear every 30 s.
- **no-mistakes** and **gnhf** are closest to the factory: one subprocess per call, streamed.
  - no-mistakes runs claude as `-p --verbose --output-format stream-json [--json-schema …]` (`internal/agent/claude.go:253-282`); codex as `exec … --json --output-schema` (`codex.go:188-231`); pi as `--mode json`.
  - It gets pi's structured output from a temporary extension that registers a `no_mistakes_output` tool with strict `json_schema` and `terminate: true` (`pi.go`, `pi_output.ts.tmpl`).
  - A missing schema output becomes a typed `RejectStructuredOutput`, so the caller can ask the same agent to correct itself (`agent.go:86-123`).
  - Unknown token counts are stored as NULL, never 0 (`agent.go:283-297`).

**Which planned items a different integration gives for free:**

| Planned item | stream-json / json-mode, parsed fully | Agent SDK | pi rpc | ACP |
|---|---|---|---|---|
| A-112 raw output kept | yes (tee the stream) | yes | yes | yes |
| A-111 cost, tokens, model | yes (claude `result`, `system/init`; pi per message) | yes | yes (`get_session_stats`) | partly (`usage_update`, cost optional) |
| A-111 `run_failed.cause` | yes (result subtypes, `api_retry.error`, pi `stopReason`) | yes | yes | partly (StopReason) |
| A-111 turn and budget caps | yes (`--max-turns`, `--max-budget-usd`) | yes | no | no |
| A-113 heartbeats | yes (every line is liveness) | yes | yes | yes |
| A-113 stop one run | already (signal); SIGINT keeps the result | `interrupt()` (buggy) | `abort` | `session/cancel` |
| A-105 recovery | only if output goes to a file the run owns (Proposal 4) | no (SDK owns the process) | no | no |
| A-108/A-109 structured I/O | yes (`--json-schema`; codex `--output-schema`; pi extension tool) | yes | via extension | no |

The table's point: almost everything comes from parsing what the factory already receives. Changing the integration layer adds very little.

### 4.2 Process model

| System | Shape | Supervision and liveness | On a crash | Verdict |
|---|---|---|---|---|
| **T3 Code** | Long-lived Node server; UI over WebSocket RPC; `node:sqlite` event store with projections and an outbox; per-thread `KeyedLock`; 4 effect fibers with 30 s leases (`EffectWorker.ts:595-596`) | systemd scope per agent; event-loop stall monitor only; no per-turn timeout found | Process-bound effects cancelled, replay-safe ones requeued (`EffectOutbox.ts:123-142`); leftover agent scopes stopped "so two copies of one session never work in the same worktree" (`agentScope.ts:121-123`); opt-in "Continue where you left off", capped at 3 per 5 min | **Adapt** the restart rules (as the first pass said). **Avoid** the daemon for now: it exists for an interactive UI |
| **Symphony** | One BEAM process, state in memory only; poll every 30 s; reconcile, then dispatch; `max_concurrent_agents` 10 | Stall from last event (5 min); retry with exponential backoff, no cap | "No running sessions are assumed recoverable" (`SPEC.md:1690-1704`); re-dispatch into the kept workspace | **Adapt** the separate timeouts and the distinct terminal reasons (`SPEC.md:676-692`). **Avoid** state that lives only in memory |
| **no-mistakes** | Always-on per-user daemon (systemd, launchd or schtasks); JSON-RPC over a Unix socket with `SO_PEERCRED`; SQLite WAL | 30-min agent timeout, extended while output flows (`agent_run.go:17-51`); OOM score raised for agents | Resumes only parked approval gates; everything else fails "daemon crashed during execution", after pinning commits under a recovery ref | **Avoid** the daemon; 56 CHANGELOG entries about it, for example "treat a refused socket with a gone daemon as not running", "restart the daemon through the newly installed binary", "refresh managed services with stable PATH". **Adopt** the timeout that extends while output flows (as an observer, A-113) |
| **treehouse** | No daemon: inline CLI, `flock` and an atomic JSON state file | Leases with a random ID, released under compare-under-lock | Corrupt state is rebuilt from disk with every slot quarantined (`docs/design.md:34-36`) | **Adopt** the stance: one-shot commands plus a lock suffice |
| **Temporal** ([docs](https://docs.temporal.io/encyclopedia/detecting-activity-failures)) | Stateless workers poll a queue | Heartbeat timeout; "Activity Cancellations are delivered … when they Heartbeat"; the server "doesn't detect failures when a Worker … crashes" | Timeout, then retry | The factory's once-a-second watch already is a heartbeat read. **Confirms** that liveness comes from a timeout, not from detecting a crash |
| **GitHub Actions runner** | Listener long-polls; one Worker process per job; job lock renewed every minute, about 10-min lease (depot.dev; third party) | Processes without `RUNNER_TRACKING_ID` survive job end | "lost communication"; ephemeral runners recommended because persistent ones may get jobs while shut down ([docs](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/autoscaling-with-self-hosted-runners)) | **Adapt** "one process per job" (the factory has it) and "ephemeral" |
| **Buildkite agent** ([lifecycle](https://buildkite.com/docs/agent/lifecycle)) | One agent process runs one job at a time; N agents give N slots | Heartbeat; lost after 3 min; cancel signal, then 10 s, then SIGKILL | Job exits -1 | **Evidence for pools:** a long-lived process per slot is a third option beside "per cycle" and "one for many" |
| **Jenkins durable pipelines** ([scaling](https://www.jenkins.io/doc/book/pipeline/scaling-pipeline/)) | Serialised interpreter state | A wrapper touches a log file; long silent scripts were killed until the heartbeat went from 15 s to 5 min (JENKINS-48300) | Cheaper durability modes "may not be able to resume" | **Avoid:** making interpreter state durable is costly; the factory's replayed event log is the better design. A filesystem-touch heartbeat gives false "dead" verdicts |
| **Podman vs Docker** | Fork-exec, no central daemon; added back **conmon**, one per container, "the smallest daemon a container can have", which holds stdio, writes logs and records the exit code "for the managing programs to read" ([conmon](https://github.com/containers/conmon)); plus a socket-activated API service that exits when idle ([docs](https://docs.podman.io/en/latest/markdown/podman-system-service.1.html)) | — | The container outlives the CLI | **Adopt** the pattern: Proposal 4. `systemd-run --user` can play conmon with no code |
| **Claude Code background sessions** ([agent-view](https://code.claude.com/docs/en/agent-view)) | Per-user supervisor; roster file "used to reconnect after a restart"; `claude daemon stop --keep-workers` leaves workers for the next supervisor to adopt | — | Adopts surviving workers | **Evidence** for adoption in recovery (Proposal 4) |
| **Kubernetes Jobs, Nomad** | Reconcile loops | "the same program may sometimes be started twice" ([k8s](https://kubernetes.io/docs/concepts/workloads/controllers/job/)); Nomad's "unknown", separate from "lost" | — | **Confirms** D-016: a separate "unknown" state, and stop to ask the owner |
| **Copilot agent, Codex cloud, Cursor, Devin** | Disposable VM or container; branch or diff out; human merge | Copilot: 59-min hard limit ([docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)) | — | **Confirms** the branch hand-back and no automatic merge |

**What each process model means for the next rows:**
- **Recovery (row 11).**
  - *One-shot plus files:* `recover` scans open cycles, reads each started run's directory, and kills or adopts it.
  - *Daemon:* the same scan at start-up, but now the daemon's own restart is a new crash class (no-mistakes, T3 Code).
- **Dispatch (row 12).**
  - *One-shot:* a `dispatch` command run by a systemd timer or by the owner, with an observer extension deciding eligibility (A-113).
  - *Daemon:* a poll loop like Symphony's. Polling a tracker every 30 s needs something long-lived, but a systemd timer is that thing.
- **Pools (row 13; no verdict, per A-112 item 5).** The surveyed systems use three shapes:
  - one process for many runs: T3 Code, Symphony, no-mistakes (all on async I/O);
  - one process per job: GitHub runner workers, gnhf, the factory today;
  - one long-lived process per slot: Buildkite.

  The factory's synchronous git (`architecture.md` finding 9) rules out the first shape unless it becomes async. Proposal 4 makes the choice matter less: when runs outlive their controller, a controller is a short-lived reconciler, not the run's owner.
- **Watchdogs.** Under every model this is an observer reading liveness from the stream (A-113). Symphony and no-mistakes both measure silence, not wall time.
- **Observability and UI.**
  - Today: `events --follow` (poll). A TUI needs no daemon; herdr already shows panes.
  - A web UI can be a read-only `serve` command that reads SQLite and exits when idle. Podman's socket-activated service is the model. It is not a controller daemon.

### 4.3 Workspace and hand-back

**Measured on this machine** (ext4, so no reflink; bwrap 0.13.0; git 2.56.0), with a non-shallow single-commit repository built from t3code's tree (509 MB checked out, 106 MB `.git`):

| Method | Time | Per-cycle disk |
|---|---|---|
| `git clone --no-hardlinks` (today) | 1.32 s | 509 MB (110 MB `.git` + about 400 MB tree) |
| `git clone --shared` | 1.34 s | 404 MB (`.git` 4.1 MB; objects through `objects/info/alternates`) |
| bwrap `--overlay-src <base clone> --overlay <upper> <work>`, then `git status`, an edit and `git add` inside | 0.17 s | **3.9 MB** upper (the index plus the changed file and its objects) |
| `git worktree add` | 2.4 s | 400 MB, shares `.git` with the owner's repository |

- The owner's repository has a 508 MB `.git`, so `--shared` alone would save nearly all of its 562 MB.
- Using `--shared` requires the sandbox to read the source objects directory, bound read-only.
- git warns that `--shared` is "a possibly dangerous operation": if the source prunes objects, "the cloned repository will become corrupt" ([git-clone](https://git-scm.com/docs/git-clone)). So point the alternates at a controller-owned bare mirror that never prunes, not at the owner's working repository.
- Overlay rules: the lower layer must not change while it is mounted, so keep one read-only base per base SHA, shared by cycles. The upper layer holds whiteouts, so only sandboxed processes may read the clone. The factory already does that (`developer.ts:61`).

**Others:**
- **`git worktree`** (Claude Code, Cursor, Conductor, T3 Code, no-mistakes): hooks, config and refs resolve through `$GIT_COMMON_DIR` ([gitrepository-layout](https://git-scm.com/docs/gitrepository-layout)).
  - Claude Code's own sandbox keeps the shared `.git` writable for commits but denies `hooks/` and `config` ([sandboxing](https://code.claude.com/docs/en/sandboxing)), which leaves the shared refs writable.
  - A Claude Code worktree escape was reported as CVE-2026-55607 *(agent-reported, secondary source)*.
  - **Avoid** for an untrusted writer; A-038's own clone is right.
- **treehouse:** a pool of worktrees reset with `read-tree --reset -u` plus `clean -fd`, keeping ignored build caches. **Adapt** only the pool and lease ideas: a dirty cache conflicts with "checks ran independently" (`verify.ts:166-172`).
- **Hardlinks** (dropping `--no-hardlinks`): **Avoid.** A-038's reason holds: a hardlinked pack is the owner's inode, and the sandbox can write the clone.
- **Containers or VMs** (container-use, Sculptor, Codex cloud, Devin): heavy, and D-019 parks them for later. They hand back a git branch or a diff, as the factory does.

**Hand-back.** Everyone surveyed hands work back as a git branch, a ref or a diff. T3 Code also takes a hidden checkpoint ref at each turn end (`refs/t3/orchestration-v2/checkpoints`, `CheckpointService.ts:26`) and serves diffs between them; it fsyncs refs after "0-byte files under refs/t3/**" broke every later fetch (`GitVcsDriver.ts:807-814`). The factory's sandboxed fetch with `fsckObjects` into a private ref is as strict as anything surveyed. **Keep it.**

## 5. Ranked proposals

### 1. Stream, keep and parse every run's output
- **What:**
  - claude switches to `--output-format stream-json --verbose`.
  - Both adapters parse line by line as bytes arrive, and write each stream unchanged to `runsDir/runs/<runId>/{stdout,stderr}`.
  - The parser pulls out the model, the tool list (from claude's `system/init`), usage and cost (claude's `result`; pi's summed per-message `usage`), the stop reason and retry events. It records them on the outcome.
  - pi's end becomes `agent_settled`.
  - Overflow keeps the file and drops only the in-memory copy.
- **Decision implied:** reverse the `spawn.ts:3` "no streaming" note from 04-d (A-024). The claim parse stays as it is.
- **Cost:** M. Widens A-111 item 1 and A-112 item 1; both become one ticket.
- **Buys:**
  - The live run's "why didn't it commit" becomes answerable.
  - Cost per run is known.
  - Liveness exists.
  - `system/init` proves which tools the run actually had, which is evidence that `--restricted` and the allow list held.
- **Impact 5. Confidence high** (both formats are documented; no-mistakes and gnhf parse exactly these).
- **A-113:** this is a capability. The default is to record and keep the output; what to do with it is policy.

### 2. A wider adapter seam: progress events, usage and cause on the outcome, and progress lines for extensions under `protocol: 1`
- **What:**
  - `start(req, signal, onEvent?)`.
  - `RunOutcome` gains optional `usage`, `model` and `cause` (`infra | limit | output`, from the first pass).
  - The controller turns progress into rate-limited `run_progress` store rows (at most one per run per N seconds; last activity, tokens so far). These rows sit outside `Event`, like the `open` row, so `apply` never sees them and replay is unchanged. The observation stream passes them through.
  - Extension runtimes may print JSONL progress lines before the final outcome line.
  - A stop request row for one run (A-113) is read by the existing watch.
- **Decision implied:** widen D-024's "one RunOutcome on stdout" to "progress lines, then one outcome", versioned by A-111's `protocol: 1`. A stopped run records `run_failed` with cause `infra`.
- **Cost:** M. Widens D-024 and A-074 (runtime protocol) and A-111 item 3.
- **Buys:** the stall watchdog becomes a pure observer, as the owner wanted (A-113). It also enables a status board and cost dashboards.
- **Rationale for rate limiting:** T3 Code found that "Every provider event is its own commit, so a slow or busy disk stalls the event loop" (`persistence/Sqlite.ts:27-32`). Raw events go to files, and only coarse heartbeats go to SQLite.
- **Impact 4. Confidence high.**
- **A-113:** this is exactly the extension point it asked for.

### 3. Structured claims through the CLI's own schema enforcement
- **What:**
  - claude gets `--json-schema <claim schema>` and reads `structured_output`.
  - pi gets a terminating `submit_claim` tool with a strict schema, loaded as a controller-owned extension file. That is no-mistakes' method; the exact loading flag still needs checking.
  - A future codex runtime gets `--output-schema`.
  - The vendor-neutral fallback for any MCP-capable agent is a dependency-free stdio MCP server, bound read-only, that offers `submit_claim` and writes the claim to a file the controller reads.
  - The fenced block remains the last fallback. A missing structured output becomes a classified failure (`output`), as no-mistakes' `RejectStructuredOutput` does.
- **Decision implied:** the claim schema becomes part of the contract hash (09-c). This is A-109's verdict shape delivered by the runtime.
- **Cost:** S for claude, M for pi and MCP. Builds on A-108 and A-109.
- **Buys:** no more "no claim block in reply" or malformed-JSON failures from formatting. Structured findings are enforced, not requested.
- **Caveats:** claude's `format` keyword is not enforced (docs). Schema failures exist upstream (claude-code #77026, codex #19816 *(agent-reported)*). Keep validating in `apply`, because the store still classifies the claim.
- **Impact 4. Confidence medium-high.**
- **A-113:** the core owns the claim schema. A workflow may declare a step's output shape (A-109).

### 4. Runs that outlive their controller, so recovery can adopt finished work
- **What:**
  - Launch each run so that stdout and stderr go to files in the run's directory (Proposal 1's files), not to pipes the controller owns.
  - Its exit code is recorded on disk by a supervisor that is not the controller. Two options:
    - `systemd-run --user --unit=sf-<runId> -p RuntimeMaxSec=…` as a transient service, whose exit status systemd keeps. Whether transient units keep it after exit, and which `CollectMode` is needed, is unverified.
    - A one-line trusted wrapper (`sh -c '…; echo $? > exit'`) inside today's scope.
  - The controller tails the files instead of reading pipes.
  - `recover` (row 11) then sorts a started run with no outcome into three cases:
    - **still running** (scope alive): watch it, or stop it;
    - **finished with output**: parse it and `receive` it under its original run ID. The store's one-outcome-per-run index (`store.ts:117-118`) makes this idempotent;
    - **gone with nothing**: `run_failed`, cause `infra`, escalate.
- **Decision implied:** widen A-105. Its "always escalate a crashed run, no relaunch" stays for runs with no outcome. A run that completed while the controller was down is received, not escalated. This is not a relaunch: no new run, no new spend. It is owner policy; a "never adopt" default keeps A-105 exactly.
- **Cost:** M. Touches A-105, A-024 (spawn) and 03-b/04-d (scope handling).
- **Buys:**
  - A crash or Ctrl-C of `node main.ts` no longer throws away a paid run.
  - Ctrl-C becomes safe: the run continues, and `resume` or `recover` picks it up.
  - The process-model question gets smaller: the controller becomes a reconciler and stops being the run's owner.
- **Evidence:** podman's conmon; Claude Code's `--keep-workers` adoption; T3 Code, which instead stops orphans because two copies of one session must never write one worktree. The factory's single-writer guard is the one-outcome index plus the branch-tip check in `land`.
- **Impact 4. Confidence medium:** the design is sound, but the systemd details are unverified.
- **A-113:** this is a capability. Adopt or escalate is policy, set by a recovery default.

### 5. Cheaper workspaces: `--shared` against a controller-owned mirror, and an overlay checkout
- **What:**
  - Keep a bare mirror per repository under `runsDir` that the controller fetches into and never prunes.
  - Each cycle's clone is `git clone --shared <mirror>`, with the mirror's `objects` bound read-only into every sandbox that reads the clone.
  - Second step: one read-only base checkout per base SHA, and each cycle's developer works in a bwrap overlay on top of it.
  - Every git read of the clone already happens inside the sandbox (`cloneGit`, `upload-pack`), so mount the same overlay there.
  - The verify checkout can use the same base.
- **Decision implied:** widen A-038. "No hardlinks" stays; "a full copy" goes.
- **Cost:** M for `--shared`, L for the overlay.
- **Buys:**
  - Measured: about 509 MB to a few MB per cycle, and 1.3 s to 0.17 s of set-up.
  - Pools (D-006: three developers at once) become cheap.
  - It shrinks the housekeeping row (A-111) to deleting small upper directories.
- **Risks:**
  - A mirror that a sandbox can read exposes every object in it. The clone exposes the same objects today.
  - An overlay lower layer changed while mounted is undefined behaviour, so lower layers must be immutable.
  - `gc` inside the overlay copies packs up.
- **Impact 3** (4 once pools start). **Confidence high** for `--shared` (measured), **medium** for the overlay (one probe; not tried with the claude or pi CLIs).
- **A-113:** this is core plumbing behind `layout` (A-112 item 3). It fits as the second row 11 ticket's neighbour.

### 6. Stop a claude run with SIGINT first
- **What:** cancel sends SIGINT, waits for a grace period to collect the `result` (cost included), then sends SIGTERM, then runs `cgroup.kill`.
- **Cost:** S. Touches 03-b (cancel).
- **Buys:** a stopped or timed-out run still reports its cost and partial result. The headless docs say SIGTERM "records no result".
- **Impact 2. Confidence high** (documented).
- **A-113:** this is a core capability.

### 7. No daemon now; keep O-006 open with explicit triggers
- **What:** stay one-shot. Add `recover` (row 11) and, later, `dispatch` (row 12) as commands that a systemd user timer or the owner runs. Any web UI is a read-only `serve` that exits when idle.
- **Revisit O-006 when one of these is true:**
  - (a) a tracker needs webhooks pushed to a listening socket;
  - (b) the UI must push changes faster than a poll;
  - (c) pools put many runs on one store and the 1 s watch polling costs too much.
- **Cost:** S, a decision.
- **Buys:** it avoids no-mistakes' daemon bug class (stale sockets, binary drift, minimal service environment, restart during live runs).
- **Impact 3. Confidence medium-high.**
- **A-113:** daemon-or-not is a deployment choice. A future daemon could be an extension that only calls the same commands.

### 8. Vendor reach through runtimes, not the core: codex as a built-in, ACP as an extension
- **What:**
  - Add a codex `CliSpec`: `exec --json --output-schema`, with its own sandbox off inside the factory's bwrap.
  - Ship ACP as an example extension runtime, which needs Proposal 2's progress lines.
- **Cost:** M each. Widens D-007.
- **Buys:** D-002's vendor neutrality is shown, not just claimed. A second model family helps reviewers too: the first pass cited Refute-or-Promote, where same-family reviewers share blind spots.
- **Impact 2. Confidence medium.**
- **A-113:** these are extensions on core seams.

## 6. Challenged and confirmed decisions

**Challenge:**
- **04-d / A-024, "No retries, no streaming"** (`spawn.ts:3`). The no-retries part holds. The no-streaming part costs the factory raw output, cost, liveness and causes, and buys nothing. Reverse it (Proposal 1).
- **D-024 / A-074, runtime protocol "one RunRequest on stdin, one RunOutcome on stdout".** Too narrow for A-113's heartbeats from extension runtimes. Widen it at `protocol: 1` (Proposal 2).
- **A-105, "always escalate a crashed run".** Keep "no relaunch". But a run that finished while its controller was gone is not a crashed run, and escalating it wastes a paid result. Offer adoption as an option (Proposal 4).
- **A-038, the `--no-hardlinks` full clone.** Its security reason holds. The full copy is not needed for it (Proposal 5).
- **First pass, `extensibility.md` "Considered": "Pi `--mode rpc` … a long-lived host would undo that".** This partly contradicts the evidence. rpc is still one process per run. Streaming and long-lived are separate choices; the factory wants the first and not the second.
- **O-001** ("structured output, cancellation, isolation … nothing else checked") can now close. Structured output exists on claude (`--json-schema`), codex (`--output-schema`) and pi (an extension tool). Cancel behaviour is documented (SIGINT versus SIGTERM). Isolation stays the factory's bwrap.

**Confirm:**
- **D-002 vendor-neutral core, D-007 / A-001 Pi and Claude Code by CLI, P-002 zero dependencies.** Both vendor SDKs are the CLI over stdio, so wrapping the CLI is the same layer, minus a dependency and a 289 MB binary.
- **`--no-session-persistence` / `--no-session`** and source §1's "do not require native agent-session resumption". Agent SDK sessions keep "conversation history but not filesystem state" (first pass). Raw output on disk (Proposal 1) serves diagnosis better than resumable sessions.
- **The cgroup scope kill (04-d) and process-group signalling (03-b).** T3 Code, no-mistakes and gnhf all ended up here after orphan bugs.
- **The sandboxed fetch hand-back (08-c).** It is as strict as anything surveyed.
- **D-016 / A-105's refusal to relaunch silently.** Supported by opencode #55076's runaway resumed run and T3 Code's restart cap.
- **One-shot commands over SQLite.** treehouse shows the same shape at production quality. The decision itself (O-006) stays open with triggers (Proposal 7).

**Side findings for other slugs (not mine to rank):**
- **pi reviewer and MCP (security).** The pi reviewer runs without `--no-mcp` (`cli-adapter.ts:341`). pi's `--tools` "does not remove MCP tools". Tools no entry names are not declared to the model, but the owner's configured MCP servers still connect inside the reviewer's sandbox (pi `docs/cli.md:119-138`). Adding `--no-mcp` is cheap.
- **Claude Manual mode.** Since claude v2.1.302, `-p` runs start in Manual mode and deny any call nothing approves (headless docs). This is consistent with today's allow lists.
- **`--bare`** is Anthropic's recommended script mode and "will become the default for `-p`". It never reads OAuth, so it needs `ANTHROPIC_API_KEY`. If the owner logs in by subscription, a future default flip would break runs. Watch the release notes.
