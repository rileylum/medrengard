# Software Factory

A vendor-neutral software delivery factory: a deterministic controller moves approved work through implementation, independent verification, bounded review and human acceptance. Agents do the reasoning; the controller decides state.

## Start here

1. [Session instructions](AGENTS.md)
2. [Current status](docs/STATUS.md)
3. [Core lifecycle v1](docs/specs/core-lifecycle-v1.md), the spec being implemented
4. [Decision register](docs/decisions.md)
5. [Architecture baseline](docs/architecture/baseline.md) and [plan](docs/plan.md)

Source: [`ai_software_factory_architecture_and_plan_v0.3.docx`](ai_software_factory_architecture_and_plan_v0.3.docx).

## Run

Node 24 or later, no dependencies.

```
npm test
```

## Layout

- `src/lifecycle.ts`: pure state machine for one delivery cycle.
- `tests/lifecycle.test.ts`: scenarios SC-01 to SC-19 as executable tests.

## Direction

Owner decisions A-001 and A-016: TypeScript and SQLite, Pi and Claude Code as first runtimes, local execution, fixed 2+1 review budget, and one recovery rule: anything the controller cannot classify stops and asks the owner. Next: a SQLite event store behind the state machine, then a runtime spike launching `claude -p` and `pi -p` with JSON output.
