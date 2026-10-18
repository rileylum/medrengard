# herdr TUI prototype

An experimental board for the factory, run inside herdr, outside the ticket workflow: no tests and
no reviews. Decisions: A-046 to A-048.
`src/` does not depend on it; deleting `proto/` removes it.

- `board.ts` is the TUI. It shows one row per job file: the cycle's stage, the live claude agent
  and what needs you.
- `run.ts` is `node src/main.ts <job>`, except that every stage (developer, standard reviewer,
  adversarial reviewer) runs as **interactive** claude in its own herdr tab. You can watch a stage,
  answer its questions and approve its tool calls there.
- `herdr-adapter.ts` writes the stage prompt to a file, starts claude in a new tab, tells it to
  read the file, and waits for the claim file it writes. The controller then checks the claim
  exactly as it checks a headless run.

Every stage runs inside the job's sandbox (bwrap by default), like a headless run. What herdr
needed for that, and what a herdr frontend still has to decide:
[docs/work/herdr-findings.md](../docs/work/herdr-findings.md).

## What you need

- Node 24 (`node --version`).
- herdr, tested with 0.8.0 (`herdr --version`).
- The claude CLI, logged in (`claude` starts without asking you to log in).
- bubblewrap (`bwrap`). Checks and agents run inside it.
- `sysctl dev.tty.legacy_tiocsti` prints `0`. Otherwise a sandboxed
  agent could type commands into its tab's shell, and the adapter refuses to start it.

## Try the demo

1. Make the demo repository and job files:

   ```sh
   proto/demo-setup.sh
   ```

   This creates `/var/tmp/software_factory/proto/` with a scratch repository and three jobs:
   `demo-clamp`, `demo-slugify` and `demo-ask`. **Running it again deletes the old demo, its runs
   and its event store.**

2. Start herdr, then start the board in a herdr pane from the repository root:

   ```sh
   herdr
   node --no-warnings proto/board.ts
   ```

   The board refuses to start outside herdr. With no argument it reads
   `/var/tmp/software_factory/proto/jobs`.

3. Trust the runs directory once, so reviewer tabs do not stop at claude's trust dialog. In any
   pane, run the following, accept the dialog, then quit claude:

   ```sh
   mkdir -p /var/tmp/software_factory/proto/runs && cd /var/tmp/software_factory/proto/runs && claude
   ```

   claude remembers this by path, so rerunning `demo-setup.sh` does not undo it. Developer tabs still ask every time, because each developer works in a new git clone.

4. Select `demo-clamp` and press `r`. The board opens a `demo-clamp ctl` tab that runs
   `proto/run.ts`, and that tab opens the developer's tab.

5. When NEEDS shows `APPROVE in agent tab`, press `Enter` to jump to the agent. Accept the trust
   dialog there, then come back to the board tab.

6. Wait. The stage moves through DEVELOPING, VERIFYING, STANDARD_REVIEW and ADVERSARIAL_REVIEW.
   Each stage opens its own tab. herdr shows a notification when the job reaches
   AWAITING_ACCEPTANCE or ESCALATED.

7. At AWAITING_ACCEPTANCE, press `d` to read the diff, then `a` to accept it. The stage becomes
   ACCEPTED. Press `w` to close the job's finished tabs.

