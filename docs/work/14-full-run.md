# 14 — Full run: idea to published PR

Milestone: M2 in `docs/roadmap.md`, the rest of the
[first user journey](../roadmap.md#first-user-journey--agreed-2026-10-24)
after [ticket 13](13-phase-1-plan.md).
Decisions: [A-148](../decisions.md#a-148--2026-10-26--risk-appetite-mistakes-and-scope-not-hostile-input),
[A-149](../decisions.md#a-149--2026-10-26--full-run-scope-configurable-primitives-and-shipped-defaults).
Branch: `feat/14-full-run`. Status: planned.

## Behavior

The owner runs the factory's CLI with an idea, approves the plan as in ticket
13, and the rest runs without prompting: a headless Claude Code developer
commits the change in the work's clone; a check installs dependencies and runs
the repository's tests on a copy of that commit; a standard reviewer and then
an adversarial reviewer return verdicts bound to the commit's SHA, reading the
diff against the commit the work started from. A failed check or standard
review goes to one bounded fix. The owner sees the commit, the verdicts and
their findings, then accepts or asks for changes in ordinary language; changes
reach a fresh developer run and are checked and reviewed again. Accepting the
current SHA publishes it as a draft GitHub PR carrying the plan and evidence;
merging stays the owner's.

Every event carries the time it was recorded, and each Claude Code session's
full `stream-json` output is kept in the event log as runtime events.

Worked example: the bolts_n_blades rifle-hit change from ticket 13 (add
`weapon` to `MSG_HIT`, skip the hit sound for rifle hits, keep the knife).

## Principle

The core ships configurable, extensible primitives; the shipped agents,
extensions and workflow are sane defaults built from them, and the owner's
factory uses or replaces them (A-113, A-149). Code this ticket touches that
infers policy where it should be declared is refactored to match.

## Scope

**Core (`src/`), mechanism only:**

1. **Stage access.** A stage declares what its processes can reach, in one
   `access` field, instead of the core inferring it from `produces`:
   `workspace` (`empty`, the work's `repository` clone, or a `subject` copy of
   the current commit), `write`, and the existing `read`, `network` and `env`.
   Defaults come from the output contract: a commit stage gets the clone,
   writable; a stage over a commit gets a writable copy of it (a copy is
   disposable; evidence binds to the SHA, not the files); otherwise an empty
   directory. A stage's effective sandbox is its agent's sandbox (the
   runtime's own needs, such as the `claude` binary and token) joined with the
   stage's access. The core refuses only impossible combinations, such as a
   commit stage without a writable clone. `Stage.workspace` folds into
   `access.workspace`.
2. **Command stages are code.** An agent stage hands a request to a runtime;
   a command stage runs trusted owner code with a confined `execute`. The core
   stops hard-coding “argv exit 0 is PASS, and needs a commit”: `Stage.command`
   is removed and a command stage names its function with `extension`. The
   argv check becomes a shipped extension (below). Both kinds get the same
   access mechanism.
3. **The runtime sees the output contract:** `AgentRequest.produces`.
4. **Reviewers see history.** The workspace event records the clone's starting
   commit; `StageContext.base` carries it; a `subject` copy has Git history,
   so `git diff <base> HEAD` works. Snapshot integrity is unchanged: files are
   still the stored bytes of the SHA, and no candidate configuration runs.
5. **`StageContext.work`,** the work's ID, so a publisher can reconcile by
   work rather than by SHA.
6. **Event times:** each event records `time` (ISO 8601), for elapsed times
   and the parked smarter deadline.
7. **Streaming output:** `execute` can report stdout as it arrives, so a
   runtime yields events during a run and a transcript survives a killed run.
   The 8 MiB buffer cap is revisited if a streamed session exceeds it.

**Core extensions (`extensions/`):**

- `claudeCodeRuntime` follows `request.produces`. A document is the final
  message, as now. A commit: the runtime commits the worktree with a
  configured author (the sandbox has no Git identity) and returns HEAD. A
  verdict: `--json-schema` asks for `{ verdict, findings }`, and the runtime
  binds it to `context.subject`. Default tools follow the contract: read-only
  plus `Skill` for documents and verdicts, plus `Edit`, `Write` and `Bash`
  with permissions bypassed for commits; the owner overrides them with a
  `tools` option (a second runtime instance for a second set). The prompt
  comes from a default builder the owner can replace: the input, the latest
  plan (labelled by role: previous plan for a designer, approved plan
  afterwards), failing findings and check output for the current SHA, and the
  owner's latest feedback. Output is `stream-json`; each line is a runtime
  event and the result line is the claim.
- `commandCheck(argv)`: the former core command behaviour as a shipped
  extension. Runs argv in the stage's access; exit 0 is PASS, anything else
  FAIL with the output as the verdict's content.
- `githubPullRequest(options)`: trusted host code. Pushes the accepted SHA from
  its retained repository to `medrengard/<work>` on the owner repository's
  remote, finds an open PR for that branch before creating one (so a repeated
  or ambiguous publish does not duplicate it), and opens a draft PR with the
  plan and the evidence for the SHA. Returns the PR URL as a document bound to
  the SHA. Draft by default; configurable.

**Shipped default (`workflows/`):** example developer, standard reviewer and
adversarial reviewer roles beside the planner, with `exampleDeveloper`,
`exampleReviewer` and `exampleAdversarial`. `defaultWorkflows` declares access
per stage, takes the check's access from the owner (toolchain paths, network
for installing dependencies) and routes a failed check to the fix stage with
the review loop's bound. Its tests move to the new primitives.

**CLI:** `show` lists the commit, each verdict with findings, and the PR URL.
`decide` accepts a unique prefix of the current hash or SHA; a stale decision
prints the current one ([parked](parked.md)).

**Owner factory:** imports `defaultWorkflows` and the example agents, declares
the check (`npm ci` then `npm test`, with the `node` install readable and
network) and the publisher, and starts on a fresh event log (changed workflows
refuse the old one). `deadlineMs` is raised if a developer run needs it.

## Steps, each test first, checking in with the owner between them

- a. Risk appetite in the docs (A-148) and this ticket.
- b. Core: stage access and command stages as code (1, 2).
- c. Core: `produces`, base and history, work ID, event times, streaming (3–7).
- d. `claudeCodeRuntime` contracts, tools, prompt builder and transcripts.
- e. `commandCheck`, `githubPullRequest`, example agents and the default
  workflow.
- f. CLI.
- g. Factory, then the live run after the owner's separate approval.

## Acceptance

- Public-API tests with fake runtimes: declared access reaches the process
  (an undeclared path, network or variable is absent; a declared one is
  present); defaults match the output contract; impossible access is refused
  at setup; a reviewer copy can diff against the base; event times are
  recorded; streamed runtime events are kept when a run is killed.
- The default workflow test covers a failed check going to fix, and an owner
  change after review reaching the next developer run's request.
- `githubPullRequest` against a local bare remote and a fake `gh`: one PR per
  work across a repeated publish.
- `npm test` passes under `systemd-run --user --scope --quiet`.
- One live run, only after the owner's approval per `live-runs.md`: the worked
  example from idea to a draft PR on bolts_n_blades. Evidence: the event log
  with times and transcripts, plan hash, commit SHAs, verdicts and the PR URL.

## Out

Continuing an escalated work (start a new one), the stall timeout in place of
the stage deadline (parked; `deadlineMs` is raised instead), destination-specific
network, a second provider, interactive sessions, merging the PR, transcript
retention, and agents defined once with an access ceiling (stage access here
joins the agent's sandbox; a ceiling is added if a workflow needs one).

## To put to the owner during implementation

- The field holding a `--json-schema` result in Claude Code's output, checked
  with one small paid run if the help text does not settle it.
- Whether streamed sessions fit under the output cap, once a developer run's
  size is known.

## Log

### 2026-10-26 — Scope agreed

Handoff checks: the sweep is merged, `.medrengard` in the factory points at
this checkout, and only this worktree exists. bolts_n_blades' `vitest run`
passes on the host in about 4 s; `node_modules` (140 MB) is ignored by Git.
Claude Code 2.1.310 has `--json-schema`.

The proposal listed the core gaps (command stages without access, read-only
copies without dependencies, a runtime blind to the output contract, reviewers
without a diff, one deadline, no event times) and the default extensions
needed. Owner replies are quoted in A-148 and A-149: stage access and
command stages become configurable primitives; the stage deadline stays and is
raised if needed; event times and transcripts are in; the run publishes; Sonnet
throughout; escalation recovery is out.

### 2026-10-26 — Step b: stage access and command stages as code

Owner, on `write`: “I think we want 3 options, full write, scratch, no
write. Full write it can do everything; scratch, it can't write to the
workspace but has a persistent folder that outlives the session it can write
to (or we need some way to capture whats there before the session ends);
no-write, only tmp files”. Built as `write: 'none' | 'scratch' | 'full'`,
nested: every process has a private `/tmp`; `scratch` adds a folder per run
under the controller's directory, recorded in the `started` event and passed as
`MEDRENGARD_SCRATCH` and `context.scratch`; `full` adds the workspace. Scratch
is kept but is not evidence, and later stages do not see it.

`Stage.access` replaces `Stage.workspace`; `Stage.command` is removed and
`extensions/command-check` ships `commandCheck(argv)`. Setup refuses unknown
stage fields (so an old `workspace` or `command` fails loudly), invalid access,
a commit stage without a writable clone, and the reserved
`MEDRENGARD_SCRATCH`. `Access`, `Sandbox` and `RunResult` are exported (the
parked public-API finding is closed). `defaultWorkflows` now takes
`{ check?: Access }`.

Tests: `tests/e2e/access.test.ts`, 12 cases, red then green; the existing
suites moved to the new fields. Gate:
`systemd-run --user --scope --quiet npm test` 89/89.

The owner's factory still declares `workspace: 'repository'`, so through the
`.medrengard` symlink it is refused until step g updates it.

### 2026-10-26 — Step c: what a run is told, and what the log keeps

Owner, on history: “I think we should add access.history and set its default
to true.” Owner ideas parked: future `write` capabilities (a shared cache
path, later stages reading scratch, cleanup) and capturing the scripts agents
write so a repeated one can be proposed as a skill.

`AgentRequest.produces`; `StageContext.work`, `base` (the clone's HEAD,
recorded on the `workspace` event) and `execute(..., { onStdout })`;
`Access.history`, default on, fetches the commit's history into a `subject`
copy from the controller's retained repository and resets the index, so
`git status` is clean and `git diff <base> HEAD` shows the change. Every event
records `time` (ISO 8601); observers see it too. A runtime that yields events
while its process runs keeps them when the deadline kills the run. The parked
event-time finding is closed.

Tests: `tests/e2e/run-context.test.ts`, 4 cases, red then green; one access
test now expects `.git` in the default copy. Gate:
`systemd-run --user --scope --quiet npm test` 93/93.
