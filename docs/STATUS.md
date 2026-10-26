# Current status

## Current next action — 2026-10-26

[Ticket 14](work/14-full-run.md), the full run, is built on `feat/14-full-run`
(steps a to f, and step g's factory and dry run). Stages declare their access
(`none`, `scratch`, `full` write; history), command stages are owner code,
events record times, `claudeCodeRuntime` develops, reviews and keeps whole
transcripts, `githubPullRequest` publishes one draft PR per work, the default
routes failures to the owner, and the CLI shows commits and verdicts, takes
hash prefixes, prints progress and recovers interrupted runs. The owner's
factory is on its `feat/full-run` branch and passed a free dry run with the
real check.

Live run 2 took the rifle-hit idea from idea to draft PR
https://github.com/rileylum/bolts_n_blades/pull/80 with four paid Sonnet runs
($0.35 notional), no escalation; evidence and five findings are in the
ticket's log. The owner asked for four of the findings to be fixed; they are, test first
(structured commit messages and review summaries, a `deviation` gate before
review, recorded evidence in reviewer prompts), not yet exercised by a paid
run. Gate: `systemd-run --user --scope --quiet npm test` 106/106. The owner
will close PR 80. Next: the owner's review and merge of `feat/14-full-run`
and the factory's `feat/full-run`; then a confirming run if wanted, and the
following tickets in the roadmap.

## Previous next action — 2026-10-25

Main holds the core candidate, ticket 13 (idea to owner-approved plan through
`cli/medrengard.ts`, with a headless Claude Code planner on a subscription
token; [ticket 13](work/13-phase-1-plan.md)) and the [guide](guide.md). Live
run 1 took a bolts_n_blades change through a plan, one feedback round, a
refused stale hash and approval. Gate:
`systemd-run --user --scope --quiet npm test` 77/77.

The owner's factory is `~/dev/medrengard-factory` (`main`), with `.medrengard`
symlinked to this checkout at `~/dev/medrengard`; the token is in
`~/.config/medrengard/claude-token` (mode 600).

Open caveat: the `Skill` tool fix (`1d141f6`) has not been exercised by a live
planner run.

Next: a full run, as the owner asked (“we should finish a full run - currently
we've produced a plan, but we should be able to get that through implement and
review before we handle the listed tickets”). Draft its ticket with the owner:
developer and reviewer agents, a real check command for the target repository,
and whether the run publishes a PR. After it, the owner orders the following
tickets listed in the [roadmap](roadmap.md#progress).

What the full run meets today, checked against the code on 2026-10-25:

- **The check cannot run bolts_n_blades' tests yet.** Command stages get a
  bare sandbox with no `Sandbox.read` paths or network, so they see only the
  system directories. The owner's `node` is under `~/.config/nvm`, and
  `node_modules` is ignored by Git, so the snapshot has no `vitest` either.
  How a check gets its toolchain and dependencies is a core question for the
  owner; it touches the roadmap's “separating stage access from output
  contracts”.
- **`claudeCodeRuntime` only plans.** It allows read-only tools and turns the
  final message into a document. A developer needs write tools and a commit
  result; a reviewer needs a verdict naming the current SHA.
- **The developer's sandbox has no Git identity** (`HOME` is a private
  `/tmp`), so it must commit with explicit author settings or declared `env`
  names.
- **Adding `develop` changes the factory's workflows,** so the controller will
  refuse the factory's existing event log; start the full run on a fresh
  `path`.
- **The 30-minute stage deadline** may be short for a developer run
  ([parked](work/parked.md)).
- **No code-host client ships.** A `pr` extension is trusted host code, so it
  could call `gh` on the host; whether the run publishes is the owner's call.

## Guide — 2026-10-25

On `docs/guide`, built with the owner section by section: `docs/guide.md`
explains how it works in plain English, then building a factory (the owner's
`medrengard-factory` as the example) and changing the core. The README is
rewritten in plain English as the front door and links the guide; `AGENTS.md` gains a **Docs** rule naming which doc owns which fact.
`tests/docs.test.ts` fails on a broken relative link in the README or `docs/`,
a link to a heading that does not exist, a missing repository path named in a
current doc (the decision log, research,
refactor, architecture and ticket logs are exempt) or a name linked to
`src/index.ts` that it does not export. It removed one stale sentence from
`live-runs.md`. Three language and API inconsistencies are parked in
[parked findings](work/parked.md) (the three senses of "extension", unexported
`Sandbox` and `RunResult`, "plan" and "spec" for a document); the guide uses
the code's meaning until they are settled. No code changed. Gate:
`systemd-run --user --scope --quiet npm test` 77/77. The next action above is
unchanged.

## Documentation sweep — 2026-10-25

On `docs/sweep-and-rename`, approved by the owner (“Fix all”, A-147): the
decision log is trimmed to rules in force with a retired-ID index (full text at
`c3f91f9`); research and architecture notes about deleted code are removed
(index in `docs/research/README.md`); stale claims in the README, threat model,
roadmap, open questions, core and live-run docs are corrected; superseded
session history is removed from this file. The checkout was renamed to
`~/dev/medrengard`.
