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
| D-018 | DECIDED (A-017) | Plan steps are broken into Fast or Design tickets and delivered per [workflow.md](workflow.md) |

## Open

| ID | Question | Needed by |
| --- | --- | --- |
| O-001 | Pi and Claude Code: structured output, cancellation, isolation. `-p` and JSON modes exist on both CLIs; nothing else checked | Runtime spike |
| O-005 | Default quality checks per repository type; who may waive | First real repository |
| O-006 | Foreground process or daemon; GitHub remote; merge mechanism | Integration |
| O-007 | Backpressure: max outstanding PRs, cost and time limits | Before unattended runs |
| O-009 | Staging and deployment ownership | Release tracking |

## Approval history

### A-022 — 2026-10-16 — Fix ticket for the 04-b adversarial FAIL

Owner, after the 04-b adversarial FAIL on `8664c1b` (two majors: hostile in-process values from an adapter strand a cycle; one minor: the stage guard rejects a reviewer run whose cycle was cancelled while it ran): “option 1 go”.

Effect: ticket 04-c-total-receive, Fast route, stacked on 04-b with fresh review budget. The real claude and pi adapter ticket becomes 04-d; the two 03-b parked lines move with it.

### A-021 — 2026-10-16 — Fix ticket for the 04-a adversarial FAIL

Owner, after the 04-a adversarial FAIL on `3ba5434` (three majors in `receive` and `run_failed`): “Option 1, go”.

Effect: ticket 04-b-receive-hardening, Fast route, stacked on 04-a with fresh review budget, fixes the three majors and the related minors. The real claude and pi adapter ticket becomes 04-c; the two 03-b parked lines move with it.

### A-020 — 2026-10-16 — 04-a adapter interface design

Owner, after reading the 04-a design note and four questions (split real adapters and cgroup cancel into 04-b; controller owns the deadline; new `run_failed` event; `append` returns the Cycle): “go with your recommendations”.

Effect: 04-a is READY on the Design route with the recommended answers. The two 03-b parked lines (process-tree escape; `cancel()` guard and cwd minors) move to 04-b, the ticket that wraps `spawnRuntime` into real claude and pi adapters. The adapter seam is `src/adapter.ts`; the controller in `src/controller.ts` is the only non-test caller of `EventStore.append`.

### A-019 — 2026-10-15 — Merge 03-a/03-b with the 03-b adversarial findings parked

Owner, after the 03-b adversarial FAIL on `d8a9d21`: “option 1”. Earlier, choosing the fix ticket after the 03-a adversarial FAIL on `85e32e9`: “Go ahead with option 1, 3b”.

Effect: the stacked branch carrying tickets 03-a and 03-b is merged with standard PASS and adversarial FAIL on record. The two majors (descendants that leave the process group survive cancel; a self-re-parenting child is misreported as exited) and the minors are tracked in [work/parked.md](work/parked.md) against 04-a, which is not READY until its done-when list covers them. The findings document is qualified accordingly.

### A-018 — 2026-10-15 — Merge 02-a/b/c with the 02-c adversarial finding parked

Owner, after the 02-c adversarial FAIL on `39d2c59`: “Yep lets do 1, and make sure we are tracking the finding for when it is relevant.”

Effect: the stacked branch carrying tickets 02-a, 02-b and 02-c is merged with standard PASS and adversarial FAIL on record. The finding (a caller applying the unserialised object can diverge from replay) and the other deferred findings are tracked in [work/parked.md](work/parked.md); the first ticket that calls `EventStore.append` from non-test code must cover it. Workflow addition: parked findings gate the ticket named against them.

### A-017 — 2026-10-15 — Working agreement

Owner: “Yes plase, that sounds good. And make some notes in agents.md or somewhere for this to be our agreed workflow going forward - taking items from the plan, breaking them down into that framework and potentially multiple pieces of work”.

Effect: [workflow.md](workflow.md) is the agreed process. Plan steps become Fast or Design tickets under `docs/work/`, one branch each, tests first, owner-run verification, one fresh-session standard review (two at most), one adversarial review, owner merge. First ticket: 02-a SQLite event store.

### A-016 — 2026-10-15 — Stop design iteration; implement the core

Owner, after reviewing twelve design cycles against the v0.3 plan: “I'd much rather go back to our simpler base and let it run implementation rather than just theorizing and agonizing over a plan and edge cases which don't/haven't occured”, then “Ignore my rules”, then asked to remove the accumulated design material.

Effect: cycle-13 withdrawn before review. v0.1 and v0.2 lifecycle specs, 120 scenarios, twelve review ledgers, the manual workflow and templates were removed from the tree. They remain in Git history before commit `1214ca2` for anyone who needs them. Directions D-008 to D-015 from those cycles (paused-failure handling, held results, child recovery of interrupted development, receipt ordering) are superseded by D-016's single rule.

### A-001 — 2026-10-15 — Bootstrap direction

Owner: “I'm happy with the approach, the tech stack and I think we should target Pi and Claude Code. It should run locally.”

Effect: TypeScript and SQLite, Pi and Claude Code first, local execution. Vendor neutrality remains a constraint.
