# 11-b2 — Each cycle's clone shares a base-only mirror

Route: Design. It changes what the developer's sandbox reads and how the controller's git sets up the clone, and it has real alternatives (A-126). Tier: Trust (2 standard + 1 adversarial through `claude -p`, A-125): sandbox and git over candidate trees. Stacked on 11-b, which gives it the layout.

Goal: a cycle's clone is `git clone --shared` against a bare mirror the controller owns, which holds only base commits, bound read-only into every sandbox that reads the clone; no hardlinks.

Design note: [2026-10-21-shared-clones.md](../design/2026-10-21-shared-clones.md).

Done when:
- A cycle's clone holds no object packs of its own before the developer runs, and names `<mirror>/objects` in its alternates. Verified by test.
- The clone has no refs but `sf/<cycleId>`: a private branch and another cycle's `sf/*` in the owner's repository are absent from the clone and from the mirror. Verified by test.
- The mirror holds `refs/bases/<sha>` for each base used, and `gc.auto=0`, `gc.pruneExpire=never`. Verified by test.
- `develop`, `fix` and `land` run end to end on a shared clone in bwrap: the branch lands in the owner's repository with `fetch.fsckObjects`. Verified by the existing developer and run tests, which pass unchanged.
- A sandboxed process cannot write the mirror. Verified by test.
- `fix` on a clone made before this ticket (no alternates, no mirror) still works. Verified by test.
- The design note's probes are run and their results logged here before code.

Constraints: zero dependencies; no change to the owner's repository config; no paid calls in tests. A-038's no-hardlinks rule stays.
Non-goals: mirror cleanup (Housekeeping); overlay checkouts (pools, row 13); resetting the clone's hooks and config (A-121 (c)); the verify checkout, which does not read the clone.
Verification: `npm test` and `npm run test:learn`; the owner's pre-merge hook runs `npm test` on the merge result. Live claude and pi developer runs on a shared clone, with the owner's go.

## Log
- 2026-10-21 — drafted on `feat/11-b-layout` beside 11-b. Not READY until the owner approves the split, the design note and says go.
- 2026-10-21 — owner approved the split, one mirror per repository and the probes, paid runs included (A-133). The probes run after 11-b; code after their results.
