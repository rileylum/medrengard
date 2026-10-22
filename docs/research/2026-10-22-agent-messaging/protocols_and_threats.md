# Inter-agent messaging for linked work streams: protocols, patterns, threats and mitigations

Researched 2026-10-22. Project context read from the software_factory repository (read only): `docs/specs/core-lifecycle-v1.md`, `docs/decisions.md` (A-074, A-109, A-125), `docs/work/herdr-findings.md`. Items dated before 2026 are marked [2024] or [2025].

Project facts the notes are written against (local files, not web sources):
- Core rule 1: "The controller alone changes state and spends budget. Agents return claims; the controller checks each claim before it counts." Rule 2: every verdict and piece of evidence binds to a commit SHA. — `docs/specs/core-lifecycle-v1.md` §Principles
- A reviewer gets the ticket, diff, SHAs, repository instructions (quoted from the base) and verification evidence, "never the developer's transcript". Review prompts carry a fresh nonce delimiter; role text "cannot forge a contract line". — `core-lifecycle-v1.md` §Evidence rules, §Prompts
- A-074: the observation stream is pull-only JSON lines (`events --follow`); observers act only through the owner's commands, and each command records its source. — `docs/decisions.md` A-074
- A-109: findings carry `file:line`, `requirement`, `severity`, `scenario`, `action`; the owner asked that other free-text inputs/outputs in the core get the same structure, possibly declared by workflows or extensions. — `docs/decisions.md` A-109
- A-125: review tiers (Trust seams 2+1, Light 1); `docs/security/threat-model.md` with "the trifecta rule". — `docs/decisions.md` A-125
- herdr finding "Owner answers are not evidence": a developer asked the owner a question, got an answer in its tab, and reviewers failed the work because "no evidence shows the owner was asked"; how an answer becomes evidence is open question O-010. — `docs/work/herdr-findings.md`

## 1. Protocols: what exists in 2026, and what fits one machine

