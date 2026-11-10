# Agents and harness adapters

How an agent is defined, what the Claude Code and Codex adapters do, and how the owner attends a step in their terminal.

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

An agent can also live in a markdown file, its frontmatter naming the harness, model and skills
and its body the prompt. `agent` from `@medrengard/core/defaults/agents.ts` reads it when the factory
loads, so the commission's definition holds the text, and editing the file changes only new
commissions:

```markdown
---
harness: claude-code
model: sonnet
skills:
  - ../skills/tdd
---

Read the request and write a plan for it.
```

```ts
import { agent } from "@medrengard/core/defaults/agents.ts";

const harnesses = {
  "claude-code": { run: ["node", "/path/to/medrengard/core/adapters/claude-code.ts"] },
};
const planner = agent("/path/to/agents/planner.md", harnesses);
```

- The frontmatter states exactly `harness`, one of the names `harnesses` gives, `model`, and
  optionally `skills`, as `- path` lines relative to the file. Each value is plain text: `1.10` is
  text, not a number.
- Anything else throws when the factory loads, naming the file and line: comments, blank lines,
  quotes, brackets, nesting, and unknown or repeated keys.
- The prompt is everything after the closing `---`. A prompt alone needs no loader:
  `readFileSync(path, "utf8")` is pinned the same way.

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
- Claude Code's managed settings in `/etc/claude-code`, which no flag turns off, would load
  whatever the agent declares, so the adapter refuses to start `claude` where that directory exists.
  Managed settings an organisation's token brings from the server are
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
  process or a file. A step whose access names no `anthropic` broker is refused. `claude` runs in the
  step's sandbox, as `codex` does: nothing in it holds a credential.
- `claudeCode` commits as `Medrengard <medrengard@localhost>`, whatever the engine's environment
  holds. For another identity, `{ ...claudeCode, values: gitIdentity("Name", "email") }`.
- `claudeCode` grants the adapter's real directory. If you reach this repository through a
  symlink, pass the adapter's real path (`fs.realpathSync`), or the sandbox cannot see it.
- A file path in `run`, such as the adapter's, must be absolute: every step's program starts in its
  workspace.
- An agent's `harness` may say `costs: false`: its adapter reports tokens but never what they
  cost, so a money limit over its steps, the step's own or the workflow's, could never be kept,
  and commissioning refuses one.

## The Codex adapter

`adapters/codex.ts` runs the agent through `codex exec`, Codex 0.167.0 alone: its login, routing
and session files change between releases, so the adapter refuses any other version, saying which
it found. Unattended only; an attended step is refused.

```ts
import { codex } from "@medrengard/core/defaults/access.ts";

const implement = {
  kind: "agent",
  agent: {
    harness: { run: ["node", "/path/to/medrengard/core/adapters/codex.ts"], costs: false },
    model: "gpt-6.1-sol",
    prompt: "Implement the plan.",
  },
  // ...as any agent step.
  access: codex,
};
```

- Log in once, apart from your own Codex, with a ChatGPT subscription:
  `CODEX_HOME=~/.config/medrengard/codex codex login --device-auth`. The step's broker `openai`,
  `codex-broker.ts [--login <directory>]`, holds that login outside the sandbox and refreshes it
  when it is about to expire, one broker at a time, under a lock, so steps in parallel share it.
  Codex runs on a fake login whose access token is the placeholder; the broker forwards its model
  requests to ChatGPT's Codex backend with the real one, answers its routing discovery itself, and
  finds nothing else it asks for. A login the backend refuses is refreshed, and Codex sees 403, not
  401, so it never tries to refresh the fake one.
- Each attempt has a Codex home of its own, made under the step's home and removed at the end, so
  none of your Codex configuration, skills, rules or sessions loads. Its configuration loads no
  `AGENTS.md` (`project_doc_max_bytes = 0`: Codex has no switch for it), no bundled skills,
  plugins, ChatGPT apps, other agents or MCP servers, and sends no analytics or metrics; Codex runs
  with `--strict-config`, so a key a release renames fails the attempt rather than being ignored.
- Codex records what it loaded before its first request to the model. The broker holds that
  request until the adapter has read it: if Codex loaded `AGENTS.md` or plugins, or not a declared
  skill, the adapter stops it before anything reaches the model and the attempt fails, saying why.
  A skill it loaded that the agent did not declare, such as a repository's `.agents/skills`, is
  recorded in the errors and a note, and the attempt runs on.
- Declared `skills` are copied where Codex finds a user's, under the home.
- Codex runs with `--dangerously-bypass-approvals-and-sandbox`: no approvals and no sandbox of its
  own; the step's sandbox is the boundary, as for Claude Code's `bypassPermissions`.
- `--effort low|medium|high|xhigh` passes on to Codex as its reasoning effort.
- Notes: `Codex 0.167.0, session <id>.`, what the agent says, each command it runs, `Codex ran:
  npm test`, and each file it changes. Each turn's tokens are reported on fd 4, with no cost.
- A session is kept as the attempt's `session`, and a later attempt that declares it continues it
  with `codex exec fork`, never `resume`, which starts afresh on an id it cannot find. Another
  harness's session fails the attempt.

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

To keep an attended step through a dropped connection or a closed window, attend from a terminal
that outlives its client, on the machine whose log it is: a herdr pane (`herdr --remote <host>` to
reach it from another machine), tmux or dtach. Disconnecting then only detaches you; `attend`, and
the agent with it, runs on, and you reattach to the same session. The idle limit still stops one
nobody returns to.
