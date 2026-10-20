# Security model and sandboxing: foundations review (slug: security)

Reviewed on main at `42f174e`, 2026-10-20. Read only. Probes ran through the factory's own `wrap()` in a detached worktree (now removed), plus `pasta` and `unshare` by hand. Probe script: `/var/tmp/software_factory/research-foundations/security/probes/p1.ts`. No paid CLI ran, and nothing under `~/.claude` or `~/.pi` was read.

The first pass (`docs/research/2026-10-20/security.md`) found bugs. This pass judges the design. It does not repeat those five findings; all five are fixed or decided (A-095, A-101, A-099, A-106, A-100).

## 1. Short answer

- **Sound:** the core shape is right, and it matches what the better systems do. The controller decides and agents only claim. Whole-process isolation puts the CLI and its tools inside the boundary, which is stronger than Claude Code's and Copilot's Bash-only boundaries. The repository layer cannot loosen the sandbox or give grants, and grant secrets stay out of agent sandboxes. No merge is automatic, and reviewers read the instructions from the base.
- **Wrong, part 1: the threat model.** A-037 ranks "an agent going outside its remit" above "malice", and treats malice as rare. Prompt injection breaks that ranking. A developer that reads a dependency's README, an `npm install` postinstall script, or (from row 12) a GitHub issue can be turned hostile without anyone writing malicious code. Every developer run today holds all three legs of Willison's "lethal trifecta": untrusted input, private data and full network.
- **Wrong, part 2: what a run can reach.** Every claude run binds all of `~/.claude` read-only, so it can read the owner's login and every other project's Claude transcripts. Every pi run can read and rewrite pi's login. And every run has the whole network.
- **Wrong, part 3: A-106 alone does not close the network hole.** I probed `pasta` with host loopback unmapped, as A-106 plans. 127.0.0.1 was closed. But the host's PostgreSQL on 0.0.0.0 was still open through the Docker bridge address 172.17.0.1, SSH through 172.18.0.1, and the LAN router at 192.168.1.1. A-106's planned test (a server on 127.0.0.1) would pass while these stay open.
- **Change first:** (1) Send all egress through a proxy the controller runs. The sandbox gets no network of its own. The proxy holds an allow list, checks resolved addresses and keeps a log. (2) Keep credentials outside the sandbox. Use a dedicated, revocable factory credential that the proxy injects, and stop binding `~/.claude` and `~/.pi`. (3) Make repository workflows data only (A-111), and add a default check that escalates when a candidate edits files other tools execute (`.factory/`, `.claude/`, `.vscode/`, CI workflows, `package.json` scripts). (4) Add resource limits and a stop-everything command. (5) Write a one-page threat model.
- **Keep:** bubblewrap as the first backend (D-019), with cheap hardening: `--disable-userns`, a seccomp filter later, and per-run memory and process limits. MicroVMs and gVisor are a later backend behind the same seam, not a reason to switch now.

## 2. What we have

### Trust map, as the code builds it today

| Actor | Trusted? | Where it runs | What it can reach | Evidence |
| --- | --- | --- | --- | --- |
| Owner | yes | host | everything | — |
| Controller (`src/`) | yes | host, owner UID, unsandboxed | owner repo, store, all config, grant files | `src/main.ts`, `src/config.ts` |
| Personal and job config layers | yes | read by controller | can set sandbox, grants, runtimes | `src/config.ts:115-118` |
| Repository layer at base | partly | read by controller; its workflow module is **imported into the controller** | `checks`, `workflow`, `runtime` only | `src/config.ts:114`, `:168-185`, `:285` |
| Developer agent (claude or pi) | no | bwrap, network on, own clone writable | clone; CLI binary dir; `~/.claude` + `~/.claude.json` read-only (claude) or `~/.pi` overlay + `auth.json` writable (pi); `/usr /etc /opt`; whole network | `src/runtime/cli-adapter.ts:100-103`, `:216`, `:238`; `src/sandbox.ts:42`, `:85` |
| Reviewer agents | no | bwrap, network on, checkout read-only | same config binds; read-only tools (claude `Read Glob Grep`, pi `read,grep,find,ls`) | `cli-adapter.ts:331-341` |
| Candidate code (checks, command stages) | no | bwrap, network off unless the stage asks | checkout writable, own evidence `output/` | `src/verify.ts:206` |
| Grant stage | half | bwrap, network on, secret in env, **cwd is the candidate checkout** | token + network + candidate files | `src/verify.ts:147-157`, `:206-207` |
| Extension runtime | owner's code, run as untrusted | bwrap, network on, module dir bound | as a runtime | `cli-adapter.ts:265-285` |
| Observers | owner's code | host, unsandboxed, started by the owner | the store (read), owner commands with a free-text `--source` | `src/lifecycle.ts:130` ("A label, not an identity") |
| The CLIs' vendors (claude, pi binaries) | trusted by necessity | inside the sandbox for runs; on the host when the owner uses them | — | `cli-adapter.ts:88-92` |

### What it does well