### Takeaway
A2A (Linux Foundation, spec 1.0.0) is the agent-to-agent standard and has absorbed IBM's ACP; MCP is the agent-to-tool standard and in its current revision (2026-07-28) deprecated sampling, the feature most often proposed as an inter-agent channel. Zed's Agent Client Protocol is editor-to-agent, not agent-to-agent. For several local CLI agents under one controller, every one of these is more machinery than needed; their useful parts are data shapes (A2A's Task/Message/Artifact and task states, especially `INPUT_REQUIRED`) that a controller can copy into its own event log.

### Cited Findings
**A2A (Agent2Agent)**
- Latest released spec version is 1.0.0 (earlier: 0.3.0, 0.2.6, 0.1.0); clients send an `A2A-Version` header. — [A2A specification](https://a2a-protocol.org/latest/specification/)
- Core objects: Task (`id`, `contextId`, `status`, `artifacts`, `history`), Message (`messageId`, `role`, `parts`, optional `taskId`, `referenceTaskIds`), Part (text, file reference or structured data), Artifact (task output; spec says results should go in Artifacts rather than Messages), AgentCard (identity, skills, endpoint, auth requirements). — [A2A specification](https://a2a-protocol.org/latest/specification/)
- Task states: terminal COMPLETED, FAILED, CANCELED, REJECTED; interrupted INPUT_REQUIRED, AUTH_REQUIRED; plus SUBMITTED, WORKING. A message referencing a task with a mismatched `contextId` must be rejected. — [A2A specification](https://a2a-protocol.org/latest/specification/)
- Bindings: JSON-RPC, gRPC, HTTP+JSON/REST, custom; protobuf is normative. Streaming (`SendStreamingMessage`, `SubscribeToTask`) and webhook push notifications. Auth schemes: API key, HTTP auth, OAuth 2.0, OIDC, mTLS; Agent Cards may be signed. — [A2A specification](https://a2a-protocol.org/latest/specification/)
- Google donated A2A to the Linux Foundation in June 2025 [2025]; IBM's ACP (Agent Communication Protocol) merged into A2A under LF AI & Data in late August 2025, its repo `i-am-bee/acp` is archived, and its lead joined the A2A TSC; backers cited include Google, Microsoft, AWS, Cisco, Salesforce, ServiceNow, SAP. Secondary sources; dates differ by a few days. — [rywalker.com research note](https://rywalker.com/research/acp-agent-communication-protocol); [Tyk guide](https://tyk.io/learning-center/agent-protocols-a-complete-guide-to-mcp-a2a-and-acp/); [CO/AI](https://getcoai.com/news/linux-foundation-adopts-googles-agent2agent-protocol-for-ai-collaboration/)
- "100+ supporting companies" is repeated by secondary sources; I found no primary LF figure for 2026. — [crystl.dev](https://crystl.dev/blog/agent-communication-protocols/)
- The A2A spec section I read did not contain explicit guidance to treat another agent's content as untrusted input (the page is 256k characters; only the first 100k were read). — [A2A specification](https://a2a-protocol.org/latest/specification/)

**MCP**
- Current MCP protocol version is 2026-07-28. It replaced the initialize handshake with per-request version in `_meta` and a `server/discover` RPC; 2025-11-25 and earlier are the "handshake-based" revisions. — [MCP versioning](https://modelcontextprotocol.io/specification/versioning)
- In 2026-07-28, Sampling, Roots and Logging are Deprecated (SEP-2577); Sampling's migration path is "Integrate directly with LLM provider APIs"; earliest removal is the first revision on or after 2027-07-28. Dynamic Client Registration is also deprecated. — [MCP deprecated features registry](https://modelcontextprotocol.io/specification/2026-07-28/deprecated)
- 2025-11-25 [2025] added experimental Tasks (durable state machines for polling and deferred results), elicitation URL mode, and tool use inside sampling. — [WorkOS on the 2025-11-25 spec](https://workos.com/blog/mcp-2025-11-25-spec-update); [MCP Tasks (mirror)](https://modelcontextprotocol.net/specification/2025-11-25/basic/utilities/tasks)
- mcp_agent_mail is an MCP server built for coding-agent coordination: agent identities, inbox/outbox, searchable threads, advisory file "leases" (exclusive or shared, on globs) with an optional pre-commit guard that blocks conflicting exclusive reservations; persistence is Markdown in Git (audit) plus SQLite FTS5 (query). Supports Claude Code, Codex CLI, Gemini CLI and other MCP clients. — [mcp_agent_mail GitHub](https://github.com/Dicklesworthstone/mcp_agent_mail); [Rust port](https://github.com/Dicklesworthstone/mcp_agent_mail_rust)

**Agent Client Protocol (Zed)**
- Standardises editor/IDE-to-coding-agent communication, modelled on LSP; local agents run as a subprocess speaking JSON-RPC over stdio; remote support is work in progress. The overview does not cover agent-to-agent messaging. — [agentclientprotocol.com](https://agentclientprotocol.com/overview/introduction)
- Since the ACP merger, "ACP" usually means Zed's protocol. — [rywalker.com](https://rywalker.com/research/acp-agent-communication-protocol)

**Claude Code's own channels (relevant because the factory drives `claude -p`)**
- Agent teams: experimental, off by default (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); a lead, teammates, a shared task list with dependencies and file-lock claiming, and a mailbox that is a JSON file per agent at `~/.claude/teams/{team}/inboxes/{agent}.json`, validated on read. — [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams)
- In non-interactive mode (`-p`, Agent SDK), Claude does not spawn teammates. — [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams)
- Received inter-agent messages are labelled as coming from another Claude session, "not from you"; "A teammate can't approve a permission prompt or supply consent on your behalf", and a denied action cannot be relayed to another teammate to bypass the check. In auto mode a classifier treats relayed approval claims as untrusted and screens each message before delivery. — [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams)
- Hooks `TeammateIdle`, `TaskCreated`, `TaskCompleted` can block (exit 2) as quality gates. — [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams)
- The docs list a separate "cross-session messaging" feature for passing findings between sessions the user runs. — [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams)

### Inferences
- A2A's network, auth and discovery layers (Agent Cards, OAuth, mTLS, webhooks) solve problems a single-machine controller does not have: the controller already knows every run's identity because it started it. Copying A2A's *vocabulary* (task, message with `referenceTaskIds`, artifact, `INPUT_REQUIRED`) keeps a later bridge cheap without adding a dependency.
- MCP as the transport for peer questions is a poor bet: sampling is deprecated, and an MCP server reachable from inside a sandbox is a new network/IPC surface. A file or CLI the controller exposes (as A-074's pull stream already does) fits the zero-dependency rule better.
- Claude Code agent teams put the lead and peers inside one interactive session and let any teammate message any other; that is the opposite of "controller decides state". Their *rules* are worth copying: peer messages are labelled as not-from-the-user and can never carry consent.
- mcp_agent_mail's leases are advisory unless a git hook enforces them; the factory's equivalent enforcement point already exists (the controller refuses claims), so a lease would be a controller record, not an agent promise.

### Gaps
- Agent Network Protocol (ANP): not researched; I have no sourced current status.
- No primary adoption numbers for A2A in 2026.
- The A2A spec's security-considerations section (beyond the first 100k characters) was not read.
- The MCP 2026-07-28 changelog beyond the deprecation registry (e.g. state of elicitation, Tasks, server-to-client requests) was not read; a secondary claim that "servers no longer push requests to clients" is unverified.
- Claude Code "cross-session messaging" page not read.

## 2. Coordination patterns, and whether inter-agent talk pays

### Takeaway
The evidence favours structured artifacts over chat. MetaGPT's published finding is that structured intermediate outputs in a shared pool with subscriptions raise success; MAST attributes a large share of multi-agent failures to inter-agent misalignment and missing verification; debate studies find extra rounds rarely beat cheaper single-agent baselines at matched cost. For coding (write-heavy, shared state), Cognition argues against parallel agents; Anthropic's gains come from read-heavy research. The pattern that fits the factory is a contract between tickets: the upstream ticket publishes an interface artifact bound to a SHA, and the downstream ticket validates against it, with a question/answer channel as a fallback that the controller records and routes.

### Cited Findings
**Patterns in existing systems**
- MetaGPT [2023]: a global shared message pool instead of one-to-one messages (one-to-one "complicates the communication topology"); roles subscribe to message types (e.g. Architect watches PRD outputs); agents must produce structured outputs (requirements, design, interface specs); structured intermediate outputs "significantly increase the success rate" of code generation. — [MetaGPT paper (arXiv 2308.00352)](https://www.arxiv-vanity.com/papers/2308.00352); [aiwiki summary](https://aiwiki.ai/wiki/metagpt)
- Claude Code agent teams: lead plus teammates; shared task list where "a pending task with unresolved dependencies cannot be claimed until those dependencies are completed"; plan-approval requests from teammate to lead (auto-approved unless the teammate's mode was changed); docs warn teams "use significantly more tokens", work best when teammates "can operate independently", and that for "sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective". Known limit: "Task status can lag", blocking dependents. — [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams)
- mcp_agent_mail: mailbox with threads plus file leases as the conflict-avoidance mechanism for parallel coding agents. — [mcp_agent_mail GitHub](https://github.com/Dicklesworthstone/mcp_agent_mail)
- A2A's INPUT_REQUIRED state is a protocol-level form of "request with the task paused until answered". — [A2A specification](https://a2a-protocol.org/latest/specification/)

**Evidence on value and cost**
- MAST ("Why Do Multi-Agent LLM Systems Fail?", NeurIPS 2025 [2025]): 14 failure modes in 3 categories, specification/system design issues, inter-agent misalignment, task verification; κ = 0.88; v3 analyses 1,642 traces. A secondary source says system-design issues are 44.2% of failures (unverified against the paper). — [arXiv 2503.13657v3](https://arxiv.org/html/2503.13657v3); [NeurIPS listing](https://mlanthology.org/neurips/2025/cemri2025neurips-multiagent)
- Multi-agent debate: across 5 debate methods, 9 benchmarks, 4 models, debate often failed to beat chain-of-thought and self-consistency despite more compute; model heterogeneity consistently helped. — [Stop Overvaluing Multi-Agent Debate, arXiv 2502.08788](https://arxiv.org/html/2502.08788v3) [2025]
- "Should we be going MAD?" (ICML 2024): debate "do[es] not reliably outperform" self-consistency and ensembling; results are hyperparameter-sensitive. — [PMLR](https://proceedings.mlr.press/v235/smit24a.html) [2024]
- GroupDebate: 4 agents × 5 rounds on GSM8K lifted accuracy 76% to 88% at about 90× tokens. — [arXiv 2409.14051](https://arxiv.org/pdf/2409.14051v2) [2024]
- Anthropic's multi-agent research system: Opus 4 lead with Sonnet 4 subagents beat single-agent Opus 4 by 90.2% on an internal research eval; multi-agent systems use about 15× the tokens of chat. (Secondary quotes of the Anthropic engineering post.) — [Arize community thread](https://community.arize.com/x/discussions/0qxjwdkazrlx/evaluating-the-hype-insights-on-multi-agent-system); [The AI Engineer](https://theaiengineer.substack.com/p/how-anthropic-built-multi-agent-deep) [2025]
- Cognition, "Don't Build Multi-Agents" (Walden Yan, 12 June 2025): parallel subagents lacking shared context make conflicting decisions (Flappy Bird example: one builds a Mario background, the other a mismatched bird); single-threaded agents are more reliable for their use. — [secondary summary](https://echai.ventures/how-founders-use-ai/ai-agents/should-i-build-one-agent-or-a-team-of-agents-working-together); [Pat McGuinness](https://patmcguinness.substack.com/p/the-ai-agent-architecture-debate) [2025]
- Reconciliation offered by commentators: multi-agent helps read-heavy parallel work (research) and hurts write-heavy shared-state work (coding). — [Pat McGuinness](https://patmcguinness.substack.com/p/the-ai-agent-architecture-debate)

### Inferences
- The owner's use case ("does this interface fit?") is the Cognition failure mode in reverse: two agents deciding in parallel without shared context. The cheapest fix is a shared, versioned *artifact* (the upstream interface spec at a SHA) that both read, not a conversation. This matches MetaGPT's structured-artifact result and A-109's push for structure.
- Pattern ranking for the factory, cheapest first:
  1. **Contract artifact between linked tickets.** The upstream ticket's developer run writes an interface file (types, signatures, invariants) as an output, bound to its candidate SHA (A-117 "Outputs are SHA-bound files with a hash in the outcome event"). The downstream ticket's prompt receives it as quoted, delimited data with its SHA. Validation is a downstream *check* (a command stage that type-checks against it), which yields evidence, not opinion.
  2. **Question with deadline (A2A `INPUT_REQUIRED` analogue).** A run ends with a structured `question` claim (to: linked ticket, about: file/symbol, options). The controller records it as an event, pauses or escalates, and routes it; the answer is a structured `answer` event from the other stream's next run or from the owner. Deadline expiry escalates to the owner (core rule 3).
  3. **Board / blackboard.** The A-074 observation stream already is an owner-visible board; peer questions and answers become events on it.
  4. **Free chat between live agents** (agent teams, mailbox): highest cost, weakest audit, and conflicts with "controller decides state". Not recommended.
- MAST's "task verification" category argues that peer validation must end in something checkable (a test, a type-check) rather than "B agreed".

### Gaps
- AutoGen / LangGraph group chat and CrewAI coordination were not researched in this pass; no sourced data on their outcomes.
- Blackboard architecture literature (classic or LLM-era) not searched.
- No study found that measures inter-agent *design validation* on dependent coding tickets specifically.
- Primary Anthropic and Cognition posts not fetched; figures above come from secondary quotes.

## 3. Threat model for inter-agent messaging

### Takeaway
A peer message is untrusted input that arrives with the false authority of "a colleague". Measured threats: self-replicating injection across agents (Prompt Infection, Morris II), steganographic collusion that monitors and paraphrasing only partly catch, and the lethal trifecta assembled across two agents rather than one. OWASP's 2026 agentic list names insecure inter-agent communication as ASI07. In the factory the specific dangers are claim laundering ("ticket 12 confirmed the interface"), loss of reviewer independence, and a compromised repository spreading to linked runs.

### Cited Findings
- Prompt Infection [2024]: a self-replicating injection hidden in external content hijacks one agent and copies itself into that agent's messages to the next. On GPT-4o and GPT-3.5, self-replication beat non-replicating injection (by 13.92% and 209% on scams/malware/content manipulation). With local (non-public) messaging, success fell about 20% but self-replication still spread. GPT-4o ignored 66% of attacks versus 9% for GPT-3.5, yet executed payloads more precisely once compromised. In a 10-agent society, full infection by turn 4.7. — [Lee & Tiwari, arXiv 2410.07283](https://arxiv.org/html/2410.07283v1)
- Morris II [2024]: "adversarial self-replicating prompts" make a model copy input to output plus payload, spreading 0-click through RAG-backed email assistants (tested against Gemini, ChatGPT, LLaVA); lab only. Their "Virtual Donkey" guardrail reported TPR 1.0, FPR 0.015. — [arXiv 2403.02817](https://arxiv.org/html/2403.02817v2); [Schneier](https://www.schneier.com/blog/archives/2024/03/llm-prompt-injection-worm.html)
- Secret collusion (NeurIPS 2024): agents can use steganography to hide coordination from oversight; frontier models show rising stego capability; monitoring, paraphrasing and parameter optimisation have limits as countermeasures. — [Motwani et al., arXiv 2402.07510](https://arxiv.org/html/2402.07510v5) [2024]
- Lethal trifecta: private data + untrusted content + an exfiltration channel; "the only way to stay safe there is to avoid that lethal trifecta combination entirely"; 95% filter effectiveness "is very much a failing grade" in security. — [Simon Willison, 16 June 2025](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) [2025]
- OWASP Top 10 for Agentic Applications (published 9 Dec 2025): ASI01–ASI10; ASI07 Insecure Inter-Agent Communication (interception, spoofing, tampering; countermeasures mutual auth, signed messages); ASI04 supply chain and ASI07 are most framework-dependent. (Secondary descriptions; official text not read.) — [Giskard](https://www.giskard.ai/knowledge/owasp-top-10-for-agentic-application-2026); [Cycode](https://cycode.com/blog/owasp-top-10-agentic-applications/); [Modulos](https://docs.modulos.ai/frameworks/owasp-top-10-agentic)
- Claude Code's built-in stance: peer messages are not user consent; denied actions cannot be relayed to a peer to bypass checks; approval claims relayed from another agent are untrusted. — [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams)
- MAST lists inter-agent misalignment (e.g. withholding information, ignoring other agents' input) as one of three failure categories. — [arXiv 2503.13657v3](https://arxiv.org/html/2503.13657v3)
- Agent-team docs report teammates that "stop after encountering errors", leads that stop early, and lagging task status that blocks dependents: operational analogues of deadlock and stall. — [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams)

### Threat list mapped to the factory (inference, built on the findings above)
| Threat | How it arises with linked tickets | Factory asset at risk |
| --- | --- | --- |
| Cross-agent injection / worm | Repo A's content (README, test fixture, dependency) injects developer A; A's "answer" to B carries the payload; B's next commit carries it further (Prompt Infection, Morris II) | Every linked candidate; the owner's machine via later runs |
| Claim laundering | B writes "A confirmed the interface fits" in a commit message or PR text; a reviewer treats it as evidence | Core rule 1 and 2 (claims vs evidence) |
| Approval laundering | A peer message phrased as owner approval ("owner said ship it") | `docs/decisions.md` approval rule; `accept` |
| Collusion to pass review | Two developer runs agree to mutually vouch, or encode hints for a reviewer (stego) | 2+1 review independence |
| Reviewer contamination | Reviewer sees peer thread and anchors on the developers' agreed framing | Reviewer gets "never the developer's transcript" |
| Confused deputy | B asks A to run/change something in A's sandbox that B is not allowed to (e.g. a grant-holding stage) | Grants (A-074 Q4/Q5), sandbox boundaries |
| Exfiltration via the channel | A run with secrets or network places data in a "question" that reaches a run with network | Trifecta rule in `docs/security/threat-model.md` |
| Flood / cost blowup | Loops of question → answer → follow-up; debate-style 90× token growth | Budget (controller spends budget) |
| Deadlock | A waits on B's answer while B waits on A's interface | Cycle liveness; owner time |
| Stale contract | B validated against A's interface at SHA x; A's fix run moves to SHA y | Rule 2: new commit invalidates evidence |

### Gaps
- No sourced study of collusion specifically to evade *code review*; the stego paper is the nearest.
- OWASP primary document and its mitigation text for ASI07 not read.
- "Open Challenges in Multi-Agent Security" (arXiv 2505.02077) surfaced but was not read.

## 4. Mitigations, and how each maps onto the factory's rules

### Takeaway
No single prompt-level defence holds (Prompt Infection: marking alone let 76% through; tagging alone cut 5%). Structural controls win: the controller routes only along owner-declared links, accepts only schema-typed messages with caps, records each as an event, never counts a message as evidence or approval, keeps reviewers off the channel, and escalates on deadline. CaMeL's split (a privileged planner never reads untrusted data; a quarantined reader has no tools) is the research-grade version of the same idea.

### Cited Findings
- Prompt Infection defences: LLM Tagging (prefix the sending agent's name) alone cut attack success by only 5%; marking alone still let 76% through and a counter-attack defeated the marker; marking + tagging blocked all tested attacks; instruction defence + tagging left 3%; sandwich + tagging 16%. Authors: no single defence suffices. — [arXiv 2410.07283](https://arxiv.org/html/2410.07283v1)
- CaMeL [2025]: a privileged LLM plans from the trusted query only; a quarantined LLM parses untrusted data with no tool access; an interpreter tracks provenance and enforces capability policies on tool calls so untrusted data cannot change control flow or flow to unauthorised sinks. AgentDojo: 77% tasks with provable security versus 84% undefended (earlier version: 67%). — [arXiv 2503.18813](https://arxiv.org/pdf/2503.18813); [code](https://github.com/google-research/camel-prompt-injection)
- Willison: avoid combining the three trifecta legs; filters are not sufficient. — [Simon Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- Claude Code agent teams: mailbox entries validated against a message format on read, invalid ones removed; message labelled as from another session; relayed approvals untrusted; optional classifier screens messages pre-delivery. — [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams)
- Secret collusion: paraphrasing and monitoring reduce but do not eliminate steganographic channels. — [arXiv 2402.07510](https://arxiv.org/html/2402.07510v5)
- Debate studies: model heterogeneity helps; more rounds cost sharply more. — [arXiv 2502.08788](https://arxiv.org/html/2502.08788v3); [arXiv 2409.14051](https://arxiv.org/pdf/2409.14051v2)
- OWASP ASI07 countermeasures: mutual authentication, signed messages. — [Cycode](https://cycode.com/blog/owasp-top-10-agentic-applications/)

### Inferences (proposed controls, each tied to an existing factory rule)
1. **Owner-declared links only.** Routing table = links the owner put on the work items (job file or ticket). A message to an unlinked ticket is refused, not dropped silently. (A-113: policy in workflow/extension; the link is data the owner owns.)
2. **Messages are claims, recorded as events.** A run returns `question` / `answer` / `interface_proposal` in its structured outcome (A-109/A-117 style), never by writing to a peer directly. The controller appends it to the store with run ID, SHA and `contractHash`; the A-074 stream shows it. Sandboxes get no shared mailbox, so no side channel exists between live runs (also removes Prompt Infection's "global messaging" condition).
3. **Schemas over free text, with caps.** Fixed fields (`about: file:line or symbol`, `question`, `options`, `answer: yes | no | proposal`, `proposal: path to SHA-bound file`); size cap like the dispute's one line / 2 KiB; per-cycle message budget counted like review budget (controller spends budget). Display through `main.ts`'s control-character escaping.
4. **Untrusted delimiting on delivery.** Quote peer content inside a fresh-nonce block labelled with sender ticket, run ID and SHA (the review prompt's existing nonce mechanism, plus Prompt Infection's tagging). Treat as defence in depth only (marking alone: 76% bypass).
5. **Never evidence, never approval.** A peer answer cannot satisfy a check, a review, or `accept`. Validation that counts is a downstream command stage that compiles/tests against the upstream interface artifact at a named SHA. The herdr "owner answers are not evidence" finding is the same problem; whatever O-010 decides for owner answers should be the one route for peer answers too (recorded event, cited by ID and SHA in the ticket log).
6. **Bind contracts to SHAs; invalidate on change.** A downstream validation names the upstream SHA; a new upstream candidate marks it stale (core rule 2), so the controller re-requests or escalates.
7. **Reviewers off the channel.** Reviewers keep today's inputs. If a peer exchange matters, the reviewer gets the *recorded artifact* (interface file at SHA) inside a delimited untrusted block, not the thread; the adversarial reviewer may get the thread explicitly as untrusted input to look for laundering. Preserves "never the implementer's transcript".
8. **No new trifecta leg.** A run holding a grant or network never sends or receives peer messages; message delivery only into sandboxes with no network and no secrets.
9. **Deadlines and deadlock.** Each question has a deadline counted in controller time; expiry escalates to the owner. The controller refuses a question that would close a wait cycle among linked tickets (simple graph check), escalating instead.
10. **Heterogeneity for validation.** Where a peer validation is wanted, prefer a different runtime/model for the answerer (debate studies: heterogeneity helps), and keep it a check, not a vote.

### Gaps
- No empirical study found that measures these controls together for coding agents; the evidence is per-control (Prompt Infection, CaMeL, stego paper).
- No sourced data on token cost of controller-mediated Q&A versus shared artifacts.
