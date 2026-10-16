# 08-a — Sandbox research and probes

Probed on this machine on 2026-10-16 by the implementer session. Each line names how it was checked. Scripts are under `/var/tmp/software_factory/08-a/probes/`.

## What is installed

| Tool | State | How checked |
| --- | --- | --- |
| bubblewrap | 0.13.0, installed 2026-09-24 | `bwrap --version`, `pacman -Qi bubblewrap` |
| Unprivileged user namespaces | allowed | `unshare --user --map-root-user true` |
| Landlock | enabled in the kernel (7.2.9) | `/sys/kernel/security/lsm` lists `landlock` |
| Docker | 29.9.0, rootful daemon | `docker info`; no `rootless` security option |
| systemd-nspawn | installed, needs root | `command -v` |
| podman, gVisor (`runsc`), nsjail, firejail, minijail, landrun, Anthropic `srt` | not installed | `command -v` |

## Options weighed

- **Bubblewrap.** Unprivileged, no daemon, milliseconds to start, one argv prefix. Claude Code's own Linux sandbox and Anthropic's sandbox-runtime build on it. Chosen first (A-035).
- **Docker.** The daemon runs as root, so docker-group membership is root-equivalent. Each toolchain needs an image; reported start-up is 300 to 800 ms per container. A good second backend behind the same interface.
- **Landlock.** In the kernel, filesystem and TCP rules, but Node has no binding: it needs a helper binary such as landrun, which the zero-dependency rule rules out for now. A possible second layer inside bubblewrap later.
- **gVisor, Firecracker and other VMs, cloud sandboxes.** Out for now (A-035); the interface must not rule them out.
- **Worktrees** separate git state, not processes: code in a worktree runs as the owner with the owner's whole filesystem.

## Probes

1. **Bubblewrap confines writes unprivileged.** `bwrap --ro-bind / / --bind <dir> <dir> --unshare-all` : a write in `<dir>` works, a write to `$HOME` fails with `Read-only file system`.
2. **A sandboxed developer cannot commit in a git worktree.** With the worktree bound writable and the repository read-only, `git commit` fails: `Unable to create '<repo>/.git/worktrees/<name>/index.lock': Read-only file system`. A worktree's index, HEAD and objects live in the shared `.git`; making it writable reopens the parked gitdir-swap, `git replace` and `core.fileMode` lines. Consequence for 08-c: the developer gets its own clone.
3. **A clone works inside the sandbox, given a private `/tmp`.** With only the clone bound, `git commit` failed with `could not create temporary file: Read-only file system`; with `--tmpfs /tmp` it succeeded, and `git fetch <clone> HEAD:refs/heads/sf/y` from outside brought the commit into the repository.
4. **A commit can be checked out with no `.git` and compared with a private index.** With `GIT_INDEX_FILE` outside the checkout, `git --git-dir=<repo .git> --work-tree=<dir> --attr-source=<head> read-tree <head>` and `checkout-index -a -f` write the commit's files (attributes from the commit applied: `eol=crlf` gave `a\r\n`). After `read-tree <head>` again, `update-index -q --refresh` and `diff-files --name-status` print nothing for a clean tree and `M` for a rewritten file, a removed executable bit and an edited `.gitattributes`. A `.git` pointer file written into the directory changes nothing, because the controller's git never reads it. Script: `08-a/probes/gitexport`.
5. **Node lives outside the system directories.** `node` is `~/.config/nvm/versions/node/v24.13.0/bin/node`; `sh`, `git` and coreutils are under `/usr`. A check that runs `node` or `npm` needs that directory declared as a read path. `/bin`, `/sbin`, `/lib` and `/lib64` are symlinks into `/usr` on this machine.

## Not probed

- **What claude and pi need inside the sandbox.** Listing `~/.claude`, `~/.claude.json` and `~/.pi` was refused to this session by the permission classifier as credential exploration. 08-c needs it: which files each CLI reads and writes, whether it runs with its configuration read-only, and whether a token refresh writes back. An owner-run probe script will answer it without printing secrets.
- **Network filtering by domain.** Bubblewrap's network is all or nothing. A proxy as in sandbox-runtime is parked against a later ticket (A-035).

## Sources

- [Anthropic sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)
- [landrun](https://pkg.go.dev/github.com/zouuup/landrun@v0.1.10)
- [How to sandbox an AI coding agent on Linux in 2026](https://yeet.cx/topical-takes/sandbox-ai-coding-agent-linux)
- [Sandboxing AI coding agents](https://dev.to/eme_gug_0821b41b948be6516/sandboxing-ai-coding-agents-run-agent-generated-code-without-betting-your-machine-on-it-4k4p)
- [Sandlock: confining AI agent code with unprivileged Linux primitives](https://arxiv.org/pdf/2605.26298)
- [Harness engineering: a source-code study of eleven coding agents](https://arxiv.org/pdf/2609.00006)
