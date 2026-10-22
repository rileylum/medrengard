# Brokered messaging between sandboxed coding agents (Claude Code, pi, herdr)

Scope: how concurrently running, bwrap-sandboxed Claude Code and pi runs (headless `-p` and interactive herdr tabs) can message each other through a broker the controller owns, with the controller as the authority. Researched 2026-10-22. Local versions checked: Claude Code 2.1.306, pi 1.1.0, herdr 0.9.5.

Local sources are cited as `local:` with the command or path; they were read-only. Project files are under /home/riley/dev/software_factory (read only, nothing written there).

Project facts that constrain the design (from the repo):
- `src/sandbox.ts` `wrapBwrap`: `--die-with-parent --unshare-all [--share-net] --new-session`, `--clearenv` (or `--unsetenv` per name when secrets exist), `HOME=/tmp` by default, `--proc /proc --dev /dev`, `/tmp` a tmpfs unless `policy.tmp` binds a host dir, binds from `policy.write` (`--bind`) and `policy.read` (`--ro-bind`), `--overlay-src/--tmp-overlay` overlays, `writeOver` binds after overlays, then `--remount-ro /`. — local: src/sandbox.ts lines 42-66
- `proto/herdr-adapter.ts` drops `--new-session` for interactive runs and refuses to run unless `dev.tty.legacy_tiocsti = 0`, starts claude via a `/run/sf/claude` symlink so herdr detects it, delivers the prompt with `herdr agent prompt <name> "Read <promptFile> and follow it."` from outside the sandbox, retrying while the trust dialog is up. — local: proto/herdr-adapter.ts lines 66-124; docs/work/herdr-findings.md
- O-010: "How an owner's answer to an agent in its herdr tab becomes evidence the reviewers can see" — in `demo-ask` the reviewers failed the work because "no evidence shows the owner was asked". — local: docs/open-questions.md line 13; docs/work/herdr-findings.md "Owner answers are not evidence"
- O-006: no daemon now (A-122); revisit "when a tracker needs webhooks pushed to a listening socket, a UI must update faster than a poll, or pools make the one-second watch too costly". — local: docs/open-questions.md line 10
- A-074 / D-024: runtime adapters speak one JSON `RunRequest` on stdin, one `RunOutcome` on stdout; an observer is any process that reads the event stream and acts through the owner's commands. A later entry (decisions.md line 179): "observers may also send `note`, and the store keeps a cursor per observer". — local: docs/decisions.md lines 32, 547-553, 179
- A-043: runs keep full network access and can read their own CLI credentials (accepted gaps). A-126: per-cycle `git clone --shared` against a controller-owned bare mirror; with pools, an overlay checkout per base SHA. Plan row 13 (Pools) is open on one process per cycle vs one for many. — local: docs/decisions.md lines 29, 150-156, 758-762; docs/plan.md lines 20, 33
- The decisions log records that `--share-net` reaches host 127.0.0.1 services and abstract Unix sockets (security finding 3). — local: docs/decisions.md line 352

## 1. Transport mechanisms for a controller-owned broker, and their trade-offs

### Takeaway
The strongest fit is one controller-owned pathname Unix socket per run, bind-mounted into that run's sandbox at a fixed path: the broker knows the sender by which listening socket the connection arrived on, so the agent cannot forge its identity, and the controller writes every message to its store before delivery. Agents reach it through a tiny stdio MCP server (Claude Code, pi) or a pi extension tool launched inside the sandbox; delivery into the agent goes through each runtime's own injection point (section 2-4). A per-run mailbox directory is the zero-code fallback but gives weaker sender authentication and ordering.

