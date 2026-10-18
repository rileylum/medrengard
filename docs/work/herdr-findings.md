# herdr findings

The goal is a factory that runs in herdr (A-047). This file records what the `proto/` prototype
learned about getting there, so the real frontend starts from it. Sources: the live runs and
spikes of 2026-10-18, all on sonnet, in isolated herdr 0.8.0 sessions with claude 2.1.302.

## Interactive stage runs

- `herdr agent start --kind claude` runs the canonical `claude` executable itself, so nothing can
  wrap it in a sandbox. The prototype instead types the wrapped command into a new tab with
  `herdr pane run`. herdr then detects claude without help, and `herdr agent rename <pane> <name>`
  gives it a name the board can look up.
- herdr detects an agent only if it is in the pane's foreground process group **and** its process
  is named `claude`. Both conditions failed under the unchanged bwrap policy (below).
- herdr reports claude ready before claude draws its trust dialog. A prompt sent at that moment is
  lost. The adapter waits for the dialog to close, then sends the prompt again if the agent's
  state does not change.
- claude asks for trust in every developer worktree, because each one is a new git clone. Reviewer
  checkouts sit in the runs directory, so trusting that directory once in the owner's own claude
  covers them. While the dialog is open, herdr reports the agent `blocked`.
- After its first turn, claude offers a "Teach auto mode" dialog, and herdr reports that as
  `blocked` too. The claim is already written by then, so the stage is not held up. Choosing
  "Don't show again" in the owner's own claude stops it, because each run copies the owner's
  `~/.claude.json`.

## Sandboxing interactive runs

With cliAdapter's developer policy unchanged, interactive claude started, used the owner's login,
accepted typing, wrote in the worktree and was refused a write to the home directory (EROFS).
Four things stopped it working as a stage:

| Problem | Cause | What the prototype does |
| --- | --- | --- |
| herdr does not see the agent | `--new-session` moves claude out of the pane's foreground process group | Drops `--new-session`. Refuses the run unless `dev.tty.legacy_tiocsti = 0` |
| herdr still does not see it | The real binary is named after its version (`2.1.302`) | Starts claude through a symlink, `/run/sf/claude`, inside the sandbox |
| Trust and transcripts are not saved; the transcript warning is shown | `~/.claude` and `~/.claude.json` are read-only | `~/.claude` is a throwaway overlay; `~/.claude.json` is a per-run copy, bound writable |
| No prompt, no claim | The run directory is not bound | The run directory is bound writable |

`--new-session` exists to stop the agent pushing input into its terminal with TIOCSTI. In a herdr
pane, that input would run in the owner's shell once claude exits, outside the sandbox. Linux 6.2
and later can block TIOCSTI for unprivileged processes, which this machine does. The guard
therefore moves from bwrap to a check of the sysctl.

With these changes, `demo-clamp` went from READY to ACCEPTED from the board, with all three stages
in bwrap (herdr listed `bwrap`, `bwrap`, `claude` as each pane's foreground processes). The only
input was the three trust dialogs.

What stays open:

- The per-run `claude.json` copy holds the owner's claude state (project history, account
  details) in `<runsDir>/proto/<runId>/` until the runs directory is wiped.
- A token refresh inside the overlay is lost when the run ends (the same trade pi makes, A-038).
- Runs have no systemd scope. Closing the tab ends the shell, and bwrap's `--die-with-parent`
  ends the sandbox with it. Cancel closes the tab.
- The A-043 gaps still apply: full network access, and the CLI's credentials are readable.

## Owner answers are not evidence

In `demo-ask`, the ticket tells the developer to ask the owner a question. The owner answered in
the agent's tab. The standard reviewer then failed the work, "no evidence shows the owner was
asked", and after the fix run failed the same way the cycle escalated. In the owner's own run the
same job was accepted. The outcome depends on whether the agent writes the answer down.

The reviewers see only the ticket, the diff and the checks, by design. The frontend must choose how
an answer becomes evidence: appended to the ticket, recorded as an event, or carried in the
commit. Open question O-010.

## Board read model

- Only the developer's claim creates a Run in the store, so reviewer runs are invisible to it. The
  board finds every run from `<runsDir>/proto/<runId>/meta.json`, matched by working directory.
- Events carry no time. With no open cycle, the board picks the cycle whose worktree changed last.
- The board remembers controller tabs in memory only, so a restarted board loses them.
- Every herdr call is synchronous and can block the board for up to 60 s.

## Questions for the real frontend

1. Does the herdr adapter become a seam beside `cliAdapter`, and do the interactive policy changes
   above become `Policy` options in `src/sandbox.ts` rather than argv edits in `proto/`?
2. Where does the board's read model live: the event store (reviewer runs and event times added)
   or the run files?
3. O-010: how does an owner's answer become evidence?
4. Should trust and the auto-mode dialog be pre-answered for factory worktrees, rather than left
   to the owner in each tab?
