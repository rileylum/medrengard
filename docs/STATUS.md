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

## Documentation sweep — 2026-10-25

On `docs/sweep-and-rename`, approved by the owner (“Fix all”, A-147): the
decision log is trimmed to rules in force with a retired-ID index (full text at
`c3f91f9`); research and architecture notes about deleted code are removed
(index in `docs/research/README.md`); stale claims in the README, threat model,
roadmap, open questions, core and live-run docs are corrected; superseded
session history is removed from this file. The checkout is being renamed to
`~/dev/medrengard`.