- **The controller decides; agents claim.** `apply` alone changes state, and a claim is checked against git before it counts (`src/developer.ts:168-190`). This is the "plan-then-execute / action-selector" shape that the prompt-injection design-patterns paper recommends (arXiv 2506.08837): the injected agent's only output is a claim, a verdict or a commit, never a state change.
- **Whole-process isolation.** The CLI, its tools, its hooks and its MCP servers all run inside bwrap. Claude Code's own sandbox covers "shell commands only. Claude's file tools, MCP servers, and hooks run outside it" (code.claude.com/docs/en/sandboxing). GitHub's agent firewall "only applies to processes started by the agent via its Bash tool". The factory's choice is stronger than both.
- **The candidate never steers the controller's git.** Verify checks out the stored bytes with no `.git` and no attributes (`src/verify.ts:318-343`). The clone's git runs only sandboxed (`developer.ts:250-256`), and the fetch uses `fsckObjects`. The CodeRabbit RCE (2025) came from running a linter on the PR's own `.rubocop.yml` outside the sandbox, with the app's private key in the environment. The factory runs candidate config only inside a sandbox with no secrets.
- **Owner-only security keys.** The repository layer cannot set `sandbox` or `grants`, by allow list (`config.ts:110-123`). Claude Code takes the same line: project settings "can't" turn filesystem isolation off, and `mask` credentials are honoured only from user, managed or CLI settings.
- **Grants follow the Symphony rule.** Symphony's SPEC §15.3 says to keep tracker credentials host-side and out of the agent's environment. Grants do the same: the value comes from a file, reaches one stage through the spawn environment and never argv, is refused under `none`, and is redacted from evidence (`verify.ts:147-209`).
- **Reviewer prompt hygiene.** Nonce-delimited sections (`src/prompt.ts:84-95`), instructions read from the base (A-100), no developer transcript, read-only tools, `--restricted`, `--strict-mcp-config`, and pi's `--no-context-files`.
- **Process containment.** Each run lives in a systemd scope and is killed through `cgroup.kill`, so a `setsid` child cannot escape the cancel (`src/runtime/spawn.ts:104-129`).

## 3. What we don't have

Each gap names the situation in which it fails.

1. **No threat model document.** A-037 records one sentence of the owner's view. Nothing lists the assets (logins, grant tokens, the repo and its history, LAN services, model spend), the actors or the boundaries. *Fails when:* each ticket weighs a finding against a different, unstated threat. 10-e's design note named the right risks, but its acceptance of them was not checked against a shared list.

2. **No egress control.** Network is all or nothing (`sandbox.ts:85`; `cli-adapter.ts:102` sets `network: true` for every runtime). *Fails when:* a pi developer runs `npm install`, and a malicious postinstall script reads `~/.pi/agent/auth.json` and posts it out. That is the s1ngularity attack of August 2025, which also went looking for local AI CLIs. Exfiltration over DNS (Claude Code CVE-2025-55284) needs nothing but a resolver.

3. **A-106 (pasta) leaves the host's other addresses and the LAN open.** Probe, with `pasta --config-net --no-map-gw`:
   ```
   127.0.0.1:631 closed     127.0.0.1:5432 closed    192.168.1.178:5432 closed
   172.17.0.1:5432 open     172.18.0.1:22 open       192.168.1.1:80 open
   ```
   PostgreSQL listens on `0.0.0.0:5432` and `:5433` here (`ss -ltn`). `pasta --help` has no option to filter destinations. *Fails when:* a networked sandbox connects to the owner's database through the Docker bridge address, or to the router's admin page. A-106's planned test, a server bound to 127.0.0.1, passes anyway.

4. **The agents' own credentials are inside the boundary.** Claude runs bind all of `~/.claude` and `~/.claude.json` read-only (`cli-adapter.ts:216`). By 08-c's findings, that directory holds `projects/` session data for every project on the machine. pi runs get `~/.pi` as an overlay plus a writable `auth.json` (`:238`, A-068). *Fails when:* an injected developer or reviewer reads the owner's subscription login, or transcripts of unrelated private work, and sends them out. With a domain allow list alone, the model API is the way out: Rehberger's "Claude Pirate" (Oct 2025) uploaded data through `api.anthropic.com`'s Files API **with the attacker's key**, so an allow list that admits the API host does not stop it.

5. **A grant stage runs with its token in a directory the candidate wrote** (`verify.ts:206`: `cwd: worktree`). 10-e's note says so ("`npm publish` reads `.npmrc`"), but the code cannot prevent it, and there is no option to run a grant stage without the checkout. *Fails when:* the merge command is a tool that reads per-directory config (`npm`, `gh` extensions, `git` with an `includeIf`, `.envrc` under direnv).

6. **The token is released on an LLM's PASS.** The head gate needs "at least one PASS verdict" (`verify.ts:121-130`). It does not need a human. Observers may run `accept` (A-074 Q6a), and `--source` is a label anyone can type. *Fails when:* a workflow puts a grant stage after a human stage (once row 11 or 12 drives it), and an observer that auto-accepts "comment-only" changes is itself an LLM reading the diff. Then every gate between candidate text and a token is an LLM. The judge literature says LLM judges can be injected (attack success up to 73.8% in arXiv 2504.18333, with code review the most resistant task), and the design-patterns paper calls LLM detection "fundamentally heuristic".

