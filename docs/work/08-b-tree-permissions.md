# 08-b — The tree comparison survives permission changes; reviewers get the commit only

Route: Fast. Fix ticket for 08-a's adversarial FAIL on `798eb1c` (A-036). Internal, reversible, one obvious design per finding. Stacked on 08-a.

Goal: whatever permissions a check leaves on the checkout, the controller compares every tracked file with the commit or records why it could not; and the reviewer's checkout holds the commit's files and nothing else.

Done when:
- A check that rewrites a tracked file and then removes the owner's permissions on its directory records `tree: FAIL` naming the file, and the cycle escalates. Verified by test in `tests/verify.test.ts`.
- A check that removes the owner's permissions on the checkout directory itself records `tree: FAIL` or a clean tree, never a throw. A later verification of the same cycle still replaces the checkout. Verified by test.
- Any warning the comparison's git prints on stderr is part of the `tree` evidence and makes the tree dirty. Verified by reading and by mutation check.
- The controller's git for the checkout runs with the repository as its working directory, not the checkout.
- After the tree check, untracked entries in the checkout are removed: files, symlinks and a planted `.git` directory. A clean verification leaves exactly the commit's tracked paths. Verified by test.
- Review's guard restores owner access before comparing, so a checkout whose permissions changed after verify is still compared in full. Verified by test in `tests/review.test.ts`.
- `npm test` offline spawns neither `claude` nor `pi`.

Constraints: zero dependencies. Only `verify.ts` and `review.ts` change, plus a comment in `main.ts` for the 08-c renumbering. `sandbox.ts`, the job file and the 08-a interfaces stay as they are.
Non-goals: the 08-a notes (`PATH` copied verbatim, unbounded `/tmp` and `/dev/shm`, no grace SIGTERM under process-group isolation); the shared `.git/config` read by the controller's git, which is 08-c with the developer clone.
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — owner: “Option 1 go” (A-036). Branch `feat/08-b-tree-permissions` stacked on 08-a at `c304fad`. The developer and reviewer ticket is renumbered 08-c, and its probe moved to `/var/tmp/software_factory/08-c/probes/`.
- 2026-10-16 — tests first (red, committed before the implementation): a rewrite hidden by locking its directory or the file, a locked checkout with and without a rewrite, untracked leftovers (a file, a symlink to `/etc/hostname`, a nested directory, `git init` with a planted `core.pager`), and review after a permission change. All failed with `spawnSync git EACCES` or the leftovers present. Then (`519fa2c`, `52a17c3`): `treeDiff` restores owner read, write and search bits on the checkout before comparing; the controller's git runs through `spawnSync` from the repository and returns stderr, which is appended to the `tree` evidence; after the tree check `verify` removes every untracked entry; a locked but unchanged file compares clean. Mutation checks, one replacement each, restored after: 8 run, 4 fail a test on the first pass; the file-bits survivor was killed by the locked-unchanged-file test and the redundant symlink guard was deleted. Survivors, verified by reading: warnings appended as dirt and git's cwd being the repository (both unreachable once access is restored), and the non-zero-exit throw (no test makes the controller's git fail). Script and output: `/var/tmp/software_factory/08-a/mut-08b.py`, `mutations-08b.txt`. Implementer-run `npm test` on `52a17c3`: 192 tests, 168 pass, 19 skipped, 5 todo, 0 fail; not independent. Standard review 1 launched on `52a17c3`.