### Cited Findings
- Pathname Unix sockets are filesystem objects whose owner, group and permissions can be changed with chown/chmod; abstract sockets are "independent of the filesystem". — [unix(7)](https://www.mankier.com/7/unix)
- "network namespaces isolate the UNIX domain abstract socket namespace". So an abstract socket is unreachable from a run started with `--unshare-all` without `--share-net`, but a run with `--share-net` shares the host netns and therefore the host's abstract sockets. — [network_namespaces(7)](https://man7.org/linux/man-pages/man7/network_namespaces.7.html); project finding: local docs/decisions.md line 352
- The bwrap wrapper binds paths with `--bind`/`--ro-bind` and remounts `/` read-only, so a host socket file bound at a path inside the sandbox is the only way in; nothing else under `/run` or `$HOME` is visible. — local: src/sandbox.ts lines 56-66
- Claude Code's own peer-messaging socket documents the same pattern and its limits: a per-session Unix socket, restricted to the OS user; it closes a connection "that hasn't sent a complete line within 30 seconds"; the receiver rate-limits per sender, drops identical repeats in a short window, queues at most 50 accepted messages, holds at most 100, and refuses messages over about a million characters. — [Claude Code: cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- Claude Code identifies "own-child messages" on Linux "by process evidence even for a child that has already exited", and otherwise by a per-session token `CLAUDE_CODE_MESSAGING_TOKEN` sent as the first line `{"type":"auth","token":"<token>"}`. — [Claude Code: cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- mcp_agent_mail runs as a FastMCP server over Streamable HTTP (default port 8765), authenticates with a static bearer token or optional JWT/JWKS, and identifies the sender mainly by a `sender_name` argument (some examples add `agent_token`/`sender_token`). — [mcp_agent_mail README](https://github.com/Dicklesworthstone/mcp_agent_mail)
- Claude Code channels: a channel is an MCP server "Claude Code spawns ... as a subprocess and communicates over stdio"; "An ungated channel is a prompt injection vector" and senders must be gated "on the sender's identity, not the chat or room identity". — [Claude Code: channels reference](https://code.claude.com/docs/en/channels-reference)
- pi connects to MCP servers "over stdio or streamable HTTP"; user servers in `~/.pi/agent/mcp.json`, project servers in `.pi/mcp.json` (read only after project trust); `--no-mcp` disables MCP. — local: pi 1.1.0 docs/mcp.md; `pi --help`

### Inferences
Comparison of the candidate transports (sender auth / ordering / backpressure / headless vs interactive):

| Mechanism | Sender authentication | Ordering | Backpressure | Headless and interactive |
| --- | --- | --- | --- | --- |
| Per-run socket, bind-mounted (one listener per run, e.g. host `<runsDir>/<runId>/broker.sock` bound at `/run/sf/broker.sock`) | Strong: identity = which listener accepted; agent cannot name another run. `SO_PEERCRED` adds nothing inside a user namespace (all runs are the owner's uid), so the listener is the identity | Broker assigns a store-wide sequence when it writes the row; per-connection order is FIFO | Broker can refuse (size cap, per-sender rate, queue cap) and return the refusal to the sender's tool call | Both: the in-sandbox client is the same |
| One shared broker socket for all runs | Weak: the agent must claim who it is; needs a per-run token in env, which the agent can read and leak to a sibling only if it can reach the sibling, so acceptable but strictly weaker | Same | Same | Both |
| Per-run mailbox dirs (`outbox/` writable, `inbox/` read-only), host side `fs.watch`/inotify | Medium: identity = which outbox dir; but the agent can write arbitrary file names, partial files and symlinks; broker must read with `O_NOFOLLOW` and atomic-rename convention | Only by filename or mtime; broker must assign seq on ingest | None: disk fills; broker can only delete | Delivery into the agent still needs a hook/extension to read `inbox/`; works headless and interactive |
| Named pipe (FIFO) per run | Same as per-run socket (identity = which FIFO) | FIFO | Writer blocks when the 64 KiB pipe buffer fills; no reply channel unless a second FIFO | One-directional; fragile with several writers (interleaving above PIPE_BUF 4096 bytes) |
| HTTP MCP on a host port | Needs a bearer token per run; with `--share-net` every run, and any host process, can reach 127.0.0.1; without network the port is unreachable | Server-assigned | HTTP status codes | Only runs with network; conflicts with A-043's open network gap |
| Poll SQLite store | Agent would need the DB file bound in; `node:sqlite` in the sandbox could write any row, breaking "controller decides state" unless bound read-only, and WAL needs a writable `-shm` | Store order | Poll interval | Reads only; sends still need another path |

- A stdio MCP server launched by the CLI inside the sandbox is a child of the agent, so it inherits the sandbox; it only needs the one bound socket path. This keeps the broker outside and the MCP shim dumb (forward JSON lines). The shim can be a ~50-line Node script using `node:net`, with no dependency, if it speaks MCP JSON-RPC by hand; using `@modelcontextprotocol/sdk` would be the project's first dependency.
- A per-run listener also matches how the controller already supervises one systemd scope per run: the listener's lifetime equals the run's, and closing it is part of cancel.
- `fs.watch` on Linux uses inotify; inotify does see writes made through a bind mount from inside a namespace because the inode is the same, but this was not verified in a source here (see Gaps).

### Gaps
- I found no primary source confirming inotify event delivery for writes made inside a bwrap mount namespace to a bind-mounted host directory; it should be probed.
- Whether `SO_PEERCRED`/`SO_PEERPIDFD` returns useful PIDs across the bwrap PID namespace was not checked in a source (the kernel translates PIDs into the receiver's namespace; the pid seen by the host broker would be the host PID of the bwrap child, which could identify the run, but this is unverified).

## 2. Claude Code native features (v2.1.306 installed; docs as of Oct 2026)

### Takeaway
Claude Code has three native ways to receive a message mid-run: (a) cross-session messaging over a per-session inbox socket, delivered "between tool calls during an active turn" or as a new turn when idle, and it works in `-p`; (b) channels, an MCP server pushing `notifications/claude/channel` events, interactive only for custom servers during the research preview; (c) hooks, chiefly `asyncRewake` command hooks and `Stop`/`PostToolUse` `additionalContext`. Stream-json stdin is not a reliable mid-turn steer. The cleanest controller-owned path for sandboxed Claude is: a bind-mounted per-run socket, plus a per-run stdio MCP shim exposing `send/list` tools for outbound, and for inbound either the session's own inbox socket (fed by a host-side relay through the sandbox) or a `PostToolUse`/`Stop` hook that drains the broker.

### Cited Findings
Cross-session messaging (the "cc-socks" peer sockets):
- Requires Claude Code v2.1.224+ on Linux; on by default. Tools: `ListAgents` and `SendMessage`; `/list-agents` (alias `/peers`). — [cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- Same-machine messages travel "Over a per-session socket ... never through Anthropic servers"; other machines go through Anthropic servers via Remote Control. — [same](https://code.claude.com/docs/en/cross-session-messaging)
- Delivery: "The receiving Claude reads the message between tool calls during an active turn, so a running tool is never interrupted. When the receiving session is idle, Claude Code starts a new turn with the message." — [same](https://code.claude.com/docs/en/cross-session-messaging)
- The receiver is told the message came from another session: it "can't approve anything", "can't change configuration", slash commands in it "arrive as plain text", permission prompts still fire. — [same](https://code.claude.com/docs/en/cross-session-messaging)
- Inbound policy key `crossSessionInbound`: `accept` / `hold` / `refuse`; `dialogExpiry` (default five minutes, `"never"` allowed); `isolatePeerMachines: true` requires approval before any message leaves the machine. Disable sending with permission deny rules `"SendMessage"`, `"ListAgents"` (this also removes messaging to subagents and teammates). — [same](https://code.claude.com/docs/en/cross-session-messaging)
- `-p` sessions bind an inbox socket "like an interactive one"; `--bare` sessions do not. "To let a `-p` worker take messages unattended, start it with `crossSessionInbound` set to `accept` in its `--settings` value." — [same](https://code.claude.com/docs/en/cross-session-messaging)
- Socket discovery: `/status` "Peer address" row (`uds:` prefix) and env var `CLAUDE_CODE_MESSAGING_SOCKET`, exported to hooks and Bash before any hook, including `SessionStart`; per-session token `CLAUDE_CODE_MESSAGING_TOKEN`. If Claude Code cannot accept the socket directory it uses `/tmp/cc-socks-<uid>`. Wire format: newline-terminated JSON lines; optional first line `{"type":"auth","token":"<token>"}` on Linux. The message body schema itself is not documented on that page. — [same](https://code.claude.com/docs/en/cross-session-messaging)
- "A session inside a container and a session on the host can't reach each other." — [same](https://code.claude.com/docs/en/cross-session-messaging)
- On this machine the sockets exist at `/run/user/1000/cc-socks/<pid>.sock` (e.g. `12569.sock`). — local: `ls /run/user/1000/cc-socks`

Agent teams (experimental):
- Enable with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; "In non-interactive mode with the `-p` flag, including Agent SDK sessions, Claude doesn't spawn teammates". — [agent teams](https://code.claude.com/docs/en/agent-teams)
- Mailbox: "Each agent's mailbox is a JSON file at `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`"; entries are validated on read; a send is reported only when the write to the recipient file succeeds. Team config `~/.claude/teams/{team-name}/config.json` (deleted at session end); task list `~/.claude/tasks/{team-name}/` (kept; task claiming "uses file locking"). Team name = `session-` + first 8 chars of session ID. — [agent teams](https://code.claude.com/docs/en/agent-teams)
- Display modes `teammateMode`: `in-process` (default), `auto`, `tmux`, `iterm2`; flag `--teammate-mode` (hidden). Hooks `TeammateIdle`, `TaskCreated`, `TaskCompleted` (exit 2 to give feedback/block). Limitations: one team per session, no nested teams, no resumption of in-process teammates. — [agent teams](https://code.claude.com/docs/en/agent-teams)

Channels (research preview):
- MCP server declares `capabilities.experimental['claude/channel']: {}` and emits `notifications/claude/channel` with `params: { content: string, meta?: Record<string,string> }`; the model sees `<channel source="<server>" key="value">content</channel>`. Meta keys must be identifiers or are dropped. Stdio transport. — [channels reference](https://code.claude.com/docs/en/channels-reference)
- "Claude Code doesn't acknowledge notifications"; events from an unregistered channel are dropped silently. "Events queue into the session and are processed in order. If several notifications arrive while Claude is busy, they're delivered together on the next turn". — [channels reference](https://code.claude.com/docs/en/channels-reference)
- Custom channels need `--dangerously-load-development-channels server:<name>`, which shows a confirmation dialog; "If you pass it in non-interactive mode with `-p` or through the Agent SDK, Claude Code ignores the flag and the channel doesn't register." `--channels` accepts only allowlisted plugins (claude-plugins-official). Requires claude.ai or Console API-key auth; managed key `channelsEnabled`, `allowedChannelPlugins`. A server negotiating MCP protocol revision 2026-07-28 is not registered as a channel on the v2 MCP client runtime. — [channels](https://code.claude.com/docs/en/channels); [channels reference](https://code.claude.com/docs/en/channels-reference)
- Permission relay: capability `claude/channel/permission`, outbound `notifications/claude/channel/permission_request` (`request_id` five letters a-z without l, `tool_name`, `description`, `input_preview`), verdict `notifications/claude/channel/permission` `{request_id, behavior: 'allow'|'deny'}`. — [channels reference](https://code.claude.com/docs/en/channels-reference)

Hooks:
- 33 events incl. `UserPromptSubmit`, `PostToolUse`, `PostToolBatch`, `Stop`, `SubagentStop`, `Notification`, `SessionStart`, `TeammateIdle`, `FileChanged`, `MessageDisplay`. — [hooks](https://code.claude.com/docs/en/hooks)
- `Stop`: top-level `decision: "block"` + `reason`, or exit 2, prevents stopping (Claude keeps working); `hookSpecificOutput.additionalContext` also accepted. `PostToolUse` and `UserPromptSubmit` accept `additionalContext`. `Notification` cannot inject context. — [hooks](https://code.claude.com/docs/en/hooks)
- `asyncRewake: true` (command hooks): runs in the background and "wakes Claude on exit code 2", delivering stderr (or stdout) "as a system reminder". — [hooks](https://code.claude.com/docs/en/hooks)
- `SessionStart` output includes `watchPaths` (used with the `FileChanged` event). — [hooks](https://code.claude.com/docs/en/hooks)

Headless / stream-json:
- `--input-format stream-json` (only with `--print`), `--replay-user-messages` re-emits stdin user messages for acknowledgment; `--mcp-config <configs...>`, `--strict-mcp-config` ("Only use MCP servers from --mcp-config"), `--settings <file-or-json>`, `--bare`, `--include-hook-events`. — local: `claude --help` (2.1.306)
- stdin line format: `{"type":"user","message":{"role":"user","content":"Hello"}}`, one per line (named-pipe REPL pattern, 2026-04-11). — [backgroundclaude.com mkfifo REPL](https://backgroundclaude.com/blog/mkfifo-repl)
- Mid-turn stdin: on Claude CLI 2.1.175, a second user message sent about 2 s into a running turn was ignored and produced no follow-up turn; the only programmatic workaround is the `interrupt` control request then resubmit (issue opened 2026-06-13). — [tiann/hapi#888](https://github.com/tiann/hapi/issues/888). Contradicted in part by a report that mid-turn stdin messages were processed but not persisted to the session JSONL (lost on `--resume`). — [claudeissues.com #41230 mirror](https://claudeissues.com/issue/41230-messages-sent-to-stdin-during-active-turn-are-not-persisted-to-conversation-hist)
- With `--mcp-config` and `-p`, Claude Code waits for pending servers up to `MCP_TIMEOUT` (30 s default) before the first turn (v2.1.221+); `system/init` lists `mcp_servers` and `mcp_server_errors` (v2.1.219+). A `-p` session without `--bare` runs the project's `.claude/settings.json` hooks and `.mcp.json` servers "even in a folder you've never trusted". `--bare` skips hooks, MCP auto-discovery, CLAUDE.md, and does not read OAuth credentials. — [headless](https://code.claude.com/docs/en/headless)
- `--brief` enables the `SendUserMessage` tool "for agent-to-user communication". — local: `claude --help`

### Inferences
- Pointing cc-socks at a custom broker: not supported as a setting; the socket location is chosen by Claude Code. Inside the project's bwrap, `--clearenv` removes `XDG_RUNTIME_DIR` and `/run` is not bound, so each sandboxed Claude will (per the docs' fallback) bind its own socket under the sandbox's `/tmp` tmpfs (`/tmp/cc-socks-<uid>`) or run without an inbox; it cannot see host sessions, and host sessions cannot see it unless the controller binds a host dir at that path. This was not probed.
- A controller-side relay could deliver into a sandboxed session's inbox if `policy.tmp` binds a host directory at `/tmp`: the inbox socket then appears on the host, and the broker can connect to it and write JSON lines. That gives Claude's native "between tool calls" delivery and its injection safeguards ("came from another session, can't approve anything") without a hook. Risk: the payload schema is undocumented, so this couples the factory to Claude internals; and messages arrive as unauthenticated-sender peer messages, which the default policy delivers to a prompting session but holds for a bypass-permissions session (set `crossSessionInbound: "accept"` via `--settings`).
- To keep the controller authoritative, deny `SendMessage`/`ListAgents` in sandboxed runs (else the agent might reach sessions the controller does not see — though inside bwrap it can only reach sessions in its own sandbox) and give it broker tools via `--mcp-config <per-run json> --strict-mcp-config`.
- Hook-based inbound that works in both `-p` and interactive: a `PostToolUse` (or `PostToolBatch`) command hook that reads pending messages from the bound socket and returns them as `additionalContext`, plus a `Stop` hook that returns `decision: "block"` with the message as `reason` when mail is waiting, so an otherwise finished agent takes one more turn. An `asyncRewake` hook started at `SessionStart` that blocks on the socket and exits 2 when a message arrives would wake an idle interactive session; it fires once per process, so it must be re-armed. These are inferences from the hook contracts above, not tested.
- Channels would be the most natural push path but are unusable for headless runs and require a dev-flag confirmation dialog for interactive ones during the preview; do not build on them yet.

### Gaps
- The JSON schema a script must write to `CLAUDE_CODE_MESSAGING_SOCKET` (beyond the auth line) is not documented on the page I read.
- Whether `asyncRewake` hooks can be configured on `SessionStart` (vs only tool events) was not confirmed; the docs example uses `PostToolUse`.
- Whether current Claude Code (2.1.306) now steers mid-turn stream-json input: the only empirical test found is on 2.1.175; the sources conflict.
- I did not read the Claude Code changelog line by line; version numbers above come from the docs pages.

## 3. pi coding agent (pi 1.1.0, packaged as @earendil-works/pi-coding-agent)

### Takeaway
pi has first-class mid-run injection: RPC mode (`pi --mode rpc`) takes `steer` and `follow_up` commands, and extensions can call `pi.sendUserMessage(content, { deliverAs: "steer" | "followUp" })` or `pi.sendMessage(...)`, and register model-callable tools with `pi.registerTool()`. A small extension loaded with `-e` can therefore expose `send_message`/`list_agents` tools and hold a connection to the bound broker socket, steering incoming messages into the running session in both headless and interactive (herdr tab) use.

### Cited Findings
- Note: the installed pi 1.1.0 ships as `@earendil-works/pi-coding-agent` (with `pi-mcp`, `pi-agent-core`, `pi-ai`, `pi-tui`), not under badlogic/pi-mono names; the task's "badlogic/pi-mono" reference may be superseded. — local: `~/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/`
- CLI: `--mode <text|json|rpc>`, `-p/--print`, `-e/--extension <path>` (repeatable), `-ne/--no-extensions` (explicit `-e` still works), `--no-mcp`, `--tools`, `--exclude-tools`, `--no-session`, `--session-dir`, `-na/--no-approve` (ignore project-local files), `--offline`. — local: `pi --help`
- RPC: `pi --mode rpc --no-session`; JSONL commands on stdin with optional `id`, `response` records and session events on stdout. `prompt` while streaming requires `streamingBehavior`: `"steer"` ("delivered after the current assistant turn finishes executing its tool calls, before the next LLM call") or `"followUp"` ("delivered only when agent stops"); dedicated `{"type":"steer","message":...}` and `{"type":"follow_up","message":...}` return `data.disposition` `"queued"` or `"handled"`; `clear_queue`; `set_steering_mode` `"all"` | `"one-at-a-time"` (default). — local: pi docs/rpc.md, docs/rpc-commands.md
- Extension API: `pi.registerTool()`, `pi.registerCommand()`, `pi.registerFlag()`, `pi.sendUserMessage()`, `pi.sendMessage()` ("Custom content stored and sent to the model"), `pi.appendEntry()` ("Durable data excluded from model context"), `pi.registerMcpServer()`; events include `session_start`, `session_shutdown`, `before_agent_start`, `turn_end`, `agent_before_settle` (can "append entries and request one continuation" via `continue: true`), `agent_settled`, `tool_call` (can block), `tool_result`. — local: pi docs/extensions.md lines 59-117, 229-230
- Signatures: `sendUserMessage(content, { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean })`; `sendCustomMessage(message, { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" })`. — local: pi dist/core/agent-session.d.ts lines 592-615
- MCP: stdio or streamable HTTP; `~/.pi/agent/mcp.json`, `.pi/mcp.json`; `pi mcp add <name> -- <cmd>`. — local: pi docs/mcp.md
- herdr already installs a pi extension at `~/.pi/agent/extensions/herdr-agent-state.ts` (`HERDR_INTEGRATION_VERSION=8`) that writes newline JSON to `HERDR_SOCKET_PATH` with `node:net` to report state. Inside the bwrap sandbox that socket is absent, so this extension silently no-ops (`enabled()` needs `HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_PANE_ID`). — local: ~/.pi/agent/extensions/herdr-agent-state.ts
- pi's container guide warns: "Do not mount the host's `~/.pi/agent` unless the container should have access to your host Pi configuration and credentials." — local: pi docs/containerization.md line 70

### Inferences
- The herdr extension is a ready template for a broker extension: same `node:net` newline-JSON client, pointed at the bound broker socket instead of herdr's.
- For headless pi the controller can skip the in-sandbox shim entirely: it already owns pi's stdin in RPC mode, so it can send `steer` itself. That makes the controller the only writer, which fits "controller decides state". Outbound still needs a tool (extension or MCP) that the agent calls.
- For interactive pi in a herdr tab, the extension is the only clean inbound path (herdr typing would race the user's typing).

### Gaps
- I did not read `docs/sdk.md`/`json.md` fully; the exact event names emitted when a steer is consumed were not captured.
- Whether `pi.sendUserMessage` from an extension marks the message as non-user (for injection hygiene) was not determined; pi has no documented equivalent of Claude's "came from another session" framing.

## 4. herdr (0.9.5): delivering into an interactive agent's tab from outside the sandbox

### Takeaway
The controller, running outside the sandbox with herdr access, can push a message into an interactive agent with `herdr agent prompt <name> <text> [--wait --until ... --timeout ms]`; the agent never needs herdr access. This is keystroke injection: it is rejected while the agent is `blocked`, cannot be told apart from the owner's typing, and lands only at the agent's input box (queued by the CLI). It suits "controller relays a message" but not authenticated provenance; use it as a doorbell ("Read <path>") rather than for message bodies.

### Cited Findings
- `herdr agent` subcommands: `list, get, read, send-keys, prompt, rename, focus, wait, attach, start, explain`. `herdr pane` includes `send-text`, `send-keys`, `run`, `wait-output`, `report-agent`, `report-agent-session`, `release-agent`, `report-metadata`. — local: `herdr agent --help`, `herdr pane --help`
- `herdr agent prompt <TARGET> <TEXT> [--wait] [--until idle|working|blocked|done|unknown] [--timeout <MS>]`: "If the agent is already blocked, submission is rejected with agent_blocked before any input is sent"; with `--wait` it requires observed working or blocked within 5000 ms, else `agent_prompt_stalled`; "It does not track turns". — local: `herdr agent prompt --help`
- `agent prompt` "honors the pane's live bracketed-paste mode and sends text followed by encoded Enter as one ordered submission"; "A timeout or stalled response does not prove the prompt was never delivered; do not blindly submit it again." — local: `herdr --skill`
- `herdr notification show <TITLE> [--body] [--position] [--sound none|done|request]` shows a notification to the human, not to the agent. — local: `herdr notification show --help`
- `herdr --remote <ssh-target>` attaches through SSH; `herdr --machine <label-or-id> <command>` forwards API commands to a saved SSH machine; IDs and agent names are scoped per server. — local: `herdr --help`; `herdr --skill`
- The project's prototype already delivers prompts this way from outside the sandbox and records the prompt as a file in the run dir. — local: proto/herdr-adapter.ts lines 42-87
- The herdr socket is `~/.config/herdr/sessions/<name>/herdr.sock`; herdr exposes it to panes via `HERDR_SOCKET_PATH`. — local: proto/herdr.ts line 2; ~/.pi/agent/extensions/herdr-agent-state.ts

### Inferences
- Because Claude Code queues typed input during a turn and pi queues editor input as steer/follow-up, `herdr agent prompt` effectively gives turn-boundary delivery for interactive runs; the herdr docs warn it does not track turns, so the broker should record "offered at seq N" and confirm consumption from the agent side (tool call or hook), not from herdr.
- A safer interactive pattern: the broker writes the message into the run's read-only inbox and sends a fixed doorbell string via `herdr agent prompt` ("New message 17 in /run/sf/inbox; read it with the read_messages tool"). The doorbell text carries no untrusted content, so a hostile sibling cannot inject arbitrary keystrokes through it.
- O-010 for interactive tabs: since the owner types directly into the tab, the factory cannot capture that answer from herdr reliably (`agent read` is a screen scrape). The capture point must be the agent's own transcript (Claude session JSONL, pi session file) or an agent tool call ("record_owner_answer") that the broker turns into an event.

### Gaps
- I did not find documentation of herdr's socket API method names beyond the CLI; `herdr api` subcommands were not explored.
- No herdr feature found that forwards a message to an agent with sender metadata.

## 5. Recording: messages as events in the controller's append-only store

### Takeaway
Make the broker write every accepted message as an event row in the existing store before delivery (sender run ID derived from the socket, recipient, cycle ID, the sender's current head SHA when known, body hash and body file), and give reviewers a rendered thread per cycle. This also answers O-010: an owner's answer becomes an event (`note` from the owner, or a reply recorded by the broker), bound to the cycle and the head it was given against. Prior art (agent-teams mailboxes, mcp_agent_mail, A2A) all keep messages as durable, addressable records with thread/context IDs; none bind to commit SHAs.

### Cited Findings
- Claude agent teams keep per-recipient JSON mailbox files and report a send only after the write succeeds; malformed entries are reported and removed on read. Team config is deleted at session end; task lists persist (cleanup by `cleanupPeriodDays`). — [agent teams](https://code.claude.com/docs/en/agent-teams)
- Claude cross-session messages appear to the user as a one-line preview `› Message from @api-worker: ...` and in full in the transcript viewer; held messages are capped at 100. — [cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- mcp_agent_mail stores per project a Git repo of human-auditable artifacts (`projects/<slug>/agents/`, `messages/YYYY/MM/`, `file_reservations/`, `attachments/`) plus SQLite FTS5 for search; messages are GitHub-flavoured Markdown with `---json` frontmatter (`thread_id`, `from`, `to`, `importance`, `ack_required`, attachments); replies inherit `thread_id`; a web UI at `/mail` shows inboxes, threads and reservations, and a "Human Overseer" composer sends high-importance messages. The Python version is marked superseded by a Rust version. — [mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail)
- A2A 1.0.0: `Task` (`id`, `contextId`, `status`, `artifacts`, `history`, `metadata`); states `SUBMITTED, WORKING, COMPLETED, FAILED, CANCELED, REJECTED, INPUT_REQUIRED, AUTH_REQUIRED`; `Message` (`messageId` set by the creator, `role` USER/AGENT, `parts`, optional `taskId`, `contextId`, `referenceTaskIds`); "Results SHOULD BE returned using Artifacts"; the agent decides which messages enter `history`; streaming via SSE; push notifications by HTTP POST to a registered URL. A2A moved to the Agentic AI Foundation (announcement dated 2026-08-27). — [A2A specification](https://a2a-protocol.org/latest/specification/)
- Project: the store already deduplicates events from outside a run by `commandId`, keeps a store-wide position `pos`, and observers may send `note` with a per-observer cursor. — local: docs/decisions.md lines 179, 188, 467

### Inferences
- Event shape that fits the project: `message_sent { cycleId, fromRun, toRun|toRole|owner, seq, inReplyTo?, head?, bodySha256, bodyPath, commandId }` written by the broker (the controller) when it accepts; `message_delivered { seq, toRun, via: hook|steer|herdr|inbox }` when the recipient side confirms (tool call or hook ran). The agent's text is a claim; who sent it and when is the controller's fact.
- SHA binding: the broker can record the sender's worktree `HEAD` at send time (it knows the run's worktree path), so a reviewer at SHA X sees only messages sent at or before X. A2A's `contextId`/`taskId` map to cycleId/runId; `referenceTaskIds` maps to `inReplyTo`.
- Reviewers get the ticket, diff, SHA and test output, never the implementer's transcript (AGENTS.md). Messages are part of the implementer's interaction, so a policy choice is needed: include messages whose `head` ≤ reviewed SHA as evidence (answers O-010), or only messages marked as decisions. This is a decision for the owner.
- Bodies should be stored as files with a hash in the event (A-109 pattern for outputs) and never interpolated into argv.

### Gaps
- No prior-art system found that binds messages to commit SHAs.
- I did not read the mcp_agent_mail Rust successor's README.

## 6. Prior art: multi-agent coding tools

### Takeaway
Most orchestrators (claude-squad, Conductor, Vibe Kanban, ccmanager, Crystal) isolate with git worktrees on the host and have no agent-to-agent messaging; Sculptor uses containers. mcp_agent_mail is the main purpose-built messaging layer (HTTP MCP, Git+SQLite, advisory file leases with a pre-commit guard), and Claude Code's own agent teams use file mailboxes plus a file-locked task list. None of the tools found combine a sandbox per agent with a broker that authenticates the sender by channel.

### Cited Findings
- Conductor, Crystal, Claude Squad and Vibe Kanban use git worktrees that "share your machine and your environment"; Sculptor runs each agent in its own Docker environment; Claude Squad is a Go TUI managing a tmux session and worktree per agent; Vibe Kanban was shut down by Bloop and is community-run. Source is a competing vendor's comparison post (2026). — [AgentsRoom: best multi-agent coding tools](https://agentsroom.dev/blog/best-multi-agent-coding-tools)
- mcp_agent_mail file reservations: advisory leases on paths or globs, exclusive or shared, with TTL; overlapping exclusive leases are reported as conflicts but still granted; optional pre-commit hook blocks commits conflicting with others' active exclusive reservations, identifying the agent via `AGENT_NAME`. Tools: `register_agent`, `send_message`, `reply_message`, `fetch_inbox`, `acknowledge_message`, `search_messages`, `summarize_thread`, `file_reservation_paths`, `release_file_reservations`, `macro_start_session`, `macro_contact_handshake`; cross-project messaging needs AgentLink approval. Its README does not address sandboxing. — [mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail)
- Claude agent teams: task claiming "uses file locking to prevent race conditions"; "Two teammates editing the same file leads to overwrites". — [agent teams](https://code.claude.com/docs/en/agent-teams)
- pi documents Plain Docker, Docker Sandboxes (provider credentials stay on host, substituted by a proxy) and OpenShell as isolation options. — local: pi docs/containerization.md lines 11-13

### Inferences
- File leases are less needed here: each cycle has its own clone (A-126) and the controller merges nothing automatically; leases matter only if pools let two developer runs share a checkout, which A-126's per-run overlay avoids.
- mcp_agent_mail's "Human Overseer" message (high importance, pause-and-prioritize preamble) is a useful pattern for owner messages; its sender identity-by-argument is the weakness a per-run socket removes.

### Gaps
- I did not find primary docs on messaging (if any) in Conductor, Sculptor, ccmanager or Claude Code Agent Farm; the only source covering them is a vendor comparison, which says nothing about messaging.
- Vibe Kanban's shutdown is reported only by that vendor post; not confirmed from a primary source.
