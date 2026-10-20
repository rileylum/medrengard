# Architecture baseline

The full design is [source-v0.3.md](source-v0.3.md), a Markdown conversion of the original [DOCX](source-v0.3.docx) with Mermaid diagrams. Read that for any section-level question. This page is the one-screen summary.

## Goal

Owner attention goes upstream (discovery, design, acceptance of specifications) and downstream (reviewing demonstrated outcomes, release decisions). Between those points a deterministic controller moves small, verifiable tickets through portable agents, independent verification and bounded review. The controller is not another LLM.

Core goals, which every rewrite comes back to (A-125): a strong core; sane defaults, with control and customisation left to the owner; extensibility; observability.

First measurable outcome: one READY issue reaches a human-reviewable PR with no manual stage advancement, with a safe failure path.

## Invariants

- Only the controller changes state or spends review budget. Agent output is a claim until verified.
- Evidence binds to an exact commit SHA. A new commit invalidates old evidence; spent budget stays spent unless the owner overrules (A-114).
- Default policy since D-023, not an invariant: two standard reviews and one adversarial review per cycle. Failure at the limit escalates to a human.
- Reviewers get a fresh context: contract, diff, SHA, instructions, verification output. Never the developer transcript.
- Missing or unavailable checks are FAILED, BLOCKED or HUMAN-WAIVED. Never inferred PASS.
- Humans accept PRs and approve changes to intent, scope, security and the factory's own rules. Default policy since D-023: no automatic merge or production deployment. The controller itself never merges or deploys; a merge happens only through a grant the owner gave in personal or job configuration (A-125).
- Runtime, model and role are independent dimensions. No vendor type in the core domain model.
- Personal and corporate environments share factory source code and nothing else.
- Issue text, tool output and worker artifacts are untrusted input.
- Continuous Improvement proposes; it never edits gates, policy or its own prompts.

## Contracts

Specification, ready ticket, worker result, review, acceptance package and release record. Field lists are in source §§3, 4, 8, 10 and 13.

## Non-goals for the first release

New agent runtime, shared credentials, unrestricted merges, automatic production deployment, cross-repository scheduling, semantic memory service, autonomous policy change, custom dashboard, vector database.
