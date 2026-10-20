# sweep-lifecycle-constants — one home for settled stages and run outcomes

Route: Fast. A pure refactor: no behaviour changes, one obvious design, reversible.

Owner's instruction, 2026-10-20: "Once all this research comes back, triage it (merging similar things and organizing it, giving ratings for highest impact) - then create a worktree for each and spin up a sub agent to implement them. I want to come back tomorrow to a number of ready to merge branches, so we should only focus on the high quality and high impact ones. We will then work through them together, deciding if they should be merged or not, or if they need changes before going in - so you will need to explain each to me in plain english and defend the changes."

Source: TRIAGE.md item B10; architecture.md finding 4.

Goal: `src/lifecycle.ts` alone says which stages are settled and which events are a run's one outcome; the store, the controller and the guide's store stand-in read it from there.

Done when:
- `src/lifecycle.ts` exports `SETTLED` and `outcomeRunId(e)`; `src/store.ts`, `src/controller.ts` and `learn/shims/store.js` define neither list themselves.
- A lifecycle test ties `outcomeRunId` to every event type `isEvent` knows: a new event type whose shape requires a `runId` fails the test until `outcomeRunId` handles it [lifecycle: outcomeRunId names the run of every outcome event].
- Every existing test passes unchanged: `npm test` and `npm run test:learn`.

Constraints: no change in what the store writes or what apply decides. Zero dependencies. Keep `SETTLED` importable from `src/store.ts`, because `src/main.ts` and `learn/demos/sim.js` import it there.
Non-goals: the other duplication in architecture.md (runs folder, paths); making `apply`'s duplicate branches call `outcomeRunId`.
Verification: `npm test` and `npm run test:learn`, run by the owner on the final SHA.

## For the owner

**What was wrong.** Two small lists were written out by hand in several files. The settled stages (`ESCALATED`, `ACCEPTED`, `CANCELLED`) were in `src/store.ts`, `src/controller.ts`, the guide's `learn/shims/store.js`, and as `SETTLED_TARGETS` in `src/lifecycle.ts`. The run-outcome events (`developer_result`, `verdict`, `run_failed`, `dispute`) were in `src/store.ts` and the shim as `DEDUP`, and again in `apply`'s duplicate checks. HANDOFF says a new event type needs four places changed. Forget the store's list and the store would accept a second outcome for the same run.

**Reproduction.** `grep -rn "'ESCALATED', 'ACCEPTED', 'CANCELLED'\|DEDUP" src learn` at `a3c74ff` finds three copies of the settled list and two of the outcome list.

**What the change does.** `src/lifecycle.ts` exports `SETTLED` (the old `SETTLED_TARGETS`, renamed) and `outcomeRunId(e)`, which returns the run ID of an outcome event and `undefined` for anything else. The store builds its unique-index key from `outcomeRunId`. The controller imports `SETTLED`. The store re-exports `SETTLED` so `main.ts` and the guide's demo keep their imports. The shim imports both from `/src/lifecycle.ts`, as it already imports `apply`. `lifecycle.ts` also exports `EVENT_TYPES` (the keys of `SHAPE`) so the new test can list every event type.

**Why this and not the obvious alternative.** The obvious alternative is to export the `DEDUP` array. A function is better: the store needs the run ID, not only a yes or no, and the cast `(parsed as { runId: string }).runId` goes away. The other alternative is to treat any event that carries a `runId` as an outcome. That would change behaviour: `isEvent` tolerates extra fields, so a `verification` with a stray `runId` would start to be deduplicated.

**How many places a new event type needs now.** Three: the `Event` union and `SHAPE` in `src/lifecycle.ts`, and `toEvent` in `src/controller.ts`. If it is a run outcome, also `outcomeRunId` (same file) and its duplicate branch in `apply`; the new test fails until `outcomeRunId` handles it, and the test's sample table must list the new type. The store and the guide follow by themselves. HANDOFF's lesson should be updated after merge (HANDOFF is not in the repository).

**Risks.** Low. `SETTLED` now lists the stages in the order `ESCALATED, CANCELLED, ACCEPTED`; every user calls `includes`, and the one `join` (in `checkWorkflow`'s message) already used this order. The guide's browser shim now imports two more names from `/src/lifecycle.ts`; `npm run test:learn` checks it resolves.

**Not covered, noticed in passing.** The `append` doc comment in `src/store.ts` says "Only those three carry run_id"; there are four since `dispute` (07-e). Left alone: out of scope.

**Decision for the owner.** None beyond merge or not.

## Log
