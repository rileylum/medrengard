# Current status

## Current next action — 2026-10-25

Main holds the core candidate plus ticket 13: idea to owner-approved plan
through `cli/medrengard.ts`, with a headless Claude Code planner on a
subscription token ([ticket 13](work/13-phase-1-plan.md)). Live run 1 took a
bolts_n_blades change through a plan, one feedback round, a refused stale hash
and approval. Gate: `systemd-run --user --scope --quiet npm test` 73/73.

The owner's factory is `~/dev/medrengard-factory` (`main`), with `.medrengard`
symlinked to this checkout; the token is in `~/.config/medrengard/claude-token`.

Open caveat: the `Skill` tool fix (`1d141f6`) has not been exercised by a live
planner run.

Next: a full run, as the owner asked (“we should finish a full run - currently
we've produced a plan, but we should be able to get that through implement and
review before we handle the listed tickets”). Draft its ticket with the owner:
developer and reviewer agents, a real check command for the target repository,
and whether the run publishes a PR. After it, the owner orders the following
tickets listed in the [roadmap](roadmap.md#progress).

## Guide — 2026-10-25

On `docs/guide`, built with the owner section by section: `docs/guide.md`
explains the modules, one run, building a factory (the owner's
`medrengard-factory` as the example) and changing the core. The README links
it; `AGENTS.md` gains a **Docs** rule naming which doc owns which fact.
`tests/docs.test.ts` fails on a broken relative link in the README or `docs/`,
a missing repository path named in a current doc (the decision log, research,
refactor, architecture and ticket logs are exempt) or a name linked to
`src/index.ts` that it does not export. It removed one stale sentence from
`live-runs.md`. Three language and API inconsistencies are parked in
[parked findings](work/parked.md) (the three senses of "extension", unexported
`Sandbox` and `RunResult`, "plan" and "spec" for a document); the guide uses
the code's meaning until they are settled. No code changed. Gate:
`systemd-run --user --scope --quiet npm test` 76/76. The next action above is
unchanged.

## Documentation sweep — 2026-10-25

On `docs/sweep-and-rename`, approved by the owner (“Fix all”, A-147): the
decision log is trimmed to rules in force with a retired-ID index (full text at
`c3f91f9`); research and architecture notes about deleted code are removed
(index in `docs/research/README.md`); stale claims in the README, threat model,
roadmap, open questions, core and live-run docs are corrected; superseded
session history is removed from this file. The checkout is being renamed to
`~/dev/medrengard`.
