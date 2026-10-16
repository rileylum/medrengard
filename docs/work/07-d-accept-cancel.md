# 07-d — Owner accept and cancel commands

Route: Fast. The lifecycle already has `accept` and `cancel` events; this ticket gives the owner a command for each (A-044).

Goal: the owner can accept or cancel a job's cycle from the command line, so a work ID can be run again without inventing a new one.

Done when:
- `node src/main.ts accept <job.json> <sha>` records `accept` on the job's open cycle when it is AWAITING_ACCEPTANCE and the SHA is its candidate head. It prints the stage and the merge line by SHA, and exits 0. Verified by test.
- `accept` writes nothing and exits 2 when the work has no open cycle, when the cycle is in another stage, or when the SHA is not the full candidate head. A typo never escalates a cycle. Verified by test.
- `node src/main.ts cancel <job.json>` records `cancel` on the job's open cycle, or on its latest ESCALATED cycle when none is open, prints the stage and exits 0. With neither it writes nothing and exits 2. Verified by test.
- After `accept` or `cancel`, `node src/main.ts <job.json>` opens a new cycle for the same work ID. Verified by test.
- `node src/main.ts <job.json>` still runs the job. On AWAITING_ACCEPTANCE it also prints the `accept` command and the merge line by SHA, not by branch, so the merge takes the accepted commit even if the branch moves. Verified by test.
- Parked 02-a note, busy timeout (the first ticket with two processes on one database): `cancel` from a second process while another connection holds the write lock waits and succeeds. Verified by test.
- Parked 02-a note, row 0 check: a cycle whose first row is not the open marker fails to load with an error naming the cycle. Verified by test.

Constraints: zero dependencies. `lifecycle.ts` untouched: apply already decides both events. No paid calls: tests seed the store.
Non-goals: stopping a run in progress in another process (its later events land on a terminal cycle and are ignored, but its current stage finishes); removing the clone, checkout or `sf/` branch; merging. Parked 02-a schema cleanup (`WITHOUT ROWID`, the partial index): proposed to drop, since existing databases would need a migration for no behaviour change; owner decides.
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-17 — owner: “Yep, let's add the accept and cancel commands now.” (A-044). Branch `feat/07-d-accept-cancel` off `feat/09-scoping` at `d54d731`.
