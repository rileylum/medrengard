# 08-c — What claude and pi need inside bubblewrap

Probed on this machine on 2026-10-16 by the implementer session, at the owner's request ("run them in the next session", handover). Script: `/var/tmp/software_factory/08-c/probes/runtime-binds.sh`; outputs `result.txt` (v1), `result-v2.txt`, `result-v3.txt` beside it. Each run is `bwrap --unshare-all --share-net --clearenv` with the system directories, node, the CLI's own install directory and a scratch cwd bound, `HOME` set to the real home, and one config binding under test. The script prints exit codes and the names of files written under the config paths, never contents.

## Results

| Variant | claude (`~/.claude`, `~/.claude.json`) | pi (`~/.pi`) |
| --- | --- | --- |
| Config read-only | exit 0, reply OK | exit 1: `EROFS ... mkdir '~/.pi/agent/settings.json.lock'`, then `No API key found for the selected model` |
| Temporary overlay (writes kept in the sandbox) | exit 0, reply OK, nothing written on the host | exit 0, reply OK, nothing written on the host |
| Writable | exit 0, reply OK; wrote `projects/<cwd>/memory`, `plugins/synced/...`, `sessions` | exit 0, reply OK; wrote `agent/auth.json`, `agent/install` |
| Directory writable, `.claude.json` read-only | exit 0, reply OK; wrote `plugins/synced/...`, `sessions` | — |

For claude the overlay variant overlays `~/.claude` and binds `~/.claude.json` read-only: bwrap overlays only directories.

## What follows

1. **claude runs with its configuration read-only.** Nothing it writes is needed for a `-p` run. Writable, it leaves a `projects/<cwd>` directory and plugin sync state in the owner's `~/.claude` for every run.
2. **pi needs to write its config directory, but not to keep the writes.** It takes a lock file next to `settings.json` and reads its key only after; with a temporary overlay it runs and the host is untouched. Writable, it rewrote `agent/auth.json` in a one-line run.
3. **Open: a token refresh inside an overlay.** If pi's `auth.json` rewrite is an OAuth refresh with a rotating refresh token, an overlay throws the new token away and the stored one may stop working. One run cannot tell a refresh from a rewrite of the same content. Not probed for claude either: its token was valid for the whole probe.
4. **The CLIs must run by resolved path, or their symlink directory must be bound.** `claude` and `pi` on PATH are symlinks in `~/.local/bin` (to `~/.local/share/claude/versions/<v>` and `~/.pi/agent/bin/pi`). pi's binary lives inside its own config directory.
5. **No `CLAUDE_*` environment from the controller.** When the controller runs inside a Claude Code session, its `CLAUDE_CODE_*` variables are that session's id and messaging token; the probe drops them, and the runs authenticated from the config files alone. No `ANTHROPIC_*`, `OPENAI_*`, `PI_*` or `GEMINI_*` variable was set.

## Probe mistakes, fixed before the paid runs counted

- v1: every variant failed `execvp: No such file` (the `~/.local/bin` symlinks were not bound): no paid call. The overlay of the file `~/.claude.json` failed `Invalid argument`.
- v2: claude's `--tools ''` is variadic and swallowed the trailing prompt, so all four claude runs exited 1 before any API call; the three pi runs are the pi results above.
- v3: the four claude runs with the prompt first.

The `wrote` lists for v2 and v3 omit `projects/-home-*` (other Claude sessions on this machine). `sessions/3937.json` under the read-only claude variant is another process's: that run could not write there.

## Side effects on the owner's configuration

The writable variants wrote to the real `~/.claude` and `~/.pi`, as an unsandboxed run would: `~/.claude/projects/-var-tmp-software-factory-08-c-probes-work/`, a `backups/.claude.json.backup.*`, plugin sync state, and pi's `agent/auth.json` and `agent/install`. Not cleaned up by this session; the classifier refuses this session access to those paths.
