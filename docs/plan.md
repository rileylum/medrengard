# Implementation plan

Build one vertical slice at a time. Each step ends with a test that runs.

| Step | Deliverable | Done when |
| --- | --- | --- |
| 1 | Pure lifecycle state machine | SC-01 to SC-19 pass (`npm test`). **Done 2026-10-15.** |
| 2 | SQLite event store | Cycles survive a process restart; replaying the event log rebuilds the same state. **Done 2026-10-15** (tickets 02-a, 02-b, 02-c; findings in [work/parked.md](work/parked.md)). |
| 3 | Runtime spike | A script launches `claude -p` and `pi -p` with JSON output, captures the result, and cancels a run mid-flight. **Done 2026-10-15** (tickets 03-a, 03-b; A-019). |
| 4 | Fake adapter and adapter interface | Normal, malformed, timeout, cancel and duplicate results all drive the state machine correctly. **Done 2026-10-16** (tickets 04-a, 04-b, 04-c; A-023; real adapters follow as 04-d). |
| 5 | Real developer run | One READY ticket in a scratch repository produces a commit in an isolated worktree. **Done 2026-10-16** (tickets 05-a, 05-b; A-026, A-027; findings in [work/parked.md](work/parked.md)). |
| 6 | Verification and reviews | Controller runs the repository's checks and launches fresh-context standard and adversarial reviewers. **Done 2026-10-16** (tickets 06-a, 06-b, 06-c; A-028 to A-031; findings in [work/parked.md](work/parked.md)) |
| 7 | End to end | One ticket goes READY to human-reviewable PR with no manual stage advancement, including one standard FAIL and fix. **Done 2026-10-16** (tickets 07-a, 07-b, 07-c; A-032 to A-034; `node src/main.ts <job.json>`; with no remote the PR is the local `sf/<cycleId>` branch; findings in [work/parked.md](work/parked.md)) |
| 8 | Sandbox | Candidate code (checks, developer, reviewers) runs inside a sandbox named by backend; the parked sandbox class is closed by tests, and the loop may point at a real repository. Tickets 08-a (checks), 08-b (fix for 08-a's adversarial FAIL), 08-c (developer and reviewer runs); A-035 to A-037. 08-a and 08-b done 2026-10-16, merged with 08-b's adversarial FAIL parked. **Done 2026-10-17** (08-c to 08-f; A-038 to A-043; the scratch-only limit is lifted, A-043) |
| 9 | Workflow engine (refactor) | The lifecycle is a workflow definition run by a generic engine; today's lifecycle is the default workflow and SC-01 to SC-19 pass against it. The engine checks a workflow against the guarantees (D-023) before it runs. `run.ts` drives any workflow by step kind and resumes a cycle from its stored stage. Each run records the workflow and prompt versions it used (A-054, A-055). **Done 2026-10-19** (09-a to 09-d; A-057 to A-066; reviews waived, A-058, A-060, A-063) |
| 10 | Extension host and observation stream | A user's TypeScript extension can run as a command stage in a workflow, inside the sandbox, and can observe the event stream. Runtimes and sandboxes are chosen by name from a registry, not a switch in `main.ts`, and configuration comes in four layers. Each seam has a contract test kit (A-054, A-055, A-074). Tickets 10-a registries, 10-b configuration layers, 10-c command stages, 10-d observation stream, 10-e grants; 10-f fixes for 10-a's adversarial minors. **Done 2026-10-20** (10-a, A-076; 10-f, A-077; 10-b `c04b4b8`, A-080; 10-c `c5ac950`, A-082; 10-e `8cb9dce`, A-086; 10-d `d48c8d9`, A-090) |
| 11 | Recovery | A crash or Ctrl-C mid-run no longer strands a cycle: the controller finds cycles left in a non-settled stage and resolves them per source §06 ("Failure and recovery"). Built on the engine's resumable driver. Tickets not yet written |
| 12 | Tracker and code host sync | A GitHub issue named on the command line runs to a PR whose description is the review package; merging it on GitHub records `accept` when the merged head is the candidate SHA; closing it unmerged records `cancel`. `local` and `github` adapters behind `Tracker` and `CodeHost` (A-052, D-022) |
| 13 | Pools, acceptance evidence, structured findings, improvement loop, release tracking | Per source §§6, 11, 13 and A-051. Split and order not yet decided. Acceptance evidence is the first stage added through the workflow format (A-055) |

## What the engine must allow for

Rows 9 and 10 are built with the later rows and open questions in view (A-055), so each later feature is a workflow, a step or an extension, not a change to the engine. What each one needs from the engine:

| Later work | Needs from rows 9 and 10 |
| --- | --- |
| Recovery (row 11) | A driver that resumes a cycle from its stored stage, not only from the developer run. Runs recorded as started, so an orphan can be found. A relaunch budget per cycle for infrastructure failures, separate from the review budget |
| Tracker and code host (row 12) | Human decision steps that an outside source can settle (a merge on GitHub becomes `accept`). Capability grants, so a merge or deploy extension can hold credentials that no agent sandbox sees (O-016) |
| Role prompts and skills (O-013, O-014) | Prompts and skills attached to agent steps in the workflow, not written in `developer.ts` and `review.ts`. The prompt split in two: the controller's contract (claim format, SHAs, delimiters), which the core owns, and the role's judgement text, which the workflow owns. A content hash of each recorded on the run. Live run 2026-10-20 (`/var/tmp/software_factory/live-1/`) found two gaps in today's wording. First, the developer's contract says "commit it" but not which git commands it may run (only `git add`, `commit`, `status` and `rev-parse`). Run 2 wrote the change, did not commit, and claimed the base SHA; the likely cause is a commit through `$(cat <<EOF …)`, which the allow list denies. Second, the reviewer prompt shows a check's exit and output but not the command it ran. Run 1's reviewer read a silent check's `exit 0` as the script's own exit and failed a correct change; the developer disputed, and the cycle escalated |
| Acceptance evidence (A-051, O-015) | Steps that compose: an agent step writes a script, a controller command step runs it at the SHA. A rerun budget per step. Artifacts stored under `evidence/<head>/` |
| Structured findings | Data passed between steps through the workflow (a review's findings into the fix step), not hard-coded in `fix()` |
| Pools | A driver per cycle with no shared state, so several cycles can run at once |
| Improvement loop and metrics | The observation stream, and step and run timings in the event log. Each run's raw runtime output kept under `runsDir`: live run 2026-10-20 could not show why the developer did not commit, because claude runs with `--no-session-persistence` and nothing keeps its stdout or stderr |
| Release tracking and deployment (O-009) | Command stages after acceptance, with grants |
| Design Studio (O-012) | Stages with no candidate yet. The SHA guarantee applies to steps that produce evidence about code |
| herdr frontend (O-010) | The observation stream drives the board. An owner's message to an agent is recorded as an event that later steps can see |
| Configuration | Layers: factory defaults, personal, repository, job |

Measure as you go: stage waits, manual interventions, review attempts, confirmed defects. Automate the next most repeated manual step.
