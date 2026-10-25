# Threat model

Medrengard runs on one owner's machine, on the owner's personal
repositories. The risks that shape it are agent mistakes, such as a badly
formed command deleting a whole directory instead of the one it meant, and
agents going outside the bounds of their task. Prompt injection, credential
exfiltration and deliberately malicious code are not design drivers, though
the same controls limit them (A-148). Agents need as much freedom as their
task needs, so the owner declares what each one can reach rather than the
core withholding it.

The controls contain mistakes: candidate execution runs in a sandbox that sees
only what was declared, the owner's repository is never written by a stage,
and evidence binds to the exact commit or document it was about. See
[accepted risks](../work/accepted-risks.md) and [parked findings](../work/parked.md).

## Trust boundaries

| Actor | Authority |
| --- | --- |
| Owner's TypeScript workflows, agents, runtime adapters and extensions | Trusted host code. The owner supplies these directly; candidate definitions are never imported. This includes `extensions/claude-code` and the factory's `factory.ts`, which `cli/medrengard.ts` imports from its working directory. |
| Controller | Sole writer of workflow state and budget. It validates claims and exact artifact subjects before recording advancement. It makes the work's first clone on the host from the owner's repository, with hooks disabled. |
| Stage processes, agent or command | Bwrap with what the agent's `Sandbox` and the stage's `access` declare together: read paths, network, named variables, and write `none` (a private `/tmp` only), `scratch` (plus a folder of the run's own, kept after it) or `full` (plus the workspace). System directories are readable. |
| Repository-reading stage (`access.workspace: 'repository'` without a commit, e.g. the shipped default's `design`) | The work's `--no-local` clone, read-only by default, including its gitdir and every fetched ref. The owner's planner declares network and `CLAUDE_CODE_OAUTH_TOKEN`. |
| Developer stage (`produces: 'commit'`) | The same clone, always writable; setup refuses less. |
| Stages after a commit (checks, reviewers, publication) | By default a writable copy of the retained commit's stored files, made fresh for the run and thrown away, without the developer's dirty files or gitdir. Writes cannot change the commit the evidence names. |
| The controller's own Git and snapshot calls | Bwrap with no network, no declared variables and no `Sandbox.read` paths. |
| Claude Code (`claudeCodeRuntime`) | Runs `claude -p` inside its agent's sandbox, with only the `Read`, `Grep`, `Glob` and `Skill` tools, `--strict-mcp-config` and `--no-session-persistence`. Settings default to `user`, empty under the private home. `project` loads the clone's `.claude/` settings, including hooks and permission rules; its hooks run inside the same sandbox, with its network and token. Use it only for a trusted repository. |
| Observers | Trusted host callbacks receiving immutable events. Controller methods refuse mutation in observer context, including asynchronous continuations. This is an API boundary, not isolation from a malicious owner module. |
| Issue text, runtime results and candidate files | Untrusted data; never evaluated as controller code or configuration. Owner feedback also reaches agents only as prompt text. |

## Mechanisms

- Workflow definitions are checked before execution. Finite automated-stage
  budgets cannot be reset through an automatic workflow handoff cycle. A human
  handoff requires an explicit decision on the current subject.
- Agent output is a claim. Commit claims must equal the isolated workspace's
  HEAD; verified object packs are retained separately. Reviews and checks bind
  to an exact SHA, documents to a hash. A new subject invalidates old evidence.
  Owner feedback given with a decision is recorded in that decision event and
  reaches the next run's `AgentRequest.feedback`; the decision still binds to
  the current hash or SHA.
- Candidate Git operations execute inside bwrap with hooks and replacement
  objects disabled. The initial clone uses the owner's trusted repository.
  Snapshot materialization reads raw objects rather than candidate attributes.
- The sandbox has no network unless its `Sandbox` sets `network: true`, which
  adds `--share-net`. That is all-or-nothing: the process then sees the host's
  network, including loopback services, Docker bridges and abstract Unix
  sockets. Destination-specific network is a following ticket (A-146).
- Bwrap is started with an environment holding only `PATH`, `HOME` (its
  private `/tmp`), `LANG`, `MEDRENGARD_SCRATCH` when the run has a scratch
  folder, and the names in the agent's `Sandbox.env` and the stage's
  `access.env`, copied from the controller's environment. Values pass through bwrap's own environment, never
  its argv. Setup refuses invalid, reserved (`PATH`, `HOME`, `LANG`,
  `MEDRENGARD_SCRATCH`) and unset
  names. Owners must choose `sandbox.read` deliberately: anything mounted is
  readable by the run.
- The sandbox sends SIGKILL directly to bwrap on cancellation or output
  overflow, without a grace period. Its PID namespace and parent-death behavior
  end descendants that start a new session after normal exit, overflow, a stage
  deadline or controller death. Interrupted processes are not adopted on restart.
- SQLite is the event record. Replay reconstructs state; interrupted work
  escalates without spending again. Historical `events` databases are refused,
  not migrated or silently treated as empty.

## Agents with network and a token

The owner's agents hold a Claude Code subscription token with unrestricted
network, and read the repository clone. Within the owner's appetite (A-148),
this is how they reach the model and do their work, not an accepted
exposure: the repositories are the owner's own, and an agent following
hostile text is not a design driver. The token's value stays outside the
factory (`~/.config/medrengard/claude-token`, mode 600) and reaches the
sandbox only by name. Network access by named destination is a following
ticket. Claude Code still loads bundled plugins and skills the factory did not
declare; their effect is unverified ([parked](../work/parked.md)).

## Limits

`claudeCodeRuntime` is the only provider adapter; there is no Pi integration, code-host client,
credential file or mount, egress proxy, destination-specific network or grant
mechanism. The core loads no repository configuration; Claude Code does when
`project` settings are chosen. The generic `commandRuntime` protocol is the
other process adapter; owners provide further implementations as trusted
TypeScript. The controller does not sandbox those host callbacks; their
candidate execution must use `StageContext.execute`. The CLI imports whatever
`factory.ts` is in its working directory.

A declared variable is in the bwrap process's environment, and the same user
can read `/proc/<pid>/environ`. The work's full clone exposes all fetched refs
to the developer and to repository-reading stages such as `design`
([parked](../work/parked.md)). Snapshots use stored bytes without attributes
or LFS conversion. There are no memory/disk quotas, global spend limits or
command-ID deduplication for owner decisions. Process output caps, stage
deadlines and finite workflow budgets do not substitute for those limits.
Sandbox execution captures bounded output through pipes; a run's scratch
folder is kept but not cleaned up, and there are no transcripts beyond the
final result, or independent systemd
runtime deadlines.
