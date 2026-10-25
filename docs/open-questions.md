# Open questions

The primitives and shipped [default workflow](../workflows/default.ts) are
current; the architecture and decision register preserve historical direction.
An owner's answer belongs in [decisions.md](decisions.md) as a quoted, dated
reply. Implementation findings belong in [work/parked.md](work/parked.md).

| ID | Question | Current boundary / needed by |
| --- | --- | --- |
| O-005 | Which independent acceptance checks should each repository run, who writes them and who may waive them? | The owner supplies check argv to `defaultWorkflows`; an exit status alone cannot prove the ticket was met. Before the first real repository. |
| O-006 | When is a daemon or remote controller needed? | `Controller` is an in-process API; a one-shot CLI (`cli/medrengard.ts`: start, show, decide) drives it. No polling service or daemon ships. Revisit for webhooks, live UI or pools. |
| O-007 | What outstanding-work, cost, time and resource limits should unattended runs enforce? | Per-stage attempts and deadlines exist; memory/disk quotas and global spend accounting do not. Before unattended runs. |
| O-009 | Who owns staging and deployment? | The default ends at the owner's PR extension. Before release tracking. |
| O-010 | How do answers in an agent UI become reviewable evidence? | Human decisions bind to an artifact subject; there is no messaging transport. Before frontend integration. |
| O-011 | What should an owner carry forward after escalation or a requested revision? | The default's `changes` decision on the current SHA restarts develop with fresh 2+1 review budgets, preserving artifacts and workspace. In design, `changes` with feedback starts a fresh run that receives the feedback and the previous plan (ticket 13). Escalation has no continuation command. Decide broader inheritance and recovery policy when needed. |
| O-012 | Which Design Studio capability comes first? | Design document, feedback-driven revision, approval by hash and handoff exist. Exploration, planning and ticket splitting remain owner workflows. |
| O-013 | Which roles, skills, MCP definitions and model adapters should real work use, and how should their versions be recorded? | Owners supply `Agent` definitions; the core has no built-in role text or vendor adapter. An example planner (role, guide, plan skill) ships in `workflows/example/` and a Claude Code runtime in `extensions/claude-code/`. Developer and reviewer roles, and recording versions, remain open. Before the full run. |
| O-015 | Which acceptance artifacts must a PR carry? | The `pr` extension receives all artifacts; the owner chooses the package and filters evidence by current SHA. Before real code-host integration. |
| O-017 | Which advisory gates and waivers should a workflow permit? | Gates and transitions are trusted owner TypeScript; legacy grant-stage and owner-move policy was deleted. When an owner workflow needs advisory checks. |
| O-018 | What messaging routing, visibility, delivery and trust rules should apply? | A-144 and the messaging research remain direction; live messaging is not implemented. Before the first messaging workflow. |

O-014's survey was answered by A-125; the research kept for planned work is
indexed in `docs/research/README.md`. Network is declared per sandbox under
A-146; destination-specific network and historical database migration are
capability gaps in [parked findings](work/parked.md).
