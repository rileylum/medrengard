# learn-refresh — Fix the guide and expand it to the current factory

Route: Design. The expansion has real choices: which rooms, how each one shows its feature, and how the demos run code the browser cannot run as it is (A-092).

Goal: `npm run test:learn` passes, and the guide in `learn/` covers the factory as it is at `d48c8d9`, in few rooms that each show one thing and do not repeat each other.

Done when:
- `npm run test:learn` passes before any room grows, and after each batch. Verified by the implementer; the run is recorded as not independent.
- Each room in the table below is in `ROOMS`, covers the features listed for it, and shows them in the way listed for it. Verified by the owner's walkthrough.
- Only the simulator steps through a whole cycle. Every other demo shows one feature on its own. Verified by the owner's walkthrough.
- Each rule is explained in one room and linked from the others. A room has no takeaway slide of its own; its code is in one closing "Read the code" slide. Verified by the owner's walkthrough.
- Every claim on a changed slide is checked against `src/` at the branch tip by the implementer, and the ticket log lists the slides checked.
- `learn/README.md` describes the guide as it is after the change. `docs/plan.md` row 10 has its "Done" line.

Constraints: zero dependencies. No change to `src/`; `src/` does not import from `learn/`. Code is shown with live references, not copies. Pure logic runs through `liveFunction`. A stand-in is added only where the browser cannot run the real module. `npm test` is unchanged.
Non-goals: a full workflow editor in the simulator. The regex behind the review badges in `demos/wf-tickets.js`. Testing the sandbox's "who may touch what" table. A stand-in for `src/stream.ts`.
Verification: `npm run test:learn` and `npm test`, run by the implementer. No reviews: the owner walks through the finished guide in a browser (A-092, A-093).

## Design note

### The repetition, and the rule against it

The owner's critique (A-092) names three kinds of repetition:
- The same slide shape in every room: idea, "Try it", how it works, a dump of the code, then "Takeaway".
- The same message in every room: "agents claim, the controller decides" is in 12 files, and "adversarial" is in 11.
- The same demo form: several rooms step through a cycle or a scenario one event at a time (`start-journey`, `lc-drive`, `lc-scenarios`, `store-travel`, the simulator).

The rules:
1. Only the simulator steps through a whole cycle. Every other room shows its own feature, and nothing else.
2. Each room uses a demo form that no other room uses. The forms are in the table.
3. Each rule is said once, in the room that owns it. Other rooms link to it.
4. A room has no takeaway slide of its own; the guide ends with one. A room's code slides become one closing "Read the code" slide, at level 3.

### The rooms

The guide has 13 rooms, one more than now. Most new features join an existing room.

| # | Room (file) | Covers | How it is shown |
|---|---|---|---|
| 1 | The big idea (`start.html`) | Why the factory exists, the rules (checked against D-023 and D-024), and who does what | One still picture: no stepping. `start-journey` becomes a diagram with tips |
| 2 | The simulator (`sim.html`) | The whole cycle | Step through, the only room that does. A picker with three workflows: the default, one with a command stage, and one with a human stage. An events pane shows the cycle as `events` lines |
| 3 | Workflows (`lifecycle.html`) | Stages as data; the agent, command and human kinds; `checkWorkflow`; budgets per stage; the workflow chosen per job; the hash recorded on open | An editor. The reader edits a workflow; the real `checkWorkflow` lists the errors, and the stage map is redrawn from the workflow. `lc-drive` and `lc-scenarios` go; `lc-map` reads the edited workflow |
| 4 | The event log (`store.html`) | The append-only log, one outcome per run, one open cycle per work ID; `events`, `--follow`, observers | A query console over a recorded run: filter by work ID and `--after`, and read the lines. One "try to break it" panel gathers the redelivery, open and bytes cases. `store-travel` goes |
| 5 | Controller and owner (`controller.html`) | Claims and adapters, deadlines, plain data; `accept` and `cancel` with `--source` | The hostile-adapter lab: pick an attack, see the one event it becomes. A bad `--source` is one of the attacks |
| 6 | The developer (`developer.html`) | The prompt, the claim guard, the fix run, `dispute`, prompt versions (`src/prompt.ts`) | A diff: change the ticket or the role text, and see the prompt and its `contractHash` and `roleTextHash` change. The guard is a table of repository states and the refusal each gets |
| 7 | Checks and command stages (`verify.html`) | Verification on a fresh checkout, PASS, FAIL and MISSING, the tree check; `run`, `SF_REQUEST`, `outputDir`, `network`, file arguments by hash | A "what would run" builder: compose a command stage, and see the command, the environment, `SF_REQUEST` and the file hashes the controller would use |
| 8 | Reviews (`review.html`) | The two kinds of reviewer, the budget, the prompt, the cut | The budget as one table of every path, all shown at once. The cut is a slider |
| 9 | Sandbox and secrets (`sandbox.html`) | The bwrap policy; grants: where a secret travels and where it never goes, the head gate, the head file, redaction | The policy builder, and a trace of one grant's value: each place the value reaches is marked, and each place it must not reach is marked absent or redacted |
| 10 | Runtimes and kits (`runtimes.html`) | Runtime, model and role; the registry; extension runtimes; `runtimeKit`, `commandKit`, `observerKit` | Paste a reply: the real scanner finds the claim. The kits are shown as code |
| 11 | Configuration (`config.html`, new) | The four layers: factory defaults, personal, repository (read at the base SHA) and job; what the repository layer may not set | Four layer cards. The reader edits any of them, and sees the merged result with each value tagged by its layer, and the repository layer's refusals. It runs the real `merge` and `allow` from `src/config.ts` through `liveFunction` |
| 12 | How this repo is built (`process.html`, renamed from `workflow.html`) | Plan rows, tickets, reviews and decisions | Live docs, as now |
| 13 | The map of the code (`architecture.html`) | Every module, including `config.ts`, `prompt.ts`, `stream.ts`, `runtime/` and `kits/` | The module graph, as now |

