# Decision register

DECIDED = source direction or a recorded owner reply. PROPOSED = recommendation. OPEN = unresolved. Latest entry wins. An owner approval is a quoted reply with a date; never invent one.

## From the source (v0.3)

| ID | Direction | Source |
| --- | --- | --- |
| D-001 | Deterministic controller; agents supply reasoning and results, not transition authority | §§1–2, 6 |
| D-002 | Vendor-neutral core; runtime, model and role are independent; personal and corporate domains separate | §§1, 5, 15 |
| D-003 | Two standard reviews and one adversarial review per cycle; stop on terminal failure; adversarial FAIL escalates immediately | §7, 15 |
| D-004 | Explicit human final acceptance and approval of design and governance changes | §§2–3, 10–12 |
| D-005 | Full risk-tailored SDLC; no automatic production deployment initially | §§1, 13, 15 |
| D-006 | Pools: three developers, two or three reviewers, one adversarial run at a time | §§1, 6 |

## Owner decisions

| ID | Status | Decision |
| --- | --- | --- |
| P-001 | DECIDED (A-001) | Markdown contracts and manual stage advancement until the controller replaces them |
| P-002 | DECIDED (A-001, A-016) | TypeScript core, SQLite state. Node 24 built-ins only; no dependencies until a test needs one |
| P-005 | DECIDED (A-001) | Run locally; corporate execution separately authorised |
| D-007 | DECIDED (A-001) | First runtimes: Pi and Claude Code |
| D-016 | DECIDED (A-016) | [Core lifecycle v1](specs/core-lifecycle-v1.md) is the implementation baseline. One recovery rule: anything unclassified escalates; owner chooses child cycle or cancel. Edge-case semantics are added only when a test or a real incident requires them |
| D-017 | DECIDED (A-016) | Design documents are not put through adversarial review on their own. The 2+1 rule applies to code with executable tests |

## Open

| ID | Question | Needed by |
| --- | --- | --- |
| O-001 | Pi and Claude Code: structured output, cancellation, isolation. `-p` and JSON modes exist on both CLIs; nothing else checked | Runtime spike |
| O-005 | Default quality checks per repository type; who may waive | First real repository |
| O-006 | Foreground process or daemon; GitHub remote; merge mechanism | Integration |
| O-007 | Backpressure: max outstanding PRs, cost and time limits | Before unattended runs |
| O-009 | Staging and deployment ownership | Release tracking |

## Approval history

### A-016 — 2026-10-15 — Stop design iteration; implement the core

Owner, after reviewing twelve design cycles against the v0.3 plan: “I'd much rather go back to our simpler base and let it run implementation rather than just theorizing and agonizing over a plan and edge cases which don't/haven't occured”, then “Ignore my rules”, then asked to remove the accumulated design material.

Effect: cycle-13 withdrawn before review. v0.1 and v0.2 lifecycle specs, 120 scenarios, twelve review ledgers, the manual workflow and templates were removed from the tree. They remain in Git history before commit `1214ca2` for anyone who needs them. Directions D-008 to D-015 from those cycles (paused-failure handling, held results, child recovery of interrupted development, receipt ordering) are superseded by D-016's single rule.

### A-001 — 2026-10-15 — Bootstrap direction

Owner: “I'm happy with the approach, the tech stack and I think we should target Pi and Claude Code. It should run locally.”

Effect: TypeScript and SQLite, Pi and Claude Code first, local execution. Vendor neutrality remains a constraint.
