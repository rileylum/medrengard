# 13 — Phase 1: idea to owner-approved plan

Milestone: M2 in `docs/roadmap.md`, first slice of the
[first user journey](../roadmap.md#first-user-journey--agreed-2026-10-24).
Decision: [A-146](../decisions.md#a-146--2026-10-25--first-run-example-phase-split-subscription-token-factory-layout-and-installer).
Branch: `feat/13-phase-1-plan`. Status: agreed scope; implementation starts next session.

## Behavior

The owner runs the CLI from their factory with an idea as a string. A headless
Claude Code planner, confined and given only what the workflow passes, reads a
fresh clone and returns a plan document. The CLI shows the plan and its hash.
The owner either approves that exact hash, which ends phase 1, or requests
changes with feedback in ordinary language. Feedback is recorded durably and
reaches a fresh planner run, which returns a revised plan with a new hash.
Approval of a superseded hash is refused.

Worked example: bolts_n_blades, input “remove the hit sound from rifle hits, as
they aren't heard over the fire and bolt sounds”. The knife keeps its hit
sounds. A good plan notices that the server's Hit message carries no weapon
(`docs/protocol.md:21`) and asks how the client tells a rifle hit online; it
does not settle that silently. This run tests the workflow, not prompt quality.

## Scope

**Core (`src/`), mechanism only:**

1. `decide(id, outcome, subject, feedback?)` records the feedback in the
   decision event. Replay keeps it; the next agent run receives it in a new
   `AgentRequest.feedback` field. Hash binding of decisions is unchanged.
2. `Sandbox` gains `network?: boolean` and `env?: string[]`, names of variables
   copied from the controller's environment. Both default off; commands and
   agents get neither unless declared. Values reach bwrap through its
   environment, not its arguments; setup refuses invalid, reserved (`PATH`,
   `HOME`, `LANG`) and unset names.
3. `Stage.workspace: 'repository'` gives a stage a fresh clone of the owner
   repository, read-only unless it produces a commit. Found during
   implementation: design stages had an empty workspace, not a clone.

Already supported, no change: stale-hash refusal, a `changes` edge to
`{ workflow: 'design' }` (resets the stage budget), `approve` to `DONE`, and
`deadlineMs`.

**Core extension (`extensions/claude-code/`):** `claudeCodeRuntime({ command,
settingSources })`, its own runtime over `context.execute` (per-request argv
does not fit `commandRuntime`). Maps the existing `Agent` fields onto
`claude -p`: role (with the workflow guide) to `--append-system-prompt`, skills
to `--plugin-dir`, plus `--setting-sources` (default `user`; `project` only for
a trusted repository), `--tools Read,Grep,Glob`, `--strict-mcp-config`,
`--output-format json` and `--no-session-persistence`. No `--bare`: it refuses
OAuth. Prompt is the input, the previous plan and the latest feedback; the
final result becomes the document artifact. Design stages get a read-only
clone, so the planner writes no file.

**CLI (`cli/`):** `start "<idea>"`, `show <work>` (plan, hash, status, feedback
history), `decide <work> <outcome> <hash> ["feedback"]`, outcome names from the workflow. `start` and
`decide` advance automatic stages. Loads `factory.ts` from the working
directory. Input is a string; `lazy:` file and issue inputs, snapshotted at
entry when added.

**Shipped default (`workflows/`):** the default's `design` workflow gains
`changes → design` and a repository workspace, with feedback reaching the fresh run; `accept` still starts
`develop`. The example planner role, basic plan skill and workflow guide ship
beside it, so the default is runnable and is the template the installer will
seed. `tests/default-workflow.test.ts` covers the new loop.

**Owner factory (`~/dev/medrengard-factory`, separate repository):**
`package.json` `imports` map `#medrengard` to `.medrengard/`, a symlink to this
checkout during development. `factory.ts` uses the shipped planner role, skill
and guide, and declares a phase-1 workflow of the default `design` shape with
`accept → DONE`, because `develop` has no real agents yet; it switches to
importing the default once `develop` is built. It also declares the planner's
sandbox (network, `CLAUDE_CODE_OAUTH_TOKEN`, a read path for the `claude`
install), the bolts_n_blades repository and a state directory outside
`.medrengard/`.

**Boundary:** a test fails if shipped code outside `src/` (`workflows/`,
`extensions/`, `cli/`, `scripts/`) imports anything but `src/index.ts`; tests
are exempt.

## Acceptance

- Public-API tests with fake runtimes: a plan and its hash are shown; feedback
  reaches the next run's request, including after a controller restart; a
  superseded hash is refused; approving the current hash ends the work.
- Sandbox tests: network and named variables are absent unless declared; an
  undeclared variable is invisible; existing confinement tests still pass.
- `npm test` passes under `systemd-run --user --scope --quiet`.
- One live run, only after the owner's separate approval per `live-runs.md`:
  the worked example through plan, one feedback round and approval. Evidence:
  the event log, both plan hashes, and whether the plan raised the Hit-weapon
  question.

## Out

Interactive herdr sessions (phase 2), develop/check/PR stages, input types
other than a string, multiple repositories or projects per factory, recovery
beyond today's escalation, the install script, and destination-specific
network access. The last two are following tickets, as is separating stage
access from output contracts (log, 2026-10-25 implementation); until then the factory uses
the development symlink, and `network` is all-or-nothing under the risk the
owner accepted in A-146.

## To put to the owner during implementation

- Verify headless use of a `claude setup-token` token via
  `CLAUDE_CODE_OAUTH_TOKEN` before relying on it; the owner creates the token.

## Log

### 2026-10-25 — Scope agreed

Recorded from the owner's replies quoted in A-146. Repository surveyed:
bolts_n_blades tracks code and public docs only; its handoff, design docs,
plans and agent configuration are ignored, so a clone gives the planner none of
the slice-4 background. Node 24 checks: TypeScript under `node_modules` is
refused (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`); a symlinked package
and a `#medrengard` subpath import of `.medrengard/src/index.ts` both run.
Documentation only; no tests rerun.

Owner, on the token and network risk: “As for the risk it's fine, but a follow
up needs to be specific network access rather than a simple on/off”. Recorded
in A-146 and the accepted risks.

Owner: “Commit and then handoff so the next session will start with the
implementation”. Implementation proceeds step by step with the owner in the
loop. This does not approve the paid live run.

Owner, on the default workflow: “I suppose whatever workflow we build should
probably become the default? And we can ship it as the example and a sane
default?” After the recommendation (ship the workflow and example agents as the
default; keep personal content in the factory; import rather than copy until it
diverges; the default stays the whole journey): “Yes record it”.

### 2026-10-25 — Implementation, steps a to d

Owner, on feedback: “latest only is all good”; on images: text only for now
(“Yep go ahead with text only”; `lazy:` attachments). On `env`: “yes we should refuse at setup”. On network:
“an obvious follow up task will be to work out how to be more strict with
Internet access”. On settings: “I think we should load project settings - you
are specifically enabling the workflow on a repo, the user can accept that
risk. Though I suppose it should be configurable - and make it clear that you
should use user settings only unless you trust the repo. In this case I trust
the repo”. On the missing clone: “When you're designing/planning a code change
it obviously needs the clone - if you're doing a prototype you might not.
Option A looks good”. On outcome names: “Accept can stay”.

Planned follow-up, owner: “I think we should decouple as described and rely on
customisable , extensible primitives. I think defining agents is useful though
so you don't have to continue to redefine them. So this should probably be
something that is defined outside a workflow and can be imported into one or
many workflows multiple times”. Finding: a stage's access (workspace,
writability) is inferred from `produces`, and network and credentials sit on
the `Agent`. Direction: agents are defined once and imported, declaring
identity, credentials and an access ceiling; stages declare the access a use
needs within it; the core keeps output contracts, derived defaults and refusal
of impossible combinations. Design it with destination-specific network.

Commits: `3abfc12` feedback, `a42ca10` sandbox network and env, `0c2e927`
import boundary, `6cf2d02` repository workspace, `ae06195` Claude Code runtime.
Each step test first; `systemd-run --user --scope --quiet npm test` 68/68.

### 2026-10-25 — Steps e and f, headless token check

Shipped default: `design` reads the repository and loops on `changes`
(`1764a50`); example planner role, guide and plan skill with `examplePlanner`
(`5893771`). The owner compared a simplified `plan-work` skill and chose the
original: “lets just go with your original, this is too complicated for our
initial testing run.” CLI `start`, `show`, `decide` (`2361020`); refused setup
reported without a stack trace (`eaf286a`). Factory
`~/dev/medrengard-factory`, branch `feat/phase-1-factory` (`6b144a3`),
`deadlineMs` 30 minutes after the owner asked about 20-minute runs; a smarter
deadline is parked. Gate: `systemd-run --user --scope --quiet npm test` 72/72.

Token: created by the owner with `claude setup-token`, stored in
`~/.config/medrengard/claude-token` (mode 600) and read into
`CLAUDE_CODE_OAUTH_TOKEN`; never printed. Owner: “Approved” for one confined
headless check. Result through `src/sandbox.ts` with network, the token only,
`HOME=/tmp` and the runtime's flags (`--tools Read,Grep,Glob`,
`--setting-sources project`): exit 0, 3.2 s, `subtype: success`,
`is_error: false`, `result: "ok"`, one turn, model `claude-sonnet-5-5`,
reported cost $0.0081. This does not approve the live run.

### 2026-10-25 — Live run 1

Owner approval: after the plan (factory as built against `~/dev/bolts_n_blades`,
state in the factory's `state/` rather than `/var/tmp/software_factory/live-N/`;
two Sonnet planner runs, no retries; the owner runs the CLI), the owner asked
“Why don't I run the CLI command?” and then ran it. Work `4834a9c6`, input
verbatim as above.

- Run 1: `opened → started design → workspace → runtime exit 0 → completed →
  approve`, plan `f832bfed…3b45`, 3740 characters, “a minute or two at most”
  (owner; events carry no time). It raised the Hit-weapon question unprompted:
  `MSG_HIT` carries `victim, box, damage, killed` and no weapon, with options to
  infer from damage or add a field. Its default muted online knife hits, and
  approving would have meant that default; the owner found choosing between
  nested options confusing.
- Feedback, verbatim: “Okay option A is correct, except we'll need to
  implement the weapon field to MSG_HIT so we can correctly just remove the
  rifle hit in online play whilst preserving the knife”.
- Run 2 reused the clone: plan `2e664003…884a` adds `weapon` to `MSG_HIT`,
  bumps the protocol to 10 and plays the sound unless the weapon is the rifle;
  one open question with a default.
- Stale `accept` of the first hash: run by the owner; no event written. Accept
  of the second hash: `decision accept → DONE`. Ten events; two paid planner
  runs as planned; no seeded stages.

Finding: neither plan used the plan skill. `--tools Read,Grep,Glob` removes the
`Skill` tool, so the registered `medrengard-plan:plan` skill cannot be invoked;
confirmed by two `stream-json` init checks (with `Skill` it is available),
about $0.019 notional. Undeclared bundled plugins and skills, event times and
full transcripts are parked; the owner wants the entire stream kept.
