# 09-d — Spec rewrite for the workflow engine

Route: Fast. Docs only (A-058); the code in 09-a to 09-c has already settled every design question.

Goal: `docs/specs/core-lifecycle-v1.md` describes what 09-a to 09-c built, so that the spec and the code agree again.

Done when:
- **Principles.** Principles 1, 2 and 4 stay core rules. Principles 3 (the review budget) and 5 (humans accept) become the default workflow's policy, as D-023 says. Checked against D-023 and `checkWorkflow` in `src/lifecycle.ts`.
- **Workflows.** A new section says that a workflow is plain data, that `checkWorkflow` checks it and `workflowHash` hashes it, and that the engine owns `QUEUED`, `ESCALATED`, `CANCELLED` and `ACCEPTED`. It names the three stage kinds (agent, command, human) and lists each refusal `checkWorkflow` makes, including "every agent loop spends a budget" and "an agent stage needs one-line role text". Checked against `src/lifecycle.ts` and `tests/lifecycle.test.ts`.
- **Identities.** The Cycle row lists one budget counter per budgeted stage, not `(standard, adversarial)`, plus the workflow name and hash. The Run row lists roles as workflow strings, with `ROLE_ALIASES` keeping `standard` and `adversarial`. Checked against `Cycle` in `src/lifecycle.ts` and `ROLE_ALIASES` in `src/run.ts`.
- **States.** The transition table is titled as the default workflow, `defaultWorkflow`, and matches it row for row. Engine rules that hold under any workflow (a SHA that is not the candidate, duplicate results, owner cancel, a new cycle after escalation) sit in their own table. Checked against `defaultWorkflow`, `apply` and SC-01 to SC-19.
- **Cycle records.** The spec says that a cycle records its workflow's name and hash when it opens, and that a store refuses a cycle whose hash differs from its own workflow's. Checked against `src/store.ts` and `tests/store.test.ts`.
- **Driver.** The spec says that one driver in `src/run.ts` runs any workflow by stage kind, and that the job file picks an adapter for each role. Checked against `src/run.ts`, `src/main.ts` and `tests/run.test.ts`.
- **Prompts and version records.** The spec says that a prompt is the stage's one line of role text followed by the contract part, which the core builds. `developer_result`, `verdict` and `run_failed` carry `contractHash` and `roleTextHash`. The contract hash covers the contract wording built from placeholders, never the text that was sent. Checked against `src/prompt.ts` and `tests/prompts.test.ts`.
- **Recovery.** The section says that `resume` exists and that no command calls it yet, and that the rest waits for row 11. It must not describe behaviour that nobody has built.
- Each rule sentence in the spec names the test that holds it, or is marked "proposal" (AGENTS.md). Checked by reading.
- The spec stays about two pages.

Constraints: docs only; no change under `src/` or `tests/`. Keep the file name, because AGENTS.md and other documents link to it. Plain language. Follow the latest decision where decisions disagree.
Non-goals: extension steps and the observation stream (row 10); recovery behaviour (row 11); the `learn/` guide; the 04-f, 06-d and 07-e changes.
Verification: the owner reads the rewritten spec against this list. No reviews run (D-017: design documents get no adversarial review on their own). `npm test` must still pass, to show that no code changed.

Sources: `docs/design/2026-10-19-workflow-engine.md`, `docs/design/2026-10-19-generic-driver.md`, decisions A-054 to A-064, the 09-c ticket log, and `src/lifecycle.ts`, `src/run.ts`, `src/prompt.ts` and `src/store.ts`.

## Log
- 2026-10-19 — drafted on `feat/09-d-spec-rewrite`, stacked on `feat/09-c-prompt-versions`. Not READY until the owner says go.
- 2026-10-19 — owner: “go on 09-d” (A-066); READY. Spec rewritten, uncommitted on `feat/09-d-spec-rewrite` (base `3e0eab0`). Every bracketed test reference was checked by script against the test names. A rule the code holds with no direct test (an event the stage's kind does not take) is marked proposal, as are the contract version and model, recovery (row 11) and recording the merge (row 12). The spec is 1,749 words against the old 834, so it is longer than two pages; the test references account for much of that. `git diff -- src tests` is empty. `npm test` on the working tree, implementer-run, not independent: 269 tests, 245 pass, 19 skipped, 5 todo, 0 fail. Next: the owner reads the spec against the done-when list.
- 2026-10-19 — owner, after the summary of the rewrite: “commit and lets progress”. Committed on `feat/09-d-spec-rewrite`. Row 9 is finished; the branch stack 09-a to 09-d merges on the owner's word.
