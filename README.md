# Software Factory

A vendor-neutral software delivery factory, being built using its own methodology **manually before automating it**.

## Start here

1. [Session instructions](AGENTS.md)
2. [Current status and next session](docs/STATUS.md)
3. [Architecture baseline](docs/architecture/baseline.md)
4. [Manual operating procedure](docs/manual-workflow.md)
5. [Implementation plan](docs/plan.md)
6. [Decision register](docs/decisions.md)
7. [Work contracts](docs/work/README.md) and [reusable templates](docs/templates.md)

## Source and authority

The source is [`ai_software_factory_architecture_and_plan_v0.3.docx`](ai_software_factory_architecture_and_plan_v0.3.docx), version 0.3, dated 15 October 2026. It is a working design, not evidence that integrations are supported.

These Markdown documents are a working interpretation and bootstrap proposal. They do not silently approve the source's PROPOSED or OPEN choices. Explicit owner approval is required to accept a specification version or change governing rules. See the decision register for unresolved choices.

## Accepted initial direction

Owner approval A-001 (2026-10-15): manual contracts-first bootstrap, **TypeScript + SQLite**, **Pi and Claude Code** as initial runtime targets, and **local execution**. Runtime capabilities and detailed lifecycle policies still need validation/design approval.

## Current implementation

Documentation only. No application, dependency setup, automated tests, controller, runtime adapters or GitHub integration exists. No commands for building or testing the factory have yet been established. Local Git history was established during SF-001 review; no remote is configured. Three bounded design-review cycles exhausted their standard-review budgets. The remaining finding concerns the paused verification-recovery path; the next step is owner policy choice and explicit revision authorisation. See `docs/STATUS.md`.

The first automated milestone will be one bounded READY issue reaching a human-reviewable PR without manual stage advancement, with independent evidence, bounded reviews and safe recovery. Until then, humans and agents execute and record those steps explicitly.
