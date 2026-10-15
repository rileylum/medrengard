# Current status

## Where we are

Design iteration stopped (A-016). Implementing [core lifecycle v1](specs/core-lifecycle-v1.md). Cycle-13 withdrawn before review; cycles 1–12 and v0.2 are archived reference under `docs/reviews/` and `docs/specs/`.

## In progress: SF-003 project setup

- Zero-dependency Node 24 toolchain: `node --test`, `node:sqlite`, native TypeScript stripping. Probe passed 2026-10-15.
- `src/lifecycle.ts`: pure state machine from the v1 transition table.
- `tests/lifecycle.test.ts`: SC-01 to SC-19 from the v0.2 scenario file, adapted to v1 semantics.

## Checks run

2026-10-15: `npm test` — 21 tests, 16 pass, 5 todo (SC-09, 10, 12, 14, 15 need readiness, waiver, finding and package models that v1 does not have yet), 0 fail.

## Next action

SF-004: SQLite event store behind the state machine, then the O-001 spike script that launches `claude -p` and `pi -p` with JSON output and a cancel mid-run.
