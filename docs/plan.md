# Implementation plan

Build one vertical slice at a time. Each step ends with a test that runs.

| Step | Deliverable | Done when |
| --- | --- | --- |
| 1 | Pure lifecycle state machine | SC-01 to SC-19 pass (`npm test`). **Done 2026-10-15.** |
| 2 | SQLite event store | Cycles survive a process restart; replaying the event log rebuilds the same state |
| 3 | Runtime spike | A script launches `claude -p` and `pi -p` with JSON output, captures the result, and cancels a run mid-flight |
| 4 | Fake adapter and adapter interface | Normal, malformed, timeout, cancel and duplicate results all drive the state machine correctly |
| 5 | Real developer run | One READY ticket in a scratch repository produces a commit in an isolated worktree |
| 6 | Verification and reviews | Controller runs the repository's checks and launches fresh-context standard and adversarial reviewers |
| 7 | End to end | One ticket goes READY to human-reviewable PR with no manual stage advancement, including one standard FAIL and fix |
| 8 | GitHub sync, pools, release tracking, improvement loop | Per source §§6, 11, 13 |

Measure as you go: stage waits, manual interventions, review attempts, confirmed defects. Automate the next most repeated manual step.
