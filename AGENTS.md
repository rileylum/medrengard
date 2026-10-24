# Agent guide

The generic principles below come from agent-kit (`~/.config/agent-kit/AGENTS.md`).
What is specific to this project goes under **Project** at the end.

## Principles

1. **Deep modules.** Small interface, large implementation, at a seam chosen on purpose; a module passes the deletion test or it is a pass-through.
2. **Domain-driven design.** Use the project's ubiquitous language (see Project); packages are bounded contexts; aggregates enforce their own invariants; protocol adapters are anti-corruption layers.
3. **Lazy ladder.** Reuse → stdlib → platform → installed dependency → one line → minimum that works; YAGNI, deletion over addition, every deliberate ceiling carries a `lazy:` marker with its trigger.
4. **Test first at the seam.** Red, green, refactor; one behaviour per cycle; expected values anchored outside the implementation.
5. **Outside-in testing.** Prove the user's workflow at the seam a real caller crosses; unit tests only for genuine branching logic (parsers, compilers, policy evaluation, state machines); no tests for plumbing or coverage.
6. **Offensive, not defensive.** Parse and validate at trust boundaries only; trust internal callers; let a violated invariant fail loudly rather than recover silently.
7. **A seam needs two adapters.** The second may be a test fake, and only for an extension point the plan names; otherwise no seam.
8. **The generator is the style guide.** Where the project has a code generator or template, what it emits is the canonical pattern; change the generator first, docs follow.
9. **Cheap now, expensive later.** Cross-cutting constraints the project's scope names are allowed early; speculative features are not.
10. **Never lazy about** trust-boundary validation, data-loss paths, security, accessibility, or anything the plan asked for.
11. **Comments explain why, briefly.** State what the reader cannot recover from the code (the constraint, the upstream quirk, why the obvious approach fails) in one to three lines; `lazy:` markers name ceiling and trigger in code terms; public API gets a one-sentence doc comment; no TODOs, issue links or URLs — open work lives in the tracker, not the source.

## Git workflow

- The default branch (`main` or `master`) is guarded by a hook on shell
  commands: commits on it, pushes to it and `gh pr merge` are denied. Work on
  `<type>/<slug>` branches, push the branch, open a draft PR with
  `gh pr create --draft`. The user merges. Project may override this.
- The hook inspects the whole command string, so run `git switch -c` as its
  own command before committing; a compound `switch && commit` is denied as if
  still on the default branch.
- Pushing branches and opening draft PRs is expected and needs no further
  approval.

## Project

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
- **Git, overriding the kit:** `feat/NN-slug`, one ticket per branch; docs on
  `docs/<slug>`. Branches stay local; the owner merges with `git merge --no-ff`,
  which runs `scripts/pre-merge-commit`. Push only when the owner asks.
- **Checks:** `npm test`; `npm run test:learn` when `src/` exports change (the
  guide's stand-ins in `learn/shims/` must match).
- **End of session:** append to the ticket log and update `docs/STATUS.md`:
  what changed, which tests ran and their result, the next action. Parked
  findings go to `docs/work/parked.md`, accepted risks to
  `docs/work/accepted-risks.md`.
