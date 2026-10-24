# Medrengard — agent guide

Medrengard, a software delivery factory (`README.md`). The owner is the user.

Read first: `docs/STATUS.md` (the next action), `docs/workflow.md` (tickets,
branches, reviews, merges; follow it), `docs/specs/core-lifecycle-v1.md` (the
spec), your ticket under `docs/work/`. Before proposing a design, read
`docs/decisions.md` (latest entry wins) and `docs/open-questions.md`; before a
run with real runtimes, `docs/live-runs.md`.

- **Ubiquitous language:** work, ticket, cycle, stage, workflow, candidate,
  run, runtime, claim, evidence, verdict, budget, owner.
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
- **Checks:** `npm test`; `npm run test:learn` when `src/` exports change (the
  guide's stand-ins in `learn/shims/` must match).
- **End of session:** append to the ticket log and update `docs/STATUS.md`:
  what changed, which tests ran and their result, the next action. Parked
  findings go to `docs/work/parked.md`, accepted risks to
  `docs/work/accepted-risks.md`.
