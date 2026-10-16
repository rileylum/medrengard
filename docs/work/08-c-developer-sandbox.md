# 08-c — Developer runs in the sandbox, in their own clone

Route: Design. It replaces the developer's worktree with a clone and extends the sandbox policy to runtimes (A-038).

Goal: a developer run (claude or pi) runs inside bubblewrap on its own clone. It can write only the clone and its own `/tmp`, reads only its CLI and configuration, and the controller brings its branch back without running anything from the clone unconfined.

## Design note

Policy: `src/sandbox.ts` `Policy` gains three optional fields. `overlay` lists directories mounted as a temporary overlay: writes succeed inside and are dropped. `home` sets `HOME`, default `/tmp`. `tmp` is a host directory bound at `/tmp`, default a tmpfs. With `network`, `/run/systemd/resolve` is bound read-only when it exists, for DNS.

Adapter: `CliSpec` gains `config: { read: string[]; overlay: string[] }`, paths relative to the owner's home. claude reads `.claude` and `.claude.json`; pi overlays `.pi` ([08-c-findings.md](08-c-findings.md)). `cliAdapter(spec, { sandbox })` wraps the command. It resolves the binary on PATH to its real path and binds that directory read-only, because the `~/.local/bin` symlinks are not bound. The policy writes `req.cwd` and a per-run `/tmp` at `<dirname(cwd)>/<runId>-tmp`, which is removed after the run. Network is on and `HOME` is the owner's home. With no `sandbox` option the adapter runs unconfined, as today; `main.ts` always passes the job's sandbox to the developer adapter.

Developer: `develop` makes `<runsDir>/<cycleId>` with `git clone --no-hardlinks` and checks out `sf/<cycleId>` at the base. It copies the repository's `user.name` and `user.email` into the clone's config, because the owner's `~/.gitconfig` is not bound. On a claim, `accept` fetches the clone's `sf/<cycleId>` into `refs/sf/incoming/<cycleId>` in `job.repo`. The fetch runs with `fetch.fsckObjects` and `--upload-pack` set to `git upload-pack` wrapped in the sandbox, with the clone read-only and no network. The head checks run in `job.repo` against that ref. An accepted head becomes `refs/heads/sf/<cycleId>`, and the incoming ref is deleted either way. `fix` reads the clone's branch and HEAD through the same sandboxed git.

Alternatives considered:
- Keep the worktree and bind the shared `.git` writable. Rejected: probe 2 in [08-a-findings.md](08-a-findings.md); it reopens the gitdir-swap, `git replace` and `core.fileMode` lines.
- A plain `git fetch` from the clone. Rejected by A-038: `upload-pack` reads the clone's config, which the developer wrote.

Specs: `claudeDeveloper` runs `--restricted --strict-mcp-config` instead of `--setting-sources project` and keeps its allow list. `piDeveloper` adds `--no-approve`.

## Done when

- `wrap` honours `overlay` (a write inside succeeds; the host directory is unchanged), `home`, `tmp`, and the DNS bind under `network`. Verified by `tests/sandbox.test.ts`.
- `develop` makes a clone, not a worktree. No object file is hardlinked to the repository's, and the repository has no worktree registered. Verified by `tests/developer.test.ts`.
- 05-a parked line (pi's bash): under bwrap, a fixture developer cannot write to `job.repo`, its `.git`, a sibling in `runsDir` or the owner's home. Its `/tmp` writes land in its per-run directory, which is gone after the run. Verified by test.
- 08-a note: a developer that sets `core.fsmonitor`, `core.hooksPath` and a `post-checkout` hook in its clone does not get them run by the controller during develop, accept or fix. Verified by a marker file that stays absent.
- The fetch runs `upload-pack` through bwrap. Verified by a `bwrap` stub on PATH that records its argv and execs the real one. A refused claim leaves no `refs/heads/sf/<cycleId>` and no incoming ref in `job.repo`.
- The existing head-guard tests (tip, base, unknown, abbreviated, empty, orphan, fix-run same tree) pass against the fetched ref.
- 05-b parked line: `claudeDeveloper` loads no settings file (`--restricted`, no `--setting-sources`). Verified by an args test, and live: a claude developer under bwrap reaches VERIFYING with `--restricted` (`RUNTIME_SPIKE=1`, one paid call).
- Live: a pi developer under bwrap with `~/.pi` overlaid reaches VERIFYING (`RUNTIME_SPIKE=1`, one paid call).
- `main.ts` passes the job's sandbox to the developer adapter. `npm test` offline spawns neither `claude` nor `pi`.

Constraints: zero dependencies. Reuse `wrap`; no second mechanism. Untouched: `lifecycle.ts`, `store.ts`, `controller.ts`, `spawn.ts`, `review.ts`.
Non-goals: reviewer runs in the sandbox, and the 06-c, 08-b and verify lines (08-d). Network filtering by domain. Environment variables for API keys (none set on this machine; the sandbox clears the environment). A token refresh lost in pi's overlay (A-038: switch to a writable `auth.json` only if pi stops logging in).
Verification: `npm test`, run by the owner on the reviewed SHA; `RUNTIME_SPIKE=1 node --test tests/developer.test.ts` for the two live runs.

## Log
- 2026-10-16 — owner: “Take all, go” (A-038). Branch `feat/08-c-developer-sandbox` off main at `f5e90bb`; first commit `bdc9106` holds the 08-a and 08-b merge lines and the probe findings.
