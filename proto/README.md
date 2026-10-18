# herdr TUI prototype

Throwaway (A-046). Lives on `feat/proto-herdr-tui`, never merges to main. `src/` is unchanged; this
directory plugs into it through the `Adapter` seam.

## What it is

- `board.ts` is the TUI: one row per job file, showing the cycle's stage from the event store, the
  live claude agent from herdr, and what needs you.
- `run.ts` is `src/main.ts <job>` with every stage (developer, standard and adversarial reviewer)
  run as **interactive** claude in its own herdr tab. You can watch it, answer its questions and
  approve its tool calls there.
- `herdr-adapter.ts` writes the stage prompt to a file, starts claude in a new tab, tells it to
  read the file, and waits for the claim file it writes. The claim then goes through the same
  controller guards as a headless run.

## Run it

```sh
proto/demo-setup.sh          # scratch repo + 3 jobs under /var/tmp/software_factory/proto (wipes the old demo)
herdr                        # then, in a herdr pane:
node --no-warnings proto/board.ts            # default jobs dir: /var/tmp/software_factory/proto/jobs
```

| Key | Does |
| --- | --- |
| `↑` `↓` / `j` `k` | select a job |
| `Enter` | jump to the job's live agent tab |
| `c` | jump to the job's controller tab (only for runs started by this board) |
| `r` | start the job: a `<work> ctl` tab runs `proto/run.ts` |
| `d` | open the candidate diff in a new tab |
| `a` | accept the candidate SHA (`src/main.ts accept`) |
| `x` | cancel (`src/main.ts cancel`) and close the live agent tab |
| `w` | close the job's finished agent tabs |
| `q` | quit |

The NEEDS column flags `APPROVE in agent tab` (herdr reports the agent blocked), `agent waiting on
you?` (the agent is idle but has written no claim, for example after asking you something),
`ACCEPT or reject`, and `ESCALATED: decide`. herdr shows a notification when a job reaches
AWAITING_ACCEPTANCE or ESCALATED.

A job file may set `"model": "sonnet"` (passed to claude as `--model`) and `deadlineMs` (default 2 hours per stage).

## Warnings

- **Stage runs are not sandboxed.** Claude runs as you with your user settings (no project
  settings, no project MCP), and its permission prompts are the only guard. Verification checks
  still run in bwrap. Use scratch repositories only.
- Claude asks you to trust every developer worktree, because each is a new git clone. The board
  shows that as `APPROVE in agent tab`. Reviewer checkouts have no `.git`, so trusting the runs
  directory once (start `claude` in `/var/tmp/software_factory/proto/runs` and accept) covers them.

## What the live runs showed (2026-10-18, sonnet)

- `demo-clamp` and `demo-slugify`: READY to AWAITING_ACCEPTANCE in a minute or two each, with no input beyond the trust dialog. `demo-clamp` was then accepted from the board.
- `demo-ask` asks you a question. The developer asked, the owner answered in the tab, and the
  standard reviewer FAILed: "no evidence shows the owner was asked". The fix run asked again and
  the second standard review FAILed too, so the cycle ESCALATED. **What you say to an agent in its
  tab is invisible to the reviewers.** The design question for the real frontend is how an owner
  answer becomes evidence: appended to the ticket, recorded as an event, or carried in the commit.
- herdr reports claude ready before claude draws its trust dialog. The adapter therefore waits for
  the dialog to close, then resends the prompt if the agent's state does not change.
