# Agents and harness adapters

How you define an agent, what the Claude Code and Codex adapters do, and how you attend a step in
your terminal.

## Agents

An agent is a reusable definition: a harness, a model, a prompt and any skills. An agent step
runs it, and supplies the workspace, inputs and access.

```ts
import type { Agent } from "@medrengard/core/src/definition.ts";

const planner: Agent = {
  harness: {
    run: ["node", "/path/to/medrengard/core/adapters/claude-code.ts", "--effort", "high"],
  },
  model: "sonnet",
  prompt: "Read the request and write a plan for it.",
  skills: ["/path/to/skills/tdd"],
};
```

| Field           | Meaning                                                           | Default  |
| --------------- | ----------------------------------------------------------------- | -------- |
| `harness.run`   | the harness adapter's command, with its options                   | required |
| `harness.costs` | `false`, and only `false`: the adapter reports tokens but no cost | left out |
| `model`         | the model's name, passed to the harness                           | required |
| `prompt`        | what the agent is told to do at the step                          | required |
| `skills`        | paths to skill directories                                        | none     |

- A file path in `run` must be absolute: the adapter starts in the step's workspace.
- A skill is a directory that holds a `SKILL.md`, in the Agent Skills format. Its name is the
  directory's name. An agent cannot have two skills of one name.
- Commissioning records the prompt and every skill file. Later edits change only new commissions.
- With `costs: false`, no money limit can be kept over the agent's steps: commissioning refuses a
  `usd` limit on the step or on its workflow.
- The adapter adds the step contract to the prompt: where the inputs are, the outcomes, and how
  to claim each kind the step's `claims` lists.

## Agent files

You can keep an agent in a markdown file. The frontmatter names the harness, model and skills. The
body is the prompt.

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
  codex: { run: ["node", "/path/to/medrengard/core/adapters/codex.ts"], costs: false },
} as const;

const planner = agent("/path/to/agents/planner.md", harnesses);
```

`agent` reads the file when the factory loads and returns an `Agent`.

- `harness` and `model` are required. `harness` is one of the names in `harnesses`.
- `skills` is optional: one `- path` line per skill, indented two spaces, relative to the file.
- Each value is plain text: `1.10` is text, not a number.
- The prompt is everything after the closing `---`.
- Anything else throws, naming the file and the line: a comment, a blank line, a quote or bracket
  at the start of a value, nesting, an unknown key, a key stated twice.
- A prompt alone needs no loader: use `readFileSync(path, "utf8")`.

## The Claude Code adapter

`core/adapters/claude-code.ts` runs the agent through `claude -p`. The agent writes the claim
itself, and the engine judges it as any step's. At an attended step it opens an interactive
session instead: see [Attended steps](#attended-steps).

### Setting up

1. Install Claude Code so that `~/.local/bin/claude` runs it.
2. Save your subscription token as `~/.config/medrengard/claude-token`.
3. Give the step `access: claudeCode`, from `@medrengard/core/defaults/access.ts`.
4. Name the adapter by its absolute path in `harness.run`. If you reach the package through a
   symlink, pass the real path (`fs.realpathSync`), or the sandbox cannot see it.

`claudeCode` grants Node, npm, `claude`, the adapters and the step contract's module, `core/step`,
a fresh empty home, and no host but the broker `anthropic`. Spread it to change one thing. See
[Access](access.md).

```ts
import { claudeCode, gitIdentity } from "@medrengard/core/defaults/access.ts";

// Commits are Medrengard <medrengard@localhost> unless you set another identity.
const asMe = { ...claudeCode, values: gitIdentity("Name", "name@example.com") };

// Another token file.
const { anthropic } = claudeCode.network.brokers;