"Workflow" is the engine's word in `src/` (`Workflow`, `checkWorkflow`), so the process room is the one renamed.

### How the new code runs in the browser

- `checkWorkflow` and `apply(c, e, w)` are pure and exported: the Workflows room imports them.
- `merge` and `allow` in `src/config.ts` are pure but not exported: `liveFunction` cuts them out. `loadConfig` reads files and Git, so the room shows it without running it.
- `src/stream.ts` opens SQLite itself. It gets no stand-in. The simulator's events pane formats the events kept in `shims/store.js`. That stand-in first gains 10-d's `pos`, `at` and `definition`.

### Alternatives considered

- **One room per feature (about 20 rooms).** Each room would be small and focused, but the guide gets longer, and the owner asked to keep the number small.
- **Keep the room shapes and only add content.** This is the least work, but it keeps the repetition the owner named.

## Order of work

Each batch ends with `npm run test:learn` green and a commit. The owner walks through the guide once all five are done (A-093).

0. **Green.** Fix the stale references (`developer.html`, `review.html`, `sim.html`), the cut functions in `shims/world.js`, and the missing exports (`createHash` in `shims/node/crypto.js`, `DEFAULT_RUNS_DIR` in `shims/sim-developer.js`, `noWorkflowDir` and `stageGrants` in `shims/sim-verify.js`). Bring `shims/store.js` up to 10-d. Add no new content.
1. **The frame and the core.** Apply rules 3 and 4 to every room. Rebuild rooms 1, 2 and 3.
2. **The cycle's parts.** Rooms 4, 5, 6 and 7.
3. **Around the cycle.** Rooms 8, 9, 10 and 11.
4. **The rest.** Rooms 12 and 13, the glossary (`words.html`), `learn/README.md`, and the `docs/plan.md` row 10 "Done" line.

## Log
- 2026-10-20 — drafted on `feat/learn-refresh` (A-092). Not READY until the owner says go; no change to `learn/` before that.
- 2026-10-20 — owner: “go ahead and do this work by yourself” (A-093). READY; all five batches are built before the owner's walkthrough.
- 2026-10-20 — built on `feat/learn-refresh` in five commits: batch 0 `bfe3350` and `be39161`, batch 1 `bf34e4d`, batch 2 `9bb92da`, batch 3 `4d8ed35`, batch 4 `31fddb2`. `npm run test:learn` passed after each batch (6 of 6). Implementer's `npm test` on `31fddb2` (not independent): 419 tests, 395 pass, 0 fail; no file in `src/` changed. Every room was checked in Chrome at level 3, and every simulator preset was run to its end. Slides whose claims were checked against `src/` at the tip: every slide of start, sim, lifecycle (Workflows), store, controller, developer, verify, review, sandbox, runtimes, config and architecture; process is live docs and was not re-read. Decisions the note left to the build, for the owner's walkthrough:
  - Batch 1's frame (no per-room takeaway, one "Read the code" slide) was applied to each room as it was rebuilt, not to every room in batch 1.
  - The simulator drops "Request changes": no command sends `request_changes`. The Workflows editor says so for human stages.
  - `process.html` was renamed in batch 1, not batch 4, so the new rooms could link to it.
  - `node:crypto`'s stand-in has a SHA-256 written out: `src/` hashes synchronously. Its hashes were compared with Node's, and the developer room's prompt hashes match a Node run.
  - `lines.js` mirrors `src/stream.ts#openStream` over the store stand-in, as the design note said; `shims/store.js` gained the workflow on open, `pos`, `at`, and `dispute` in its one-outcome rule.
  - Old demos removed: `lc-drive`, `lc-scenarios`, `lc-map`, `store-travel`, `dev-prompt`. `tests/scenarios.ts` is still read by `store-dedup`.
  - Not done: the README's known gaps (the regex review badges, the untested sandbox table) stay open, as the ticket's non-goals say.
- 2026-10-20 — owner: “Okay all good, merge” (A-094). Merged into main with `--no-ff`.
