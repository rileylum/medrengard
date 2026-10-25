# Medrengard — agent guide

Medrengard, a software delivery factory (`README.md`). The owner is the user.

Read first: `docs/core.md` (what the core is; it overrides every other doc),
`docs/STATUS.md` (the next action), and `docs/roadmap.md` (forward scope and
completion milestones). The core refactor is complete (`docs/refactor/log.md`);
older tickets, research and the former workflow guide remain in Git history.
Before proposing a design,
read `docs/decisions.md` (latest entry wins) and
`docs/open-questions.md`; before a run with real runtimes, `docs/live-runs.md`.

- **Ubiquitous language:** work, ticket, cycle, workflow, stage, artifact,
  agent, runtime, run, claim, evidence, verdict, budget, extension, observer,
  owner.
- **Cannot classify it?** Stop and ask the owner; do not invent a recovery path.
- **Approvals** are the owner's quoted, dated reply, logged in the ticket log
  (in `docs/decisions.md` when the owner asks). Never invent one.
- **Mechanism, not policy:** the core ships mechanism and a sane default;
  policy lives in workflows and extensions (A-113). A ticket that adds policy
  names its extension point, built only once something the owner runs needs it
  (A-124).
- **Dependencies:** Node 24 built-ins (`node --test`, `node:sqlite`, native
  TypeScript); none until a test needs one.
- **Specs:** a spec sentence without a test is a proposal.
- **Git, overriding the global workflow:** `feat/NN-slug`, one ticket per
  branch; docs on `docs/<slug>`. Branches stay local; the owner merges with
  `git merge --no-ff`, which runs `scripts/pre-merge-commit`. Push only when
  the owner asks.
- **Docs:** a behaviour change updates, on the same branch, the one doc that
  owns the fact (README: how to run; `docs/core.md`: rules; threat model:
  permissions; `docs/guide.md`: explanation), and other docs link to it rather
  than restate it; `tests/docs.test.ts` must pass.
- **Checks:** `npm test`; for the real bubblewrap tests,
  `systemd-run --user --scope --quiet npm test`.
- **End of session:** append to the current ticket's log
  (`docs/work/NN-slug.md`) and update `docs/STATUS.md`:
  what changed, which tests ran and their result, the next action. Parked
  findings go to `docs/work/parked.md`, accepted risks to
  `docs/work/accepted-risks.md`.
