# Medrengard — agent guide

Medrengard is a framework for building a personal software factory. The owner is the user.

Read `docs/core.md` first: the goal, principles, constraints, step contract and language.
Use its language exactly, including the words it rules out.
Then read `HANDOFF.md`, if present: where the last session stopped and the owner's standing decisions.

- **Design first.** The agent and the owner settle the design one decision at a time, with the
  agent's recommendation. Once the owner agrees, the agent writes the code test-first and reports
  the choices the owner did not see.
- **Cannot classify something?** Stop and ask the owner.
- **Specs:** a sentence in `docs/core.md` without a test is a proposal.
- **Tests** write only under the system temp directory, never inside the repository.
- **Checks:** `npm test` at the root: lint and format check, then each package's type check and
  tests. `npm test -w core` (or `-w bench`) runs one package's.
- **Layout:** npm workspaces. `core/` is Medrengard, the package `@medrengard/core`: zero runtime
  dependencies, and other packages import only what its `exports` names. `bench/` is the
  benchmark; its data live outside the repository (`bench/data.ts`), and a study runs from a
  worktree of its own (`bench/README.md`). Only a future `ui/` may take third-party runtime dependencies. The
  owner's factories stay in their own repositories.
- **Branches:** `<type>/<package>-<slug>`, or `<type>/<slug>` across packages; commit subjects
  start with the part they change (`engine:`, `bench:`, `monorepo:`).
- **Git, overriding the global workflow:** branches stay local; push only when the owner asks.
  The owner merges.
