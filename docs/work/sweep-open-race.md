# sweep-open-race — Two processes cannot open two cycles for one work item

Route: Fast. The spec already states the rule ("One work item has at most one open cycle"); this makes the store keep it across processes.

Goal: `EventStore.open` runs its checks and its insert under one write lock, so two processes racing to open a cycle for one work ID open one cycle, and the other is refused.

Done when:
- A test starts two processes that each open a cycle for the same work ID, with a third connection holding the write lock until both have started. One opens; the other is refused with "already has an open cycle"; the store holds one cycle for the work. Verified by `npm test` (implementer's run).
- The test fails on the unchanged code because both processes open a cycle.
- The comment above the insert no longer claims a racing open collides on the primary key.

Constraints: zero dependencies. The same pattern as `addPositions` (`BEGIN IMMEDIATE`, `COMMIT`, `ROLLBACK` on error). No change to `open`'s checks or messages.
Non-goals: locking for `append` (one statement, already atomic). Two processes driving one open cycle (row 11). `learn/shims/store.js`: it is a single-threaded array in the browser and has no second writer, so it has nothing to mirror. The guide's sentence on `learn/store.html` that repeated the wrong primary-key claim is corrected.
Verification: `npm test` and `npm run test:learn`, run by the implementer.

## For the owner

Owner's instruction (2026-10-20): "Once all this research comes back, triage it (merging similar things and organizing it, giving ratings for highest impact) - then create a worktree for each and spin up a sub agent to implement them. I want to come back tomorrow to a number of ready to merge branches, so we should only focus on the high quality and high impact ones. We will then work through them together, deciding if they should be merged or not, or if they need changes before going in - so you will need to explain each to me in plain english and defend the changes."

**What was wrong.** `EventStore.open` first asks the database "does this work already have an open cycle?", then writes the new cycle in a second statement. Nothing holds the two together. If you run `main.ts job.json` in two terminals at once, both processes can ask before either writes. Both hear "no", and both write. The work then has two QUEUED cycles, and the factory pays for two developer runs. The comment above the insert said a racing open would collide on the primary key. That is true only when both use the same cycle ID; two runs make different cycle IDs, so nothing collides.

**Reproduction.** `/var/tmp/software_factory/research-2026-10-20/sweep/probes/race-open.ts`: at `a3c74ff` it prints "opened c-a", "opened c-b", and two cycles for `w1`. The new test in `tests/store.test.ts` does the same thing.

**What the change does.** `open` now starts a `BEGIN IMMEDIATE` transaction before its checks and commits after the insert. `BEGIN IMMEDIATE` takes SQLite's write lock at once, so a second process waits (up to the store's 5 s busy timeout) until the first has committed. When it then runs its checks, it sees the first cycle and is refused with the usual message.

**Why this and not the obvious alternative.** A unique index on "one open cycle per work ID" cannot work: whether a cycle is open depends on replaying its events, not on a column. A plain `BEGIN` (deferred) takes only a read lock at the checks, so both processes would read, then one would fail to upgrade with `database is locked` instead of the clear message. `addPositions` in the same file already uses `BEGIN IMMEDIATE` for the same kind of check-then-write.

**Risks and what it does not cover.** `open` now holds the write lock while it replays the work's cycles; that is a few milliseconds for a normal store, well under the 5 s busy timeout. If a second process waits longer than 5 s it fails with `database is locked` rather than opening a duplicate: still safe. This does not stop two processes from driving the *same* cycle (for example two `resume`s); that belongs to row 11.

**Decision for the owner.** None beyond merging.

## Log

2026-10-20, implementer:
- Red: the new test `open enforces one open cycle per work item when two processes race (sweep-open-race)` failed on the unchanged `src/store.ts` with `AssertionError [ERR_ASSERTION]: opened | opened` (`2 !== 1`): both processes opened a cycle for `w1`.
- Green: `open` wraps its checks and insert in `BEGIN IMMEDIATE` / `COMMIT`, with `ROLLBACK` on any throw. The insert is a plain `INSERT` now: under the lock, the `exists` check already refuses a used cycle ID, so `OR IGNORE` and the `changes !== 1` check had nothing left to catch. The new test passed five runs in a row.
- The busy-timeout comment in the constructor now names open's transaction. The spec's bracket on "one open cycle" names the new test. `learn/store.html` no longer says racing opens collide on the primary key.
- lazy-review: an extracted `checkOpen` helper (one caller) was inlined back into `open`.
- `npm test`: 420 tests, 396 pass, 0 fail, 19 skipped, 5 todo (implementer's run, not independent). `npm run test:learn`: 6 tests, 6 pass.
- Next: owner review of the branch.
