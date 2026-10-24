# Threat model

The core protects the owner's repository, event log, credentials and host
from candidate execution. Mistakes and agents following hostile third-party
text matter before deliberate malice (A-037, A-115). See
[accepted risks](../work/accepted-risks.md) and [parked findings](../work/parked.md).

## Trust boundaries

| Actor | Authority |
| --- | --- |
| Owner's TypeScript workflows, agents, runtime adapters and extensions | Trusted host code. The owner supplies these directly; candidate definitions are never imported. |
| Controller | Sole writer of workflow state and budget. It validates claims and exact artifact subjects before recording advancement. |
| Developer process | Bwrap with its independent clone writable, declared read paths and system directories readable. Network disabled; no provider credentials provisioned. |
| Checks and reviewer processes | Bwrap over a read-only snapshot of retained commit objects, without the developer's dirty files or gitdir. Network disabled. |
| Observers | Trusted host callbacks receiving immutable events. Controller methods refuse mutation in observer context, including asynchronous continuations. This is an API boundary, not isolation from a malicious owner module. |
| Issue text, runtime results and candidate files | Untrusted data; never evaluated as controller code or configuration. |

## Mechanisms

- Workflow definitions are checked before execution. Finite automated-stage
  budgets cannot be reset through an automatic workflow handoff cycle. A human
  handoff requires an explicit decision on the current subject.
- Agent output is a claim. Commit claims must equal the isolated workspace's
  HEAD; verified object packs are retained separately. Reviews and checks bind
  to an exact SHA, documents to a hash. A new subject invalidates old evidence.
- Candidate Git operations execute inside bwrap with hooks and replacement
  objects disabled. The initial clone uses the owner's trusted repository.
  Snapshot materialization reads raw objects rather than candidate attributes.
- Controller-executed processes always have `network: false`. Bwrap clears
  the environment and defaults HOME to its temporary directory. Owners must
  choose `sandbox.read` deliberately: anything mounted is readable by the run.
- SQLite is the event record. Replay reconstructs state; interrupted work
  escalates without spending again. Historical `events` databases are refused,
  not migrated or silently treated as empty.

## Limits

There is no built-in Claude or Pi integration, provider credential provision,
egress proxy, grant mechanism or repository configuration loader. The generic
`commandRuntime` protocol is the real process adapter; owners provide other
implementations as trusted TypeScript. The controller does not sandbox those
host callbacks; their candidate execution must use `StageContext.execute`.

The full clone exposes all fetched refs. Snapshots use stored bytes without
attributes or LFS conversion. There are no memory/disk quotas, global spend
limits or command-ID deduplication for owner decisions. Process output caps,
stage deadlines and finite workflow budgets do not substitute for those
limits. The lower-level process supervisor retains optional systemd scopes
and run folders, but the public controller does not use them to adopt runs.