const otherToken = {
  ...claudeCode,
  network: { hosts: [], brokers: { anthropic: [...anthropic, "--token", "/path/to/token"] } },
} as const;
```

### Options

Put them after the adapter's path in `harness.run`.

| Option                       | Meaning                                                   | Default                |
| ---------------------------- | --------------------------------------------------------- | ---------------------- |
| `--permission-mode <mode>`   | `acceptEdits` or `bypassPermissions`                      | `acceptEdits`          |
| `--tools <names>`            | the Claude Code tools the agent gets, separated by commas | `Bash,Read,Edit,Write` |
| `--effort <level>`           | `low`, `medium`, `high`, `xhigh` or `max`                 | `claude`'s own         |
| `--max-budget-usd <dollars>` | the most `claude` may spend in the attempt                | none                   |

- Under `acceptEdits` the agent edits files but runs no commands. Under `bypassPermissions` it
  does anything the step's access allows: the sandbox is its only boundary.
- An agent with skills also gets the `Skill` tool. Its skills load as the plugin `medrengard`,
  named `medrengard:<skill>`.
- `claude` checks the budget after each turn, so an attempt can spend a little past it. Over it,
  the attempt fails.
- Any other option, or a value outside these, fails the attempt.

### Credentials

- `claude` reaches the model API only through the step's broker `anthropic`,
  `claude-code-broker.ts [--token <file>] [--upstream <url>]`, which runs outside the sandbox.
- The broker reads the token from `~/.config/medrengard/claude-token` unless `--token` names
  another file.
- `claude` gets a placeholder in the token's place, so nothing the agent runs can read the token.
- A step whose access names no `anthropic` broker fails its attempt.

### What the adapter loads and refuses

`claude` loads only the tools and skills the agent declares.

- Nothing else of Claude Code's own loads: no bundled skills or built-in plugins, no settings
  files, no MCP servers, no memory, no `CLAUDE.md` or `AGENTS.md`, and no attribution in commits.
- Nothing in the workspace configures `claude`: not its `.mcp.json`, `.claude/` settings, hooks,
  skills or subagents, nor its `CLAUDE.md`.
- `claude` sends no telemetry, error reports or feedback, and fetches no feature flags. Features
  Anthropic gates by flag stay off.
- The settings that do this are as Claude Code 2.1.318 names them.
- Where `/etc/claude-code` exists, the adapter refuses to start `claude`: no flag turns off the
  managed settings there.

The adapter checks what `claude` says it loaded. These stop `claude` before its first turn, and
the attempt fails:

| Error                                                 | Cause                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `Claude Code did not apply the adapter's settings.`   | `claude` ignores all its settings, silently, if one is invalid   |
| `Claude Code did not load what the agent declared: …` | a declared skill is missing, such as one with an unreadable file |
| `Claude Code could not load a plugin: …`              | `claude` reported a plugin error                                 |

These are recorded in the attempt's errors and a note, and the attempt carries on:

| Error                                                          | Cause                                              |
| -------------------------------------------------------------- | -------------------------------------------------- |
| `Claude Code loaded what the agent did not declare: …`         | tools, skills, plugins, MCP servers or subagents   |
| `Claude Code loaded instructions the agent did not declare: …` | a `CLAUDE.md` or rules file, at the start or later |
| `Claude Code did not turn off its nonessential traffic: …`     | `claude` says it still sends telemetry             |
| `Claude Code did not say what it loaded.`                      | nothing of its start was checked                   |

The checks cannot see a setting that a release renames, a loaded `AGENTS.md`, or managed settings
an organisation's account brings from the server.

### Sessions

The adapter keeps the conversation `claude` had as the attempt's session, however the attempt
ended. A later step continues it by declaring it as an input:

```ts
inputs: { plan: "subject", earlier: { session: "plan" } },
```

- `claude` continues it as a fork, under the new attempt's own session id. The session kept never
  changes.
- The agent gets this step's prompt, not the one the conversation began with. It is told that its
  workspace was rebuilt from the latest commit.
- If the named step has left no session yet, the agent starts afresh.
- A session `claude` cannot continue, such as another harness's, fails the attempt. It never
  starts afresh instead.
- A step continues at most one session. An attended step continues one the same way.

To resume an attempt that was interrupted, route the cause to a step that continues its session.
A route renews no budget. See [Workflows](workflows.md).

