# Medrengard — agent guide

Medrengard is a framework for building a personal software factory. The owner is the user.

Read `docs/core.md` first: the goal, principles, constraints, step contract and language.
Use its language exactly, including the words it rules out.

- **Rewrite in progress.** The owner writes the code; the agent explains, directs and reviews.
  Edit files only when the owner asks.
- **Cannot classify something?** Stop and ask the owner.
- **Specs:** a sentence in `docs/core.md` without a test is a proposal.
- **Tests** write only under the system temp directory, never inside the repository.
- **Checks:** `npm test` (type check, lint, format check, tests).
- **Git, overriding the global workflow:** branches stay local; push only when the owner asks.
  The owner merges.
