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
   agents get neither unless declared.

Already supported, no change: stale-hash refusal, a `changes` edge to
`{ workflow: 'design' }` (resets the stage budget), `approve` to `DONE`, and
`deadlineMs`.

**Core extension (`extensions/claude-code/`):** wraps `commandRuntime`. Maps the
existing `Agent` fields onto `claude -p`: role and workflow guide to
`--append-system-prompt-file`, skills to `--plugin-dir`, plus
`--setting-sources project`, read-only `--allowedTools`, `--output-format json`
and `--no-session-persistence`. No `--bare`: it refuses OAuth. Prompt is the
input plus feedback; the final result becomes the document artifact. Design
stages get a read-only clone, so the planner writes no file.

**CLI (`cli/`):** `start "<idea>"`, `show <work>` (plan, hash, status, feedback
history), `decide <work> approve|changes <hash> ["feedback"]`. `start` and
`decide` advance automatic stages. Loads `factory.ts` from the working
directory. Input is a string; `lazy:` file and issue inputs, snapshotted at
entry when added.

**Owner factory (`~/dev/medrengard-factory`, separate repository):**
`package.json` `imports` map `#medrengard` to `.medrengard/`, a symlink to this
checkout during development. `factory.ts` declares the phase-1 workflow
(`design → approve`; `changes → design`; `approve → DONE`), the planner agent
(role, one basic plan skill, the workflow's global guide), its sandbox
(network, `CLAUDE_CODE_OAUTH_TOKEN`, a read path for the `claude` install), the
bolts_n_blades repository and a state directory outside `.medrengard/`.

**Boundary:** a test fails if code outside `src/` imports anything but
`src/index.ts`.

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
network access. The last two are following tickets; until then the factory uses
the development symlink, and `network` is all-or-nothing under the risk the
owner accepted in A-146.

## To put to the owner during implementation

- Whether `workflows/default.ts` gains the plan `changes` loop here.
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
