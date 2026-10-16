# 08-a — Sandboxed checks on a checkout with no `.git`

Route: Design. It adds the sandbox seam that 08-b and later backends build on (A-035).

Goal: every verification check runs inside bubblewrap on a plain copy of the candidate's files. The check can write only that copy, reads only declared paths, has no network and none of the controller's environment, and nothing it does can hide a change from the controller's tree check.

## Design note

Interface: `src/sandbox.ts` exports `wrap(sandbox, policy, command, args)`, which returns the argv to spawn, and `checkSandbox(sandbox)`, which throws at setup when the backend cannot confine. `Sandbox` is `{ backend: 'bwrap' | 'none'; read?: string[] }`, owner-supplied with the job. `Policy` is `{ cwd, write: string[], read: string[], network: boolean }`, built by the stage that spawns. `spawnRuntime` is unchanged; the wrapped argv goes inside the systemd scope as before. A later Docker or VM backend is another case of `wrap`.

Alternatives considered:
- A `sandbox` option inside `spawnRuntime`. Rejected: it would couple the process-tree code to policy, and in-process test adapters never reach it anyway.
- Keep the git worktree and bind its shared `.git` read-only. Rejected: probe 2 in [08-a-findings.md](08-a-findings.md); git in the worktree still reads the shared config and objects, and the gitdir swap stays open to any unsandboxed reader.

Checkout: `<runsDir>/<cycleId>-verify` is a plain directory. The controller's git writes it with `--git-dir=<repo>`, `--work-tree=<checkout>`, an index file at `<runsDir>/<cycleId>-verify.index` and `--attr-source=<head>` (probe 4). The tree check rebuilds that index from the head, refreshes it and lists `git diff-files --name-status`. The check never sees the index, the evidence directory, the store or the repository.

Policy for a check: write the checkout; read `/usr`, `/etc`, `/opt` and the root symlinks into them, plus `sandbox.read`; private `/tmp`, `/proc`, `/dev`; no network; environment cleared to `PATH`, `HOME=/tmp` and `LANG`.

## Done when

- `wrap` with `bwrap` confines a command: it writes in the checkout, and fails to write outside it, read an undeclared path, see a controller environment variable or connect to a listener on 127.0.0.1. `none` returns the argv unchanged. `checkSandbox` throws, naming `none`, when bubblewrap cannot start. Verified by `tests/sandbox.test.ts`.
- `verify` writes the candidate into a checkout with no `.git` and runs each check under the job's sandbox, `bwrap` by default. The first verify test's `git rev-parse HEAD` check now fails, by design (A-035, question 3). Verified by test.
- Each parked line is closed by a test in `tests/verify.test.ts`. The 06-a committed symlink to `../<cycleId>` resolves to nothing, so the same SHA verifies the same whatever the developer worktree holds. A `post-checkout` hook named by `core.hooksPath` does not run. A check cannot write the evidence directory or the store. The 07-b `.git` pointer swap with a rewritten file records `tree: FAIL`. A check cannot run `git replace` in the repository. A check that clears a tracked file's executable bit records `tree: FAIL`.
- The `tree` evidence is `diff-files --name-status` output. The 07-c index-flag tests become "the flag cannot be set and the rewrite is `tree: FAIL`". The 1 MiB test keeps its size.
- A check whose binary resolves outside the sandbox's read and write roots is `MISSING`, and the reason says to add its directory to `sandbox.read`. Verified by test.
- `review` requires the checkout to match the head through the same tree comparison and runs its git commands in `job.repo`. No `.git` is needed in the checkout. Verified by the adapted `tests/review.test.ts`.
- `run` passes `sandbox` to `verify`. The job file's `sandbox` is read relative to the job file, and `main.ts` prints `Sandbox:` with the backend. `none` is never a default.
- `npm test` offline spawns neither `claude` nor `pi`.

Constraints: zero dependencies; bubblewrap is a system binary like git and systemd-run. Untouched: `lifecycle.ts`, `store.ts`, `controller.ts`, `developer.ts`, `cli-adapter.ts`, `spawn.ts`.
Non-goals: developer and reviewer runs in the sandbox (08-b). Network filtering by domain. Docker, Landlock, VM and cloud backends. Conversions declared by the commit's own `.gitattributes` (`eol`, `ident`) are applied on both checkout and compare, so a rewrite that only those conversions undo is not seen. The `tmpfs` `/tmp` inside the sandbox is RAM until the check exits.
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-16 — owner: “Take all” (A-035). Branch `feat/08-a-sandbox` off main at `a848571`.
- 2026-10-16 — tests first (`20d4077`, red): `tests/sandbox.test.ts` (new); `tests/verify.test.ts` adapted (no `.git` in the checkout, `diff-files` evidence format, the 07-c flag tests rewritten) plus seven parked-line and sandbox tests; `tests/review.test.ts` adapted (no `.git`; checkout restored by writing files); `tests/run.test.ts` sandbox-before-develop and `main.ts` tests. The first red run of the `main.ts` test made **one live claude developer call** on a scratch repository: without the implementation, main.ts ran the real loop. The test now puts stub `claude` and `pi` first on PATH and asserts neither was called.
- 2026-10-16 — implementation (`ed3b430`): `src/sandbox.ts` (`wrap`, `reachable`, `checkSandbox`); `verify` writes the checkout with `read-tree` and `checkout-index` through `--git-dir`, `--work-tree`, a private index and `--attr-source=<head>`, runs each check through `wrap`, records `tree` from `treeDiff`; `review` uses `treeDiff` and runs git in `job.repo`; `run` checks the sandbox before `develop`; `main.ts` reads `sandbox` relative to the job file and prints `Sandbox:`. Added after the first mutation run (`21733ae` and the commit before it): tests for the read-only sandbox root, a planted `.gitattributes`, a deleted private index at review, the session flag, a committed symlink to a binary outside the sandbox and the `Sandbox:` line.
- 2026-10-16 — mutation checks, one replacement each, `src` restored after: 22 run, 22 fail a test (three survivors on the first pass, killed by the tests above). Script and output: `/var/tmp/software_factory/08-a/mut.py`, `mutations.txt`. lazy-review: nothing to cut. Implementer-run `npm test` on `21733ae`: 187 tests, 163 pass, 19 skipped, 5 todo, 0 fail. Awaiting owner-run `npm test` on `21733ae`, then standard review 1.
- 2026-10-16 — for 08-b: owner-run probe `/var/tmp/software_factory/08-b/probes/runtime-binds.sh` (up to eight one-line paid calls) reports what claude and pi need inside bubblewrap: config read-only, overlaid or writable, and which config files each run writes. Names only, no contents.
