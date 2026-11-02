# Medrengard — agent guide

Medrengard is a framework for building a personal software factory. The owner is the user.

Read `docs/core.md` first: the goal, principles, constraints, step contract and language.
Use its language exactly, including the words it rules out.
Then read `HANDOFF.md`, if present: where the last session stopped and the owner's standing decisions.

- **Rewrite in progress.** The agent and the owner settle the design first, one decision at a time,
  with the agent's recommendation. Once the owner agrees, the agent writes the code test-first and
  reports the choices the owner did not see.
- **Cannot classify something?** Stop and ask the owner.
- **Specs:** a sentence in `docs/core.md` without a test is a proposal.
- **Tests** write only under the system temp directory, never inside the repository.
- **Checks:** `npm test` (type check, lint, format check, tests).
- **Git, overriding the global workflow:** branches stay local; push only when the owner asks.
  The owner merges.
