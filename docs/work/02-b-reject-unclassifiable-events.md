# 02-b — Reject unclassifiable events

Route: Fast. Fix ticket for 02-a's adversarial FAIL on `7cff2de`. Internal, no UX, reversible.

Goal: an event the state machine cannot classify never reaches the log, and the store never decides state that `apply` would decide differently.

Done when:
- `apply` given an event of unknown type escalates with a note, instead of returning undefined; verified by test.
- `append` rejects an event whose type `apply` does not handle, or whose required fields are missing, before writing; the log stays loadable; verified by test.
- `open` and `append` reject empty or non-string cycle and work IDs; verified by test.
- Store dedup only covers what the spec dedups: `developer_result` and `verdict` by run ID. A redelivered `claim` reaches `apply`; verified by a test that replays the adversarial reviewer's divergence sequence and gets the same stage and counters in memory and from the store.
- `tests/lifecycle.test.ts` and the store replay test read SC-01 to SC-19 from one source, so the copies cannot drift; verified by `npm test`.

Constraints: as 02-a. `node:sqlite` only, one table, state machine stays pure. Branch is stacked on `feat/02-a-sqlite-event-store`; the PR carries both tickets and the owner merges once.

Non-goals: cross-process concurrency, busy timeouts, tamper detection on row 0, schema cleanup (`WITHOUT ROWID`, partial index). Noted in the 02-a adversarial verdict for the controller ticket.

Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-15 — ticket written after 02-a adversarial FAIL; owner: “Yes option 1.” Owner: “go”. Branch `feat/02-b-reject-unclassifiable-events`.