```ts
implement: {
  // …
  escalate: { interrupted: "resume" },
},
resume: {
  // …
  inputs: { plan: "subject", earlier: { session: "implement" } },
},
```

### Notes and usage

An unattended attempt notes:

- which Claude Code ran it, and in what session: `Claude Code 2.1.319, session <uuid>.` The
  adapter chooses the session id, so a failed attempt has the note too;
- what the agent says, and each tool it calls: `Bash: npm test`;
- each tool `claude` denied it, as under `acceptEdits`: `Claude Code denied Bash: npm test`;
- how it finished: `Finished in 42.1 s, 7 turns, $0.31.`

It reports the tokens so far after each message, then the result's tokens and cost.

### Failures

Each fails the attempt, whatever `claude`'s exit code, and a claim the agent wrote before is not
recorded. The commission escalates with the cause `exit`; the attempt's errors say why.

| Error                                                                                     | Cause                                                                                  |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `claude finished with an error: …`                                                        | `claude` reported its run as failed, such as out of turns or budget                    |
| `claude ended without a result.`                                                          | `claude` did not report how its run ended                                              |
| `Claude Code's five-hour usage window is used up; it resets at 2026-11-09T14:00:00.000Z.` | your account's usage limit, five-hour or weekly, refused the run. Retry once it resets |
| `claude could not start: ENOENT.`                                                         | the sandbox has no `claude` on its `PATH`                                              |

## The Codex adapter

`core/adapters/codex.ts` runs the agent through `codex exec`. It runs Codex 0.167.0 only, and
refuses any other version. It is unattended only: an attended step fails its attempt.

```ts
import type { Agent } from "@medrengard/core/src/definition.ts";

const implementer: Agent = {
  harness: { run: ["node", "/path/to/medrengard/core/adapters/codex.ts"], costs: false },
  model: "gpt-6.1-sol",
  prompt: "Implement the plan.",
};
```

### Setting up

1. Install Codex 0.167.0 globally, with the npm beside the Node that runs the engine.
2. Log in once with a ChatGPT subscription, apart from your own Codex:
   `CODEX_HOME=~/.config/medrengard/codex codex login`.
3. Give the step `access: codex`, from `@medrengard/core/defaults/access.ts`. It grants what
   `claudeCode` does, with Codex's package and the broker `openai`.
4. Say `costs: false` in the harness: Codex reports tokens, never their cost.

The one option is `--effort low|medium|high|xhigh`, Codex's reasoning effort.

Codex runs with `--dangerously-bypass-approvals-and-sandbox`: no approvals and no sandbox of its
own. The step's sandbox is its boundary.

### Credentials

- Codex reaches the model only through the step's broker `openai`,
  `codex-broker.ts [--login <directory>]`, which holds the login outside the sandbox.
- Codex runs on a fake login whose tokens are the placeholder.
- The broker forwards Codex's model requests to ChatGPT's Codex backend with the real login, and
  answers its routing discovery itself. Anything else Codex asks for is not found.
- The broker refreshes the login when it is about to expire, or once the backend refuses it.
  Brokers refresh one at a time, under a lock, so steps in parallel share one login.
- If a refresh fails, log in again as above.

### What the adapter loads and refuses

- Each attempt has a Codex home of its own, made under the step's home and removed at the end.
  None of your Codex configuration, skills, rules or sessions loads.
- Codex loads no `AGENTS.md`, rules, bundled skills, plugins, ChatGPT apps, other agents or MCP
  servers, and sends no analytics or metrics.
- Declared skills are copied into the step's home, where Codex finds a user's.
- Codex runs with `--strict-config`: a configuration key that a release renames fails the attempt.

Codex records what it loaded before its first request to the model. The broker holds that request
until the adapter has checked the record, so nothing reaches the model from a Codex it stops.

| Error                                                  | The attempt |
| ------------------------------------------------------ | ----------- |
| `Codex loaded AGENTS.md, which the adapter keeps out.` | fails       |
| `Codex loaded plugins, which the adapter keeps out.`   | fails       |
| `Codex did not load the skills …`                      | fails       |
| `Codex did not say what it loaded.`                    | fails       |
| `Codex loaded skills the agent did not declare: …`     | carries on  |