7. **Candidate edits to executable configuration reach the owner unflagged.** A candidate may edit `.factory/config.json` and its workflow module. Once merged, that module is imported into the controller unsandboxed on the next run (accepted risk A-078; A-095 checks only that the base is merged). The same holds outside the factory: `.claude/settings.json` hooks, `.mcp.json`, `.vscode/tasks.json`, `.envrc` and `.github/workflows/*` all run as the owner once merged and opened. This is the "Configuration-Based Sandbox Escape" class: Claude Code CVE-2026-25725 (sandboxed code created a missing `settings.json` with hooks that ran on the next start), Cursor CurXecute CVE-2025-54135 (an agent edit of `mcp.json` executed at once), and the IDEsaster disclosures (Dec 2025, 24+ CVEs). Copilot's answer: "workflows are not triggered until Copilot cloud agent's code is reviewed" by a human with write access. *Fails when:* a reviewer passes a small change that also edits `.factory/workflow.ts`, and the owner accepts by SHA without reading that file.

8. **The owner is handed a developer-controlled `.git`.** `main.ts:192` prints `Worktree: <runsDir>/<cycleId>`, the developer's clone. The developer can write that clone's `.git/config` and `.git/hooks`: claude's allow list has `Write(/<worktree>/**)` plus `git commit`, and pi has bash. A `core.fsmonitor` or `core.pager` there runs as the owner, unsandboxed, the first time the owner types `git status` or `git log` in it. Claude Code's sandbox write-protects exactly these paths ("hooks and config inside .git", and the files that turn a directory into a bare repository). *Fails when:* the owner `cd`s into the printed path to look at the work, which the output invites.

9. **No resource limits.** `systemd-run --user --scope` is called with no `-p` limits (`spawn.ts:106`). Probe: a scope has `memory.max=max`. It inherits only the parent slice's limits, which depend on where the controller was started (20 GiB here, because this session runs in a `claude.slice`). Checks get `--tmpfs /tmp` with no `--size` (`sandbox.ts:95`), which is RAM. `runsDir` is on `/`, which is 92% full (39 GB free). *Fails when:* a check or a developer fills RAM through `/tmp`, fork-bombs up to 38 350 pids, or fills the root filesystem through its clone or its run `/tmp`. The owner's desktop then fails, not just the cycle.

10. **The kernel attack surface is wide open.** Probe: inside a factory sandbox, `unshare -Ur` gives uid 0 in a nested user namespace, and `unshare -Urn` makes a network namespace. `io_uring_disabled=0`. There is no seccomp filter (`sandbox.ts:79-106`). Google's kCTF review (June 2023, as quoted by the AppArmor wiki) found 44% of submitted kernel exploits needed unprivileged user namespaces. bwrap 0.13 has `--disable-userns` and `--seccomp FD`. *Fails when:* an injected agent runs a public kernel LPE. That is a less likely adversary for this owner, but the cost of closing most of it is one flag.

11. **No record of what happened inside a run.** Claude runs with `--no-session-persistence`, nothing keeps stdout beyond the parsed claim (a plan gap since A-087), there is no egress log, and the sandbox policy a run had is not recorded. *Fails when:* the owner suspects a leak and cannot tell which run read what, or where it connected. The source design (§12) asks for "append-only state-transition history with actor, evidence, head SHA, policy version".

12. **No global stop.** `cancel` takes one work ID. Nothing stops every run, refuses new ones, or says which credential to revoke. Source §12 asks for "pause, cancel, quarantine and global shutdown".

13. **The store has no integrity beyond file permissions.** Any owner-UID process can rewrite `events.sqlite`: observers, the owner's interactive agents (including sessions like this one) and anything under `sandbox: none`. No sandboxed process can reach it today, which is the property that matters most. But nothing would detect an edit.

14. **The developer sees more than its task.** `git clone --no-hardlinks` copies every branch of the owner's repository (`developer.ts:198`), including unmerged private branches and other cycles' `sf/*` branches. *Fails when:* a private branch holds a secret, or a design the ticket has no need for, and an injected developer sends it out.

15. **Row 12 will feed third-party text to the developer.** A GitHub issue becomes the ticket. Copilot accepts a task only from "users with write access", ignores other users' comments, and "filters hidden characters". Nothing in the plan says who may author a ticket. The "Comment and Control" disclosure (April 2026) hijacked Anthropic's, Google's and GitHub's agents through PR titles and issue bodies.

## 4. What others do

