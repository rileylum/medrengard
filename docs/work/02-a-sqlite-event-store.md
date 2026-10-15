# 02-a — SQLite event store

Route: Fast. Internal, no UX, no release impact, reversible.

Goal: a cycle's state survives a process restart.

Done when:
- Events append to a SQLite table keyed by cycle; verified by test.
- Loading a cycle replays its events through `apply` and yields the same stage and counters as the in-memory run; verified by a test that runs every SC-01 to SC-19 scenario through the store.
- A process killed between two events reopens the database and continues from the last committed event; verified by a test that spawns a child process and kills it.
- A duplicate event (same run ID) written twice changes nothing; verified by test.

Constraints: `node:sqlite` only. One table. No ORM, no migrations framework. The state machine stays pure; the store calls it.

Non-goals: leases, concurrency across processes, GitHub, any adapter.

Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-15 — ticket written; awaiting owner go.
- 2026-10-15 — owner: “go”. Branch `feat/02-a-sqlite-event-store`.
- 2026-10-15 — `b3280df`: owner-run `npm test` 20 pass, 5 todo, 0 fail. Standard 1 FAIL (major: `open()` on an existing cycle inserted a second open row at MAX+1 and broke replay). Fixed test-first; open inserts at seq 0 so the primary key rejects it.