A skill the agent did not declare can come from the workspace, such as a repository's
`.agents/skills`.

### Sessions, notes and usage

- The adapter keeps Codex's session as the attempt's session, however the attempt ended. A later
  attempt that declares it continues it as a fork, with `codex exec fork`.
- Another harness's session fails the attempt.
- An attempt notes `Codex 0.167.0, session <id>.`, what the agent says, each command it runs,
  `Codex ran: npm test`, and each file it changes.
- After each turn it reports the tokens so far, with no cost.

## Attended steps

An attended step is an agent step you take part in, in your terminal: to design a change with the
agent, or to review one. Say `attended: true` on the step.

```ts
design: {
  kind: "agent",
  attended: true,
  agent: planner,
  workspace: "empty",
  inputs: { request: "request" },
  claims: ["document"],
  on: { done: "end" },
  budget: 1,
  access: claudeCode,
  limits: { idle: "unbounded" },
},
```

```sh
medrengard attend first
```

### Attending

- `run` and `advance` never start an attended step. The commission stays ready at it, and `run`
  says so once: `first: ready at design, to attend, about <subject>`.
- `attend` starts the step's agent in the terminal you run it in. It returns once the agent's
  program ends, and prints where the commission is now. `run` carries on from there.
- `attend` refuses a commission that is not ready at an attended step, and stdin or stdout that
  is not a terminal.

### The session

With the Claude Code adapter:

- The agent's prompt and how to claim are its system prompt, so compacting a long session keeps
  them. The agent begins at once.
- The agent writes `output.json` once you agree the work is done, and again if you want changes.
- End the session with `/exit`. The last `output.json` written is the claim, judged as any other.
  Leaving without one escalates.
- Each time the agent writes `output.json`, the engine notes what it would amount to, or why it
  would escalate:

  ```
  Step design's output is ready: outcome done, with 1 artifact: document. It is verified once the session ends.
  ```

  The note is not drawn inside Claude Code's screen. Read it with `watch` or `events`, in a pane
  beside the session.

- Claude Code's first-run questions are answered in a home that has not run it.
- `--max-budget-usd` is refused: `claude` keeps it only with `-p`.

A session does not say what it loaded. So before it opens:

- The same `claude`, with the same options, home and workspace, runs headless with a token its
  broker refuses. The adapter stops it once it has said what it loaded, before its first request:
  it costs nothing.
- What it loaded is checked as an unattended attempt's is. If the check stops it, no session
  opens and the attempt fails.
- This assumes `claude` loads the same in a session as headless. Nothing checks that.
- Instruction files the session loads are recorded as an unattended attempt's are.
- The version noted is the dry run's. Nothing the agent says or does in the session is noted.

### Terminal and limits

- The step runs under `script(1)`, in a pseudo-terminal of its own. Its window follows your
  terminal's size, Ctrl-C reaches the agent, and the step cannot push input into your terminal.
  `TERM` is passed on.
- The transcript is what the terminal showed, escapes included. What you type is not kept.
- Output and your typing both count as activity for the `idle` limit. With an `idle` of 600 s, a
  session in which neither you nor the agent did anything for ten minutes is stopped.
- Only an attended step may declare `idle` or `attempt` as `"unbounded"`.
- An attended step reports no cost: commissioning refuses a `usd` limit on one.
- A cancel, or a limit, stops the step as any other.

### Keeping a session through a disconnect

If your terminal closes, the attempt is interrupted, and the commission escalates when next
advanced.

- To avoid it, attend from a terminal that outlives its client, on the machine that holds the
  log: tmux, dtach or a herdr pane. A dropped connection then only detaches you. `attend` and the
  agent run on, and you reattach to the same session. The `idle` limit still stops a session
  nobody returns to.
- To recover from it, route `interrupted` to a step that continues the session. See
  [Sessions](#sessions).