| System | Relevant design | Source | Verdict |
| --- | --- | --- | --- |
| Anthropic sandbox-runtime (`srt`), Claude Code's Linux sandbox | bwrap; the network namespace is "removed entirely"; HTTP and SOCKS5 proxies on the host, reached through bind-mounted Unix sockets; domain allow list; **resolved-address check** that drops loopback, link-local, metadata and host addresses; seccomp blocks Unix sockets and namespace creation (`unshare`, `setns`, `mount`) | github.com/anthropic-experimental/sandbox-runtime README | **Adopt** the proxy shape and the resolved-address check. **Adapt** the seccomp part: needs a BPF program without libseccomp (see P6) |
| Claude Code sandbox | Protected paths stay read-only inside writable roots: `.claude` settings, `.mcp.json`, `.vscode`, `.gitconfig`, `.git/hooks` and `.git/config`, bare-repo files (`HEAD`, `objects`, `refs`). Credential `mask` mode: a sentinel in the sandbox, the real value injected by the proxy only for `injectHosts`, honoured only from user, managed or CLI settings. Its documented limits: domain fronting, broad domains like `github.com`, no TLS inspection by default | code.claude.com/docs/en/sandboxing (Protected paths, Mask credentials, Security limitations) | **Adopt** the protected-paths list for the clone (P11) and the mask idea (P2). **Avoid** its scope: Bash only |
| Claude Code incidents | CVE-2025-66479 (empty allow list disabled the proxy), SOCKS5 null-byte hostname bypass of a wildcard allow list (fixed ~v2.1.90, no CVE), CVE-2026-25725 (settings.json created from inside the sandbox ran hooks on the next start), CVE-2025-55284 (DNS exfiltration through allow-listed `ping`/`nslookup`) | oddguan.com posts; advisories.gitlab.com CVE-2026-25725; embracethered.com | **Learn:** fail closed when the policy is empty; parse hostnames strictly; protect files that run outside the sandbox later; no DNS inside the sandbox |
| Claude Code on the web | Credentials "never inside the sandbox"; git goes through a proxy that swaps a scoped credential for the real token and allows pushes only to the working branch; operations logged | anthropic.com/engineering/claude-code-sandboxing; code.claude.com/docs/en/security | **Adapt** for row 12: a push or merge goes through a controller-side check, not a raw token in a stage |
| OpenAI Codex CLI | bwrap on Linux (Landlock kept as legacy), Seatbelt on macOS; `.git` and `.codex` read-only inside writable roots (PR #1765, #8088). CVE-2025-59532: a model-chosen `cwd` became the writable root; fixed by tying the boundary to the session start | learn.chatgpt.com/docs/sandboxing; sentinelone CVE-2025-59532 | **Confirms** D-019 (bwrap, not Landlock). **Learn:** the writable root is the controller's choice, never the model's. The factory already does this |
| Codex cloud | Secrets "are only available to setup scripts" and "removed before the agent phase starts"; agent-phase internet off by default; allow list of domains **and HTTP methods** | learn.chatgpt.com/docs/environments/cloud-environment | **Adopt** the two phases: a setup or prefetch stage with network and no agent, then an agent stage with only the model API |
| GitHub Copilot coding agent | Only users with write access can assign; hidden characters filtered; one branch; cannot approve or merge; the requester cannot approve; Actions workflows wait for human approval; a firewall on the Bash tool only, with "sophisticated attacks may bypass" in its own docs; signed commits that link to session logs | docs.github.com …/risks-and-mitigations; …/customize-the-agent-firewall | **Adopt** ticket provenance and "executable config needs a human" (P3, P10). **Adopt** a run log per commit (P8). **Avoid** a Bash-only firewall |
| Symphony (OpenAI) | §15.3: tracker tools run in the host process with the credential; adapters declare secret env names so launchers strip them; §15.2 recommends "a dedicated OS user" | `repos/openai_symphony/repo/SPEC.md:1719-1790` | **Confirms** grants. **Adopt** the dedicated-user idea (P7) |
| Pi | "Watching the transcript, using project trust, and reviewing changes do not create a security boundary"; whole-process isolation called "usually the strongest practical option"; Docker Sandboxes keep the provider credential on the host and swap a placeholder at the proxy; `PI_CODING_AGENT_DIR` and `httpProxy`/`HTTPS_PROXY` (undici `EnvHttpProxyAgent`) are supported | `repos/pi/src/packages/coding-agent/docs/security.md:1-25`, `containerization.md:82-110`; `src/core/http-dispatcher.ts:49,87`; `src/config.ts:585` | **Adopt:** pi can run behind a proxy with its own agent dir, so P1 and P2 are feasible for pi (verified in source, not run) |
| Docker Sandboxes (`sbx`), NVIDIA OpenShell | Placeholder credential inside; real token substituted only for the configured host; inference routing keeps raw model keys outside | docs.docker.com/ai/sandboxes/security/credentials | **Adopt** the pattern (P2), not the product (Docker's daemon is root here) |
| OpenHands | Docker runtime; docs warn that nothing stops the agent from changing mounted files, and that the default binds all interfaces; an LLM "security analyzer" rates actions (third-party coverage) | docs.openhands.dev/usage/architecture/runtime | **Avoid** an LLM analyzer as a boundary; at most an audit signal |
| E2B, Daytona, Modal, Jules, Cursor cloud agents, Devin | Firecracker microVMs (E2B), gVisor containers (Modal), one VM per task (Jules, Cursor); all keep network on for dependencies; Cursor and Devin put secrets in the VM through a secrets store, and vendors warn that snapshots freeze tokens | e2b.dev; cursor.com/help/ai-features/background-agents; docs.devin.ai | **Avoid for now** (A-035: no VMs, local only). The lesson that carries over: a VM with open network and keys inside "is still a disaster"; isolation strength matters less than egress and credentials |
| gVisor `runsc do --rootless` | User-space kernel, no daemon; `--rootless` is "mainly only suitable for runsc do" | gvisor.dev/docs/user_guide/rootless | **Later backend** behind `BACKENDS` if kernel exposure ever becomes the main risk |
| Landlock (ABI 4 TCP, ABI 6 abstract-socket and signal scoping, kernel 6.12+) | In-kernel, unprivileged, layerable | LKML scoping patches | **Avoid as a primary layer:** needs a helper binary (zero-deps rule), and `--unshare-net` already scopes abstract sockets |
| firejail | setuid-root launcher with a record of local root CVEs | — | **Avoid** |
| nsjail, minijail | seccomp and cgroup limits in one tool (Google kCTF uses nsjail) | — | **Avoid the dependency**; bwrap + systemd properties cover it |
| CodeRabbit (Kudelski, Jan 2025) | A PR's `.rubocop.yml` made the linter load attacker Ruby outside the sandbox; the environment held the GitHub App private key | kudelskisecurity.com research post | **Confirms** checks only in the sandbox, and no secrets in check environments |
| Amazon Q extension (July 2025) | A merged PR shipped a wiper prompt; the cause was "an inappropriately scoped GitHub token" in CI | aws security bulletin, scworld coverage | **Learn:** a human merge of agent-adjacent text is the last gate; flag prompt-like content in executable config (P3) |
| Lethal trifecta (Willison), CaMeL, design patterns paper | Avoid private data + untrusted content + external communication in one agent; constrain an agent after it reads untrusted input; LLM detection is heuristic | simonwillison.net/2025/Jun/16/the-lethal-trifecta; arXiv 2503.18813, 2506.08837 | **Adopt as the threat-model rule:** remove one leg per run. Egress (P1) and credentials (P2) are the two the factory can remove |
| Spotlighting (Microsoft) | Delimiters are the weakest of three methods; datamarking or encoding cut attack success further | arXiv 2403.14720 | **Keep** nonce delimiters; do not expect more from prompt wording. Encoding a diff would hurt review quality |

## 5. Ranked proposals

### P1. All egress through a controller proxy; no network inside the sandbox

- **What:** every networked sandbox runs with `--unshare-net`. The controller starts one HTTP CONNECT proxy per run (`node:net`, zero dependencies), listening on a Unix socket bound into the sandbox, with `HTTPS_PROXY` pointing at it through a small in-sandbox bridge, as `srt` does with socat. The proxy allows hosts from a per-runtime list, resolves names itself (no DNS inside), refuses any address that is loopback, link-local, RFC 1918, a Docker bridge or the host's own, and writes one log line per connection to the run's folder.
- **Decision implied:** the network policy is a host allow list per runtime and per stage, set only in the personal or job layer. The default lists hold the model API hosts and nothing else. `network: true` on a command stage names hosts.
- **Cost:** L. Widens A-106 (pasta becomes unneeded, or stays only as a fallback for a stage that needs raw TCP), reverses D-021's "full network access", and unparks the 08-a proxy line. Needs probes: claude honours `HTTPS_PROXY` (documented, unverified here); pi does (`http-dispatcher.ts:49,87`). The socat-like bridge must be written in Node, or the socket bound at a TCP port through a tiny in-sandbox helper.
- **Buys:** closes gap 2 and gap 3 (probe above), DNS exfiltration and the LAN. It gives an egress log for free (gap 11) and a place to enforce P2.
- **Impact 5. Confidence high** on the need (probed), medium on effort (the in-sandbox bridge is the unknown).
- **A-113 fit:** the proxy and the per-connection hook are core capabilities. The allow list is policy in config, and an extension could decide per connection (the "ask callback" in `srt`).

### P2. Credentials outside the sandbox: a dedicated factory credential, injected by the proxy

- **What:** stop binding `~/.claude`, `~/.claude.json` and `~/.pi` into runs. Give each run an empty config dir (`CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`) and a placeholder token. The proxy replaces the `Authorization` (or `x-api-key`) header with the real factory credential, only for the model host, only on allowed paths (for example `POST /v1/messages`, not `/v1/files`). It also **drops any credential the sandbox supplied**, which defeats the attacker-key upload Rehberger showed. A smaller first step without P1: a factory-only key or a `claude setup-token` token passed through the spawn environment (as grants are), still not the owner's interactive login.
- **Decision implied:** the factory runs on its own revocable credential with its own spending cap, not on the owner's subscription login. That is an owner decision about money and accounts.
- **Cost:** M for the env-token step; L with injection (needs TLS termination, and then a CA the CLIs trust, or the CLI pointed at a plain-HTTP base URL on the proxy, which then speaks TLS upstream). Reverses D-021's "can read their own CLI's credentials" and supersedes A-068.
- **Buys:** an injected agent cannot steal the owner's login, cannot read other projects' transcripts, and cannot send data to an attacker's account through the model API. The kill switch becomes "revoke one key". A-068's overwrite risk disappears.
- **Impact 5. Confidence medium:** whether the claude CLI accepts a plain-HTTP `ANTHROPIC_BASE_URL` with a placeholder token, and how pi's OAuth refresh behaves behind a placeholder, are not verified. API-key auth avoids the refresh problem.
- **A-113 fit:** "credential broker" is a core capability; which credential, and for which hosts, is owner config.

### P3. Executable configuration in a candidate needs the owner, not just a reviewer

- **What:** two parts. (a) Do A-111's "repository workflow must be data" now, ahead of the other "soon" items. That is the only path from candidate text to unsandboxed code in the controller. (b) Ship a default command stage, `protected-paths`, that reads `diff.patch` and FAILs (or, after A-109, files a `needs_owner` finding) when the candidate touches files other tools execute: `.factory/**`, `.claude/**`, `.mcp.json`, `.pi/**`, `AGENTS.md`/`CLAUDE.md`, `.vscode/**`, `.idea/**`, `.envrc`, `.github/workflows/**`, `.gitattributes`, `.gitmodules`, `package.json` `scripts`, `Makefile`. The owner keeps the list in config.
- **Decision implied:** the default workflow gains a check stage; the owner's acceptance of such a change is explicit.
- **Cost:** S for (b), which is an ordinary command stage with a `{ file }` script (A-107 already named "an example protected-path check"). S–M for (a), already planned. Closes the A-078 accepted risk.
- **Buys:** closes gap 7. This is the factory's version of Copilot's "workflows wait for human approval".
- **Impact 4. Confidence high.**
- **A-113 fit:** it is policy, so it is a workflow stage the owner can drop. The core needs nothing new.

### P4. Grant stages: no candidate checkout, and a human gate by default

- **What:** a command stage gains `checkout: false`, which makes its cwd an empty folder with only the request, the diff and its `{ file }` arguments. It is the default for a grant stage. The head gate also requires an `accept` whose `source` is `owner`, unless the owner's personal or job layer sets `grants.<name>.unattended: true`.
- **Decision implied:** revisits A-083 Q3, under which an LLM PASS is enough to release a token, and its interaction with A-074 Q6a (observer accept).
- **Cost:** S–M. `source` stays forgeable by owner processes, so this guards against a workflow mistake, not against a hostile local process (P7 does that).
- **Buys:** closes gaps 5 and 6. A token never shares a folder with candidate config, and never leaves on LLM judgement alone unless the owner opted in.
- **Impact 4. Confidence high.**
- **A-113 fit:** `checkout: false` is a capability; "human before grant" is a default the owner can turn off in the owner layers, never in the repository layer.

### P5. Resource limits and a stop-everything command

- **What:** `systemd-run` gets `-p MemoryMax=` (default for example 8G), `-p TasksMax=` (for example 4096) and `-p CPUWeight=` per run and per check. The tmpfs `/tmp` for checks gets `--size` (bwrap supports it). Preflight refuses to start when the `runsDir` filesystem is below a free-space floor, and a disk watermark is checked after each run. `main.ts stop` stops every `sf-*` scope, writes a flag that refuses new runs, and prints which credentials the runs held.
- **Cost:** S. Limit values are owner config.
- **Buys:** closes gaps 9 and 12. A runaway check can no longer take the desktop down.
- **Impact 3. Confidence high** (memory.max and pids.max exist in a user scope, probed).
- **A-113 fit:** capability with defaults.

### P6. Cheap bubblewrap hardening

- **What:** add `--disable-userns` (probe first that claude and pi still run; headless Chromium for O-015 would then need `--no-sandbox`). Later, a seccomp filter passed with `--seccomp FD` that blocks `io_uring_*`, `keyctl`, `add_key`, `bpf`, `perf_event_open`, `userfaultfd`, `ptrace` and the namespace calls. The filter can be a static classic-BPF program written as bytes in TypeScript, with no libseccomp. Bind only the `/etc` entries runs need, and stop binding `/opt` wholesale (here it holds Heroic, containerd and others).
- **Cost:** S for `--disable-userns`; M for seccomp, which needs a probe that an extra fd survives `systemd-run --scope` (also open in the 10-e note).
- **Buys:** removes most of the kernel attack surface in gap 10, and the nested-namespace tricks.
- **Impact 3. Confidence medium** (the userns flag is certain; whether the CLIs tolerate it is unverified).
- **A-113 fit:** a sane default inside the bwrap backend.

### P7. Run agents under a subordinate UID

- **What:** a backend option that runs the sandbox as a host UID from the owner's `/etc/subuid` range (here 100000–165535). Probed by hand: `unshare --user --map-auto` then `setpriv --reuid 1000` inside gives host UID 100999. That process could not read a 0600 file of the owner's, could write a folder chowned to it, and the owner removed the folder again through `unshare --map-auto --map-root-user`. No new install was needed.
- **Decision implied:** files in clones and checkouts become owned by the sub-UID. The controller reads and cleans them through the same mapping.
- **Cost:** L. Every path that writes or cleans run folders changes, and so does `land`'s fetch.
- **Buys:** defence in depth if a bind or a mount-namespace escape goes wrong. The store and the owner's files are unwritable by agents by kernel permission, not only by mount layout (gap 13). It also closes gap 8 for free: git refuses to run in a repository owned by another UID ("dubious ownership"), so the owner's `git status` in the clone would stop rather than run the developer's `core.fsmonitor`.
- **Impact 4. Confidence medium:** the mechanism is probed; combining it with bwrap was not.
- **A-113 fit:** a backend capability, off by default until proven.

### P8. A run record good enough for an incident

- **What:** each run keeps its raw runtime output (claude `stream-json`, pi's event stream) in the run folder, plus the wrapped argv with secret values replaced, the proxy's egress log (P1), and the CLI version and binary SHA-256. Their hashes go on the outcome event.
- **Cost:** M. Widens A-111's run records and A-112's raw output item; nothing new to decide except retention.
- **Buys:** closes gap 11. The owner can answer "what did run X read and where did it connect", which Copilot gets by linking each commit to its session log.
- **Impact 3. Confidence high.**
- **A-113 fit:** core evidence; observers and extensions read it.

### P9. Ticket provenance for row 12

- **What:** a ticket from a tracker records its author. By default the factory accepts tickets only from authors the owner lists, ignores comments from others, and strips hidden characters (HTML comments, zero-width and bidi controls) before the prompt. The prompt labels tracker text as untrusted input.
- **Cost:** S, inside row 12's `Tracker` seam.
- **Buys:** closes gap 15 before it opens. This is Copilot's rule.
- **Impact 4** (for row 12). **Confidence high.**
- **A-113 fit:** the dispatch extension point from A-113 holds the policy; the core records provenance.

### P10. Minimise what the developer sees

- **What:** clone only the base commit's history (`--single-branch --branch <base ref>`, or fetch only `base` into an empty repository), with no other branches and no `sf/*`. Leave no `origin` path pointing at the owner's repository.
- **Cost:** S. Check that fix runs and `land` still work; they use only the cycle's branch.
- **Buys:** closes gap 14.
- **Impact 2. Confidence high.**

### P11. Do not hand the owner the developer's `.git`

- **What:** stop printing `Worktree:` as a place to work. Print the owner-repo commands only (`git -C <repo> diff base..head`, already printed). If the clone stays visible, warn that its `.git` is the developer's. Optionally the controller deletes the clone's `.git/hooks` and resets `.git/config` from a template after each run, through sandboxed git.
- **Cost:** S. Superseded by P7 if P7 lands.
- **Buys:** closes gap 8 at once.
- **Impact 3. Confidence high** (the git behaviour is well known; not probed here, because doing so means running a planted command).

### P12. A one-page threat model

- **What:** `docs/security/threat-model.md`. It lists assets, actors (owner, controller, repository at base, candidate, developer, reviewers, extensions, observers, tracker authors, CLI vendors, dependency authors), the boundary between each pair, and the rule "no run holds all three trifecta legs". It states D-020's "not airtight" next to the specific risks accepted. Each new ticket's design note checks against it.
- **Cost:** S.
- **Buys:** closes gap 1. It makes the accepted-risks file traceable to a model, not to one review at a time.
- **Impact 4. Confidence high.**

### Not proposed now

- A microVM or gVisor backend. The owner ruled VMs out for now (A-035). Every vendor that uses one still had to solve egress and credentials, which P1 and P2 do. Keep the `BACKENDS` seam.
- An LLM "security analyzer" in front of tool calls (OpenHands). It is heuristic by its own literature, and it adds cost and false positives. The proxy log and P3's deterministic check do more.
- Signing or hash-chaining the event store. Same-UID processes could re-sign it. P7 is the real fix.

## 6. Challenged decisions

### To revisit

- **A-037 "damage before malice"** and its reading in A-042 and D-020. The owner's concern (an agent leaving its remit, or a mistake) stays right. But an agent turned by injected text acts like malice without anyone writing malicious code, and the inputs that do it are routine: dependencies, documentation, and from row 12 issue text. Suggested restatement: "an agent that has read third-party content is treated as possibly hostile; defences need not be airtight, but no run may hold private data, untrusted input and an open network together." D-020's "not airtight" can stay.
- **D-021 "Runs keep full network access and can read their own CLI's credentials".** Both halves were an accepted shortcut from the scratch-repository days (A-043 lifted the scratch limit and kept both). P1 and P2 replace them. The first-pass research and A-106 already started on the network half.
- **A-106 (pasta).** Right direction, not enough on its own. The probe shows the Docker bridges and the LAN stay reachable. The ticket's test must also cover a non-loopback host address and a LAN address, and that test will fail with pasta alone. Either fold A-106 into P1, or add destination filtering (nftables in the namespace before the command drops privileges, which is more moving parts than the proxy).
- **A-068 (pi `auth.json` writable).** It accepted "overwrite or delete, worst case a re-login". The larger risk, reading and sending the login, was accepted earlier by D-021 and never weighed on its own. P2 supersedes both.
- **A-078 and A-095 (repository workflow imported unsandboxed).** The base check stops a checked-out candidate, but not a merged one: a reviewer-passed edit to the workflow module becomes owner-level code on the next run. A-111 already plans the fix. The evidence says do it first among the "soon" items (P3a).
- **A-083 Q3 together with A-074 Q6a.** The head gate releases a token on an LLM PASS, and an observer may supply `accept`. Each is reasonable alone; together they allow an LLM-only path to a credential. P4 keeps both decisions and adds an owner-layer opt-in.
- **A-112 item 11 (the claude developer may run the declared checks).** Harmless today, because the claude developer already has a shell through `.git/hooks` plus `git commit`, and pi has bash. But it is another reason the developer must be treated as running arbitrary code. Do it after P1, not only after A-106.
- **A-113 (capabilities, not policy).** It holds for security, with one rule to write down: security floors (sandbox backend, egress lists, grants, unattended grants) are set only in the owner's layers, never by a repository or a workflow from the repository. D-024 already says this for `sandbox` and `grants`. Extend it to every new security key, so A-113 is never read as "the repository may relax it".

### Confirmed by the evidence

- **D-019 (bwrap first, backend by name).** Codex CLI and Claude Code both settled on bwrap on Linux; Codex moved away from Landlock. Harden it (P6) rather than replace it.
- **A-035 "reads start empty"; whole-process isolation (08-c).** This is stronger than the Bash-only sandboxes of Claude Code and Copilot. The CLI config binds (gap 4) are the exception to fix, not the rule.
- **D-024 and A-078 Q1 (the repository layer cannot set sandbox or grants).** Claude Code applies the same rule to project settings.
- **A-083 Q1, Q2, Q5 (grant values from a file, through env, never under `none`, never asked for by a repository workflow).** Matches Symphony §15.3 and Claude Code's mask rules.
- **A-099 (stored bytes in verify) and A-100 (instructions from the base).** The CodeRabbit RCE and CVE-2026-25725 are both "candidate config steering a trusted process". These two decisions closed that class inside the controller.
- **No automatic merge (D-023 default, A-052).** Copilot forbids self-approval and self-merge for the same reason.
- **Zero dependencies (P-002).** It keeps the controller out of the s1ngularity-style npm supply-chain path. The CLIs remain the trusted supply chain: record their versions and hashes (P8).
- **Reviewers never get the developer's transcript, and run with read-only tools and no network tools.** That breaks the reviewer's own trifecta: it reads untrusted text, but it cannot act or send anything except a verdict. Do not treat the reviewer as a security boundary. The owner is the boundary, which is why P3 and P4 route risky changes and tokens to the owner.

## Sources

Primary or near-primary:
- Anthropic sandbox-runtime README: https://github.com/anthropic-experimental/sandbox-runtime
- Claude Code sandboxing docs (Protected paths, Mask credentials, Security limitations): https://code.claude.com/docs/en/sandboxing
- Anthropic engineering, Claude Code sandboxing: https://anthropic.com/engineering/claude-code-sandboxing
- CVE-2026-25725: https://advisories.gitlab.com/npm/@anthropic-ai/claude-code/CVE-2026-25725/
- CVE-2025-66479 and the SOCKS5 bypass (Aonan Guan): https://oddguan.com/blog/anthropic-sandbox-cve-2025-66479/ and https://oddguan.com/blog/second-time-same-sandbox-anthropic-claude-code-network-allowlist-bypass-data-exfiltration/
- Claude Pirate, Files API exfiltration (Rehberger): https://embracethered.com/blog/posts/2025/claude-abusing-network-access-and-anthropic-api-for-data-exfiltration/
- CVE-2025-55284, DNS exfiltration: https://cveawg.mitre.org/api/cve/CVE-2025-55284
- Codex sandboxing: https://learn.chatgpt.com/docs/sandboxing ; Codex cloud environments (secrets removed before the agent phase): https://learn.chatgpt.com/docs/environments/cloud-environment ; agent internet access: https://developers.openai.com/codex/cloud/agent-internet ; CVE-2025-59532: https://www.sentinelone.com/vulnerability-database/cve-2025-59532/
- Copilot coding agent risks and mitigations: https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations ; firewall: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-firewall
- Symphony SPEC §9.5, §15: `/var/tmp/software_factory/research-foundations/repos/openai_symphony/repo/SPEC.md:925-945, 1719-1790`
- Pi security and containerization docs: `repos/pi/src/packages/coding-agent/docs/security.md`, `containerization.md`; proxy support `src/core/http-dispatcher.ts:49,87`; agent dir `src/config.ts:584-585`
- Docker Sandboxes credentials: https://docs.docker.com/ai/sandboxes/security/credentials.md
- Kudelski, CodeRabbit RCE: https://kudelskisecurity.com/research/how-we-exploited-coderabbit-from-a-simple-pr-to-rce-and-write-access-on-1m-repositories
- Cursor CurXecute CVE-2025-54135: https://www.tenable.com/cve/CVE-2025-54135
- s1ngularity (Nx): https://blog.gitguardian.com/the-nx-s1ngularity-attack-inside-the-credential-leak/ ; Okta: https://www.okta.com/blog/threat-intelligence/the-s1ngularity-attack--when-attackers-prompt-your-ai-agents-to/
- Comment and Control (CSA note): https://labs.cloudsecurityalliance.org/research/csa-research-note-comment-control-github-prompt-injection-20/
- Lethal trifecta: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- CaMeL: arXiv 2503.18813 ; Design patterns: https://arxiv.org/html/2506.08837v1 ; Spotlighting: https://arxiv.org/html/2403.14720v1
- LLM judges under attack: https://arxiv.org/abs/2505.13348 , https://arxiv.org/abs/2504.18333 ; SE survey: https://arxiv.org/pdf/2510.24367
- gVisor rootless: https://gvisor.dev/docs/user_guide/rootless/
- Landlock scoping (ABI 6): https://lkml.iu.edu/hypermail/linux/kernel/2409.1/08430.html
- User namespaces and kernel exploits: https://git.grimmauld.de/mirrors/apparmor/wiki/unprivileged_userns_restriction (quotes Google's kCTF post https://security.googleblog.com/2023/06/learnings-from-kctf-vrps-42-linux.html, which I could not load; the 44% figure is second-hand)

Secondary (used for context only, details unverified): Cymulate on configuration-based sandbox escape; bex.co's count of Claude Code CVEs; the IDEsaster coverage; vendor pages for E2B, Modal, Daytona, Jules, Cursor and Devin; the Amazon Q incident coverage.

## Unverified or guessed

- That the claude CLI honours `HTTPS_PROXY` inside bwrap, and accepts a placeholder token with a local base URL (documented for the proxy; not run).
- That claude and pi still run under `--disable-userns`.
- That an extra fd survives `systemd-run --scope` for `--seccomp`.
- Which PostgreSQL authentication applies on 172.17.0.1. Only the TCP connect was tested.
- How often a current model obeys an injected instruction in a diff or a dependency. The literature gives ranges, not a rate for this factory's prompts.
