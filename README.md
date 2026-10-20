# Software Factory

A vendor-neutral software delivery factory: a deterministic controller moves approved work through implementation, independent verification, bounded review and human acceptance. Agents do the reasoning; the controller decides state.

## Start here

1. [Session instructions](AGENTS.md)
2. [Current status](docs/STATUS.md)
3. [Working agreement](docs/workflow.md): plan step to ticket to branch to review to merge
4. [Core lifecycle v1](docs/specs/core-lifecycle-v1.md), the spec being implemented
5. [Decision register](docs/decisions.md)
6. [Architecture baseline](docs/architecture/baseline.md), the one-screen summary, and [plan](docs/plan.md)
7. [Full architecture v0.3](docs/architecture/source-v0.3.md), converted from the original DOCX with diagrams

## Run

Node 24 or later, no dependencies.

```
npm test
```

## Use

Write a job file naming the work ID, the ticket, the repository, its checks and the runtimes. Then:

```
node src/main.ts job.json                # run the job to AWAITING_ACCEPTANCE or ESCALATED
node src/main.ts accept job.json <sha>   # accept the full candidate SHA the run printed
node src/main.ts cancel job.json         # cancel the open cycle, else every ESCALATED one
```

A work ID runs again once its cycle is accepted or cancelled. Merging stays with you: the run and `accept` print the merge line. A `cancel` of an open child cycle leaves its ESCALATED parent; a second `cancel` clears it. Once the parent is cancelled, remove `parentCycleId` from the job file.

## Known limitations

- Verify checks out a candidate's stored bytes. It reads no `.gitattributes`: not the candidate's, not yours, not the system's. So `eol`, `ident` and filter conversions such as git-lfs smudge do not happen there: an LFS repository's checks see pointer files, and a file declared `eol=crlf` keeps the LF it is stored with. With `core.autocrlf=true` in your git config, a repository cannot opt files out with `-text`. Reading attributes would let a candidate run your filter programs outside the sandbox (A-099, [accepted risks](docs/work/accepted-risks.md)).

## Layout

- `src/lifecycle.ts`: pure state machine for one delivery cycle.
- `tests/lifecycle.test.ts`: scenarios SC-01 to SC-19 as executable tests.

## Direction

Owner decisions A-001 and A-016: TypeScript and SQLite, Pi and Claude Code as first runtimes, local execution, fixed 2+1 review budget, and one recovery rule: anything the controller cannot classify stops and asks the owner. Next: a SQLite event store behind the state machine, then a runtime spike launching `claude -p` and `pi -p` with JSON output.