`demo-ask` tells the developer to ask you a question before it writes code. When NEEDS shows
`agent waiting on you?`, press `Enter` and answer in the agent's tab. See
[What the live runs showed](#what-the-live-runs-showed) for why this job can escalate.

## Run your own jobs

The board reads every `*.json` file in a directory:

```sh
node --no-warnings proto/board.ts /path/to/jobs
```

A job file is the same as one for `src/main.ts`, except that `runtime` is ignored, because every
stage is claude. Relative paths are relative to the job file.

```json
{
  "workId": "add-clamp",
  "ticketFile": "tickets/add-clamp.md",
  "repo": "../my-repo",
  "runsDir": "/var/tmp/software_factory/my-runs",
  "checks": [{ "name": "test", "command": ["node", "--test"] }],
  "sandbox": { "backend": "bwrap", "read": ["/home/me/.config/nvm/versions/node/v24.13.0"] },
  "model": "sonnet"
}
```

| Field | Meaning |
| --- | --- |
| `workId` | The job's name. One open cycle per work ID. |
| `ticket` or `ticketFile` | What the developer must do. |
| `repo` | The repository. The developer works in a clone; the result is the local branch `sf/<cycleId>`. |
| `base` | The ref to start from. Default `HEAD`. |
| `runsDir` | Worktrees, run files and the event store. Default `/var/tmp/software_factory/runs`. |
| `checks` | Commands the controller runs on the candidate, inside bwrap, with no network. |
| `sandbox` | For checks and agents. Default bwrap. `read` adds read-only paths, such as a toolchain outside `/usr`. `{ "backend": "none" }` runs claude unconfined. |
| `model` | Passed to claude as `--model`. Default: your claude default. |
| `deadlineMs` | Per stage. Default 2 hours, because you may be talking to the agent. |
| `parentCycleId` | Needed to rerun a work ID whose last cycle ESCALATED. |

## Keys

| Key | Does |
| --- | --- |
| `↑` `↓` / `j` `k` | Select a job. |
| `Enter` | Jump to the job's live agent tab. |
| `c` | Jump to the job's controller tab. Works only for runs this board process started. |
| `r` | Start the job in a new `<work> ctl` tab. |
| `d` | Open the candidate diff in a new tab. |
| `a` | Accept the candidate (`src/main.ts accept`). |
| `x` | Cancel the cycle (`src/main.ts cancel`) and close its live agent tab. |
| `w` | Close the job's finished agent tabs. |
| `q` | Quit the board. Running jobs carry on in their tabs. |

The NEEDS column shows:

| NEEDS | Means |
| --- | --- |
| `APPROVE in agent tab` | herdr reports the agent blocked: a trust dialog or a tool approval. |
| `agent waiting on you?` | The agent is idle and has written no claim, for example after asking you something. |
| `agent gone` | The agent's tab closed before it wrote a claim. The run fails and the controller records it. |
| `ACCEPT or reject` | AWAITING_ACCEPTANCE: press `d`, then `a` or `x`. |
| `ESCALATED: decide` | The review budget is spent. Press `x`, or set `parentCycleId` in the job file and press `r`. |

## Warnings

- Agents run in bwrap with the network on and your claude login readable, the same gaps as
  headless runs (A-043). A developer can write only its worktree and its run directory; a
  reviewer only its run directory. claude uses your user settings; project settings and project
  MCP servers are off.
- Each run directory, `<runsDir>/proto/<runId>/`, keeps a copy of your `~/.claude.json` until you
  delete the runs directory.
- Choose "Don't show again" for claude's "Teach auto mode" dialog in your own claude. Each run
  copies your settings, so otherwise every agent tab shows the dialog after its first answer.
- What you tell an agent in its tab is not evidence. The reviewers see only the ticket, the diff
  and the checks. If the developer acts on your answer and does not record it, a reviewer can fail
  the work.

## Rough edges

- `c` forgets controller tabs when the board restarts.
- With no open cycle, the board shows the cycle whose worktree changed last, because events carry
  no time.
- Reviewer runs are not in the event store. The board finds every run from
  `<runsDir>/proto/<runId>/meta.json`.
- Every herdr call blocks the board for up to 60 s if herdr does not answer.
- `run.ts` does not print `main.ts`'s diff, accept and merge hints. Use the board.

## What the live runs showed

2026-10-18, sonnet:

- `demo-clamp` and `demo-slugify` went from READY to AWAITING_ACCEPTANCE in a minute or two each,
  with no input beyond the trust dialog. `demo-clamp` was then accepted from the board.
- In `demo-ask`, the developer asked, the owner answered in the tab, and the standard reviewer
  failed it: "no evidence shows the owner was asked". The fix run asked again, the second
  standard review failed too, and the cycle ESCALATED. In the owner's own run the same job was
  accepted, so the result depends on whether the agent writes the answer down. The real frontend
  must decide how an owner's answer becomes evidence: appended to the ticket, recorded as an
  event, or carried in the commit.
- herdr reports claude ready before claude draws its trust dialog. The adapter therefore waits for
  the dialog to close, then sends the prompt again if the agent's state does not change.

Sandboxed (A-047): with three changes to the headless policy, `demo-clamp` went from READY to
ACCEPTED from the board with every stage in bwrap. The changes and why each is needed:
[docs/work/herdr-findings.md](../docs/work/herdr-findings.md).
