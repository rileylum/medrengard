# Threat model

One page (A-125). Each design note checks its ticket against it, and each line in [accepted-risks.md](../work/accepted-risks.md) names the risk below that it accepts. Evidence and probes: `docs/research/2026-10-20-foundations/security.md`.

## What the owner worries about

In order (A-037, restated by A-115):

1. An agent going outside its remit to reach a goal, or a mistake that damages the repository or anything outside its own space.
2. An agent that has read third-party content (dependencies, documentation, issue text) acting as if hostile. Nobody has to write malicious code for this to happen.
3. Deliberately malicious code.

Defences need not be airtight (D-020). Each finding is weighed by risk, and a risk can be accepted.

## The rule

No run holds all three of these at once: private data, untrusted input, and an open network (the "lethal trifecta"). Today every developer run holds all three; the egress proxy (A-115) and the factory's own credential (later, A-115) remove one leg each.

## What is worth protecting

- The owner's logins: the claude and pi CLI credentials, code-host tokens, grant files.
- The owner's repositories and their history, including unmerged private branches.
- Services on the host and the LAN (databases, SSH, the router).
- The event store, which is the record of what happened.
- Model spend.
- The owner's machine: memory, disk, processes.

## Who acts, and what each may reach

| Actor | Trusted | Boundary |
| --- | --- | --- |
| Owner, and the owner's personal and job configuration | Yes | None; sets every security key |
| Controller (`src/`) | Yes | Host, owner UID |
| Repository configuration at the base | Partly | Read at the base SHA; may not set sandbox, grants, egress lists or the owner's floor (D-024, A-119) |
| Developer agent | No | bwrap; own clone writable; network on (all of it until the egress proxy) |
| Reviewer agents | No | bwrap; checkout read-only; read-only tools; no network tools |
| Candidate code (checks, command stages) | No | bwrap; network off unless the stage asks |
| Grant stage | Half | bwrap; one secret in its environment; runs only after a PASS verdict for the head |
| Extension runtimes and command stages | Owner's code, run as untrusted | bwrap |
| Observers | Owner's code | Host, unsandboxed; act only through owner commands |
| CLI vendors (claude, pi) | By necessity | Inside the sandbox for runs |
| Ticket authors (row 12) | No | Their text reaches the developer as input |

## Boundaries that hold today

- The controller decides state; agents return claims, checked before they count (D-001).
- Agents, checks and their tools run whole inside bwrap, not only their shell.
- Candidate files never steer the controller's git: verify reads stored bytes, and the clone's git runs only sandboxed (A-099).
- Reviewers read instructions from the base (A-100), never the developer's transcript.
- Grant values never reach agent sandboxes.
- No merge is automatic unless the owner configures one (D-023).

## Known gaps

Tracked in `docs/plan.md` (Egress proxy, Sandbox hardening, Repository trust) and [accepted-risks.md](../work/accepted-risks.md): full network for agent runs, and the Docker bridges and LAN after pasta; CLI credentials bound into runs; no resource limits or global stop; a repository workflow imported as code until JSON workflows land.
