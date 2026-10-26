# Decision register

Owner decisions and the rules that follow from them. Latest entry wins. An owner approval is a quoted reply with a date; never invent one. [core.md](core.md) overrides this file where they disagree.

Entries were trimmed on 2026-10-25 (A-147) to the rules and approvals still in force; the full text is at commit `c3f91f9` (`git show c3f91f9:docs/decisions.md`). Open questions, O-001 onwards, are in [open-questions.md](open-questions.md).

## Current rules

Summaries of what still holds, not owner quotes. The cited entries hold the approvals.

| ID | From | Rule today |
| --- | --- | --- |
| D-001 | source | The controller is deterministic and the only writer of state and budget. Agent output is a claim until the controller checks it (`docs/core.md` invariants). |
| D-002 | source, A-001 | The core is vendor-neutral: an `Agent` names its runtime, role and sandbox independently, and runtime adapters live in extensions. Personal and corporate domains stay separate. |
| D-003 | source, A-054, A-150 | Default policy, not core (D-023): the shipped default runs up to two standard reviews and one adversarial review per round, with bounded fixes. A failure that would end the run goes to the owner's decision instead of escalating (`workflows/default.ts`). |
| D-004 | source, A-054 | Default policy, not core (D-023): the default has the owner approve the design and the reviewed result before the PR. |
| D-005 | source | A full, risk-tailored SDLC is the destination. No automatic production deployment; the default ends at the owner-approved PR (O-009). |
| D-006 | source | Pools of three developers, two or three reviewers and one adversarial run at a time stay the source design target. Not built; no concurrent pools before M5 (`docs/roadmap.md`). |
| D-007 | A-001, A-146 | First runtimes are Claude Code and Pi. Claude Code is built as `extensions/claude-code/` and uses a subscription token; Pi is not yet built. |
| D-016 | A-016, A-114, A-125 | Anything the controller cannot classify stops and asks the owner; no silent recovery or automatic retry. Edge-case semantics are added only when a test or a real incident needs them; read with A-037 and A-042, a probe-only edge case with no incident and no damage by mistake is parked or accepted. |
| D-019 | A-035 | Candidate code runs in a sandbox chosen by backend name. `bwrap` is the only backend (`src/sandbox.ts`), with no network unless declared. No VM or cloud backend for now; the interface stays agnostic. |
| D-020 | A-042, A-148 | The risks that drive design are agent mistakes (a command that deletes more than it meant to) and agents leaving their task, on the owner's personal repositories and machine. Prompt injection, credential exfiltration and malicious code are not design drivers. Agents get the freedom their task needs. Each adversarial finding is weighed by risk; an owner-accepted risk goes to [work/accepted-risks.md](work/accepted-risks.md). |
| D-021 | A-043, A-148 | The factory may run on any repository, not only scratch ones. Network, credentials and paths follow the access the owner declares for each agent and stage. |
| D-023 | A-054, A-113 | Strong core, sane defaults, user extensions, as `docs/core.md` defines them. The core holds the primitives and invariants; stages, budgets, human approval, merge and PR rules are workflow policy, with a default shipped beside the core. Extensions are TypeScript modules. Supersedes D-004 and D-003 as fixed rules. |
| P-002 | A-001, A-016 | TypeScript core on Node 24 with `node:sqlite` state. Node built-ins only; no dependencies until a test needs one. |
| P-005 | A-001 | Run locally; corporate execution needs separate authorisation. |

## Approval history

### A-150 — 2026-10-26 — The default routes failures to the owner

After the proposal to send terminal review failures to the owner stage rather
than `ESCALATED`, which cannot be continued: “Yeah the owner route is good,
maybe all fails that would end the run should go there?” Then: “I think our
default should be to route to owner as much as possible instead of escalate.
Again this is jsut the workflow not a core thing”.

Effect: in `defaultWorkflows`, every workflow edge that would end a round on a
failure leads to `owner`, and budgets are sized so the edges reach it before a
budget runs out (check 4, fix 3, standard 2, adversarial 1; at most seven paid
runs a round). The core's own escalations (runtime errors, deadlines, invalid
claims, interrupted runs) are unchanged. Revises D-003's adversarial rule.

### A-149 — 2026-10-26 — Full run scope: configurable primitives and shipped defaults

On stage access, after the proposal for ticket 14: “C1 - again I think this is
a problem where we are being too prescriptive, is a command stage an agent or
is it just code? Either way, we need the primitive that allows it to be
customisable - then we define our own as required, and use it.” “C2 - Yes I'm
fine with things being writable, as above it should be customsiable in the
primitive and defined for its use”. On the stage deadline: “Actually we have a
follow up issue to change the deadline to be a stall timeout, so its probably
not worth changing here and if we need we'll just up the time.”

Scope: “Lets publish and include C6 and R4 in scope. Sonnet is fine for now.
And we can leave the escalation path out of the ticket.” Shape: “Write up the
plan the shape generally looks right if we keep in mind the core primitives,
that are configurable and extensible, then we build sane defaults from those
in the form of agents and workflows etc. If any of the code we touch needs a
refactor to bring it in line with this - do that also.”

Effect: [ticket 14](work/14-full-run.md). Stages declare their access; a
command stage is trusted code with no built-in verdict rule; the shipped
agents, check, publisher and workflow are defaults built from those
primitives. Event times (C6) and full Claude Code transcripts (R4) are in
scope; the run publishes a PR on bolts_n_blades; Sonnet for every agent.
Continuing an escalated work and the stall timeout are out. The paid live run
still needs its own approval.

### A-148 — 2026-10-26 — Risk appetite: mistakes and scope, not hostile input

Owner: “Okay the check access and developer risk are fine - I think we've way
overtuned the risk profile/appetite - this is for working on personal repos on
my machine, I'm concerned with agents accidentally running a command that
deletes a whole directroy instead of just the one it wanted to because of a
badly formatted grep or something - or going outside the bounds of its task.
Not prompt injection, credential exfiltration etc. - though they will probably
fall out of the controls we're putting in place. Agents need as much freedom
as possible to actually do their work - update the docs to reflect this.”

Effect: the [threat model](security/threat-model.md) is framed around one
owner's personal repositories on their own machine. The controls exist to
contain accidents and keep agents inside their task: the sandbox bounds what a
mistaken command can damage, and evidence binds to what was actually checked.
Prompt injection, credential exfiltration and deliberately malicious code are
not design drivers. Agents get the access their task needs, declared by the
owner; a developer with `Bash`, network and the token, and a check installing
dependencies with network, are within this appetite. Supersedes the
malicious-code scope of A-042 (D-020).

### A-147 — 2026-10-25 — Documentation sweep and decision log trim

Owner, in answer to the documentation sweep proposal (trim this log to in-force entries with a retired-ID index; delete research and architecture files about deleted code; fix stale claims in current docs; delete `docs/work/m2-first-journey.md` and `docs/refactor/prompt.md`; remove stale worktrees and merged branches; rename the checkout directory to `medrengard`): “Fix all”.

Effect: reverses A-125 item 8; merge and waiver records no longer stay in this file. Entries not in force are listed under Retired IDs; the full log is at commit `c3f91f9`.

### A-146 — 2026-10-25 — First run example, phase split, subscription token, factory layout and installer

Example: “Let's go with the remove hit sounds, but split it in two. Leave the
knife sounds and just focus on the guns”. Entry input, verbatim: “remove the
hit sound from rifle hits, as they aren't heard over the fire and bolt sounds”.

Phases: “I'd suggest instead splitting this into two phases the first is just
the workflow interactive - then we can work out how to build the interactivity
in a later slice”. Agreed reading: in phase 1 agents run headless and the owner
interacts at the workflow's human gates through a CLI; interactive agent
sessions in herdr tabs, with per-tool-call approval, are a later slice. Then:
“Yes let's do that, and we'll use a subscription token.”

Layout: “Should we split at medrengard core and then the personalized factory
which is the workflows, also maybe extensions separately?” After the proposal:
“Yes I think that's all right” and “Okay this all sounds good.” Direction, not
current scope: “eventually a factory to be able to manage multiple projects and
repos and have different workflows for different tasks. I'd also like to have
core extensions (like the model adapters) and personal ones, in the factory.”

Installation: “We can just install with a bash script, that deploys a folder
structure that can be used and built within. Then the script run again would
just update, so we'd need to maybe hide the core in a . medrengard directory”.
Then: “Use your proposed placeholder, I'm fine with setting up a symlink for
our active development but the final/real product should use the install
script”.

Effect: the first run is the rifle half of bolts_n_blades slice 4; the knife
keeps its hit sounds. Phase 1 ends at an owner-approved plan
([ticket 13](work/13-phase-1-plan.md)). Medrengard holds the core, core
extensions (runtime adapters first) and the CLI. The owner's factory,
`~/dev/medrengard-factory`, is a separate repository holding workflows, agents,
prompt content and personal extensions, and imports only the public API. The
product installs the core into the factory's `.medrengard/` with a script that
updates on rerun; during active development `.medrengard` is a symlink to this
checkout. The provider credential is a Claude Code subscription token.

Risk: “As for the risk it's fine, but a follow up needs to be specific network
access rather than a simple on/off”. The owner accepts, for phase 1, that a
planner holding the token with unrestricted network could leak it through a
prompt injection; a following ticket narrows network access to named
destinations ([accepted risks](work/accepted-risks.md)).

Default: “I suppose whatever workflow we build should probably become the
default? And we can ship it as the example and a sane default?” Then: “Yes
record it”. The workflow each ticket builds becomes the shipped default and
example, with runnable example agents (role text, skills, guide); it stays the
whole idea-to-PR journey, and each ticket upgrades its part. Personal content
(repositories, credentials, tuned prompts, personal extensions) stays in the
factory, which imports the default until it diverges. The installer seeds the
factory from it. Ticket 13 adds the `changes` loop to the default's `design`.

No implementation, paid run or external publication is authorized by this
record.

### A-145 — 2026-10-24 — First user journey with human approval and feedback

*Still holds: the first journey is the M2 target; A-146 split it into phases. The work log it names was deleted by A-147.*

Owner: “Okay yeah thats pretty much my idea, idea -> plan/spec -> implement ->
review -> PR.” After discussing plan refinement, bounded reviewer/fix loops,
owner-requested result revisions and human approval before implementation and
publication: “And yes you're right we need to have the feedback loop - at this
stage with the human in the loop to approve. Lets lock that in, document it
where it makes sense including the handoff so the next session knows what to
do.” The discussion was explicitly documentation-only: “Okay, lets not
implement anything here, but lets talk about that first user journey”.

Effect: [the first journey](roadmap.md#first-user-journey--agreed-2026-10-24)
is the M2 target. One small change in an existing repository goes through an
owner-approved plan/spec, automatic development/check/review stages with a
bounded fix loop, owner revision and approval of the reviewed result, then
real PR publication. Feedback is durable; human approval gates remain in the
owner workflow. One provider initially, distinct developer/reviewer runs, and
a supported stopped/interrupted path keep the first delivery bounded. PR merge
is separate from publication approval.

Next, define the owner's entry input and plan/spec approval experience and map
that journey onto the existing public API before proposing new primitives.
Provider choice, access boundary, recovery guarantees, operator interface and
exact failure/review policy remain to be designed. No code, paid run or external
publication is authorized by this documentation request. Work log:
M2 journey definition.

### A-144 — 2026-10-22 — Messaging primitives: a published artifact between cycles and a live channel per run, open to observers

*Still holds as direction, unbuilt; O-018 stays open. Its references to the observer `note`, pasta, the egress proxy row and A-117 are to retired plans (see Retired IDs).*

Owner, asking whether several agents can work at once and talk to each other while each stays sandboxed: “I have found it valuable to have streams work on dependent or linked work be able to communicate between each other to validate design etc. so it is a paradigm or a workflow that should be possible.” After the research (`docs/research/2026-10-22-agent-messaging/`), offered its ranking: (1) the upstream cycle publishes an interface file bound to its SHA and a downstream cycle checks against it, with no live channel; (2) a live channel, one controller-owned socket per run bound into its sandbox, with the controller recording each message as an event; (3) one VM per run on the home server. Owner: “Okay thats great, and pasta is already planned to be setup. My recommendation is to build the primitives to allows both option 1 and 2 - and there is no requirement for this to just be used for cross agent communication, then an observer extension could send messages through the same channels.”

Effect: messaging is a core capability under A-113, with the policy left to workflows and extensions. The primitives, to be ticketed:

1. A message is an event the controller records before delivery. The controller sets the sender and the sender's head; the body is a file with a hash, never argv.
2. Every sender is known by the channel the message came in on: a run by its own socket, an observer through the observation stream (its `note`, A-074, becomes a message), the owner through a command.
3. Each adapter may deliver a message mid-run (claude hooks, pi `steer`, a fixed herdr doorbell); a runtime with no way in gets its messages at its next run.
4. A stage's SHA-bound output can be named as an input to a linked work item's cycle (extends A-117's declared inputs across cycles).
5. Routing (who may message whom), visibility (which stages see messages) and caps are extension points; the observer is the first user of routing (A-124). The defaults are not decided (O-018).

It builds on A-106 (pasta) and the egress proxy row, not before them. The VM option (3) is not adopted; D-019 stands. What is still open is O-018. Docs only; no test run.

### A-143 — 2026-10-21 — 11-d: the adversarial findings tested on the branch; a hand-run accept without a command ID accepted as a risk

*Only (3) still holds: accepted for `decide()` in `docs/work/accepted-risks.md`. The 11-d branch, its tests and command IDs went with the deleted pre-refactor code.*

Asked, after 11-d's adversarial FAIL on `2be3768`: (1) the "major", no test sends the observer kit's cancel ID, so a kit that gave an accept and a cancel for one line one ID passed every test (a missing test for correct code, a minor under `docs/workflow.md`); (2) the minor, no test tells that `cancelWork` passes no `after`; (3) the note that an `accept` with no `--command-id` is not deduplicated, so on a workflow OWNER → MERGE → FINAL whose MERGE keeps the head a retyped `accept <sha>` would also accept FINAL. The session recommended adding both tests on the branch, each red on its mutant, without a further review (as A-137), and accepting (3) as designed, with a line in `docs/work/accepted-risks.md`. Owner: “Go as you recommend”.

Effect: (1) and (2) are tested on `feat/11-d-owner-events-bound`; the review budget is spent, so the tests have the implementer's mutants only. (3) is in `docs/work/accepted-risks.md`.

### A-125 — 2026-10-21 — Process and record: contradictions fixed, review tiers, a pre-merge test hook, a threat model, a private remote, dogfooding

*Still holds: item 1 (core goals, now in `docs/core.md`; `baseline.md` was removed by A-147), item 4 (pre-merge hook), item 5 (threat model) and item 6 (the private remote, created in A-128). Items 2, 3 and 7 described the deleted spec, plan and `workflow.md` (review tiers retired with it); item 8 is reversed by A-147.*

Owner, on foundations theme T12 (`docs/research/2026-10-20-foundations/design-audit.md` P5, P6, P10, P11, section 6.1; `security.md` P12), with the session's recommendations (fix the contradictions now; spec up to row 10 as a docs ticket that becomes the current-rules page; merge records stay in this file; review tiers and a pre-merge hook; a private remote the owner creates; a threat model page; dogfooding after row 11): “Yes, but make sure when we rewrite anything we come back to the core goals - strong core, sane defaults but control and customizability to the user, extensibility and observability (plus anything else I'm missing).”

Effect:
1. Core goals, in `docs/architecture/baseline.md`, which every rewrite comes back to: a strong core; sane defaults, with control and customisation left to the owner; extensibility; observability. The session proposed five more (vendor neutral, D-002; local first, A-001; the controller decides, D-001; safe by default, D-019 and D-023; durable and recoverable, row 11 and A-122). Owner: “Yes please”. All nine are in `baseline.md`.
2. Contradictions fixed in this branch: the spec's core rules 2 and 3 note what A-114 and A-108 change when built; `baseline.md` marks 2+1 reviews and no automatic merge as default policy (D-023); plan row 11 follows A-105 and A-122, not source §06's retry; D-016 reads with A-037 and A-042 (a probe-only edge case with no incident and no damage by mistake is parked or accepted); A-054's "the controller itself never merges" reads as "a merge happens only through a grant the owner gave". O-001 (answered by row 3, A-019) and O-014 (answered by both research passes) are closed; `parked.md`'s "pending review" lines for 08-d say merged. A-118 already reversed A-030 and gave both runtimes the same developer powers (D-002); A-120 makes the model selectable.
3. Review tiers in `docs/workflow.md` and `AGENTS.md`: Trust (store, controller and engine, sandbox, grants, git over candidate trees) keeps 2+1 through `claude -p`; Light (refactors, docs, the guide) gets one review. A missing test for correct code is a minor finding.
4. Independent verification is `scripts/pre-merge-commit`, a git hook the owner installs once; it runs `npm test` on an export of the merge result's index. The session ran it on this branch: 450 tests, 426 pass, 0 fail, about 30 s.
5. `docs/security/threat-model.md`: one page of concerns, the trifecta rule, assets, actors and boundaries.
6. A private remote for this repository, push only, no CI: the owner creates it.
7. Plan rows: "Spec up to date" (docs ticket) and 11a "Dogfooding", after row 11.
8. Merge and waiver records stay in this file.

### A-124 — 2026-10-21 — Extension points on demand; a decision shape for dispatch; observer verbs; manifest and lock later

*Item 1 still holds (`AGENTS.md`). Items 2 to 4 were rows of the deleted plan and are unbuilt; item 5 is moot since `learn/` was cut.*

Owner, on foundations theme T11 (`docs/research/2026-10-20-foundations/extend-config.md` proposals 6, 7, 8; `design-audit.md` P7): “As recommended”.

Effect:
1. A-113 gains a counterweight, also in `AGENTS.md`: build an extension point when a workflow or extension the owner runs needs it; until then, plain code. The same rule as "zero dependencies until a test needs one". A-117's step-type registry already follows it.
2. Dispatch (row 12) uses a decision shape: a pure, sandboxed JSON function whose answer is recorded as an event. The default stays a number in config. Widens D-024 from two shapes to three.
3. With `stop-run` in the Run records row: observers may also send `note`, and the store keeps a cursor per observer. An `sf observe` supervisor waits with O-006.
4. An extension manifest and lock file, pinned by content hash, is a plan row built before the first workflow or extension is shared outside this repository.
5. `learn/` is unchanged from A-112.

### A-122 — 2026-10-21 — No daemon now; runs outlive the controller, and recovery adopts finished runs

*Item 1 still holds: no daemon; O-006 stays open. Item 2's run supervisor was built and then deleted in the refactor; an interrupted run now escalates without retry.*

Owner, on foundations theme T9 (`docs/research/2026-10-20-foundations/runtime-process.md` proposals 4 and 7; `design-audit.md` P4), asked: no daemon now, with three triggers recorded on O-006; and runs that outlive the controller in row 11, finished runs adopted by default: “Yep this all sounds good, a daemon is probably the long term goal (especially one that could run on a VM and then serve to another computer for example)”.

Effect:
1. O-006 stays open with the long-term goal and the triggers in `docs/open-questions.md`. The factory stays one-shot commands over SQLite; `recover` and later `dispatch` are commands the owner or a systemd user timer runs. A later daemon calls the same commands.
2. Row 11's fifth ticket, before `recover`: runs outlive the controller. Output and exit code go to files kept by a supervisor that is not the controller. `recover` watches or stops a running run, receives a finished one under its original run ID, and escalates one that left nothing. Widens A-105: a run that finished while the controller was down is received, not escalated; this is not a relaunch. A "never adopt" setting keeps A-105 exactly. Unverified: whether a systemd transient unit keeps its exit status after it ends.

### A-115 — 2026-10-21 — Egress proxy joins the parked domain-filtering line; own credential later; threat model restated

*Still holds: item 3 (threat model, `docs/security/threat-model.md`); items 1 and 2 stay later work, item 1 now as A-146's named-destinations follow-up. The pasta ticket and its Docker-bridge risk went with the deleted sandbox code.*

Owner, on foundations theme T2 (`docs/research/2026-10-20-foundations/security.md` P1, P2 and "Challenged decisions"): “Okay we already have domain filtering on the plan right? So p1 should go with that.” “P2 is worth looking at in the future, it sounds like it has the potential to degrade the experience, so I would want to be careful.” “Can restate 037”.

Effect:
1. Egress proxy (P1): the controller runs a proxy per run, and the sandbox has no network of its own. The proxy allows hosts from a list set only in the owner's personal or job layer, resolves names itself, refuses loopback, link-local, private, Docker-bridge and host addresses, and logs each connection. It joins the parked 08-a domain-filtering line, which A-106 kept parked, and gets a row in `docs/plan.md`.
2. Factory credential (P2): looked at later, not scheduled. The factory would run on its own revocable credential instead of the owner's CLI logins, injected by the proxy or passed through the environment. The owner's condition: it must not degrade the experience of using the CLIs.
3. Threat model, restating A-037: an agent that has read third-party content (dependencies, documentation, issue text) may act as if hostile, though nobody wrote malicious code. Defences need not be airtight (D-020 stays), but no run should hold private data, untrusted input and an open network together. The owner's first concern from A-037 stands: an agent going outside its remit, or a mistake that causes damage.

Owner, asked whether to build the pasta ticket (A-106) as planned with the Docker-bridge and LAN gap recorded as an accepted risk until the proxy lands, or skip to the proxy; and whether T1's in-place moves go in row 11 after the three refactors and before `recover`: “Yes to both recommendations”.

Effect: the A-106 ticket stays as planned; its record notes that host services on Docker-bridge addresses (172.17.0.1, 172.18.0.1 probed) and LAN hosts (192.168.1.1 probed) stay reachable until the egress proxy, and `docs/work/accepted-risks.md` lists it. T1 (A-114) is row 11's fourth ticket, before `recover`, with A-109 B folded in.

### A-114 — 2026-10-21 — An escalated cycle waits for the owner; it is no longer a dead end

*The principle still holds: an escalation stops and asks the owner and is not always an abandon. The owner moves were built and then deleted in the refactor; the current core has no continuation command after escalation (O-011).*

Owner, on foundations research theme T1 (`docs/research/2026-10-20-foundations/TRIAGE.md`; `engine.md` P1, `design-audit.md` P1): “Yes this is a good change, an escalation shouldn't always be an abandon and we need to have flexibility in how we treat it.”

Effect:
1. ESCALATED becomes a stage that waits for the owner. The owner answers with an `owner_decision` event carrying the action, a quoted reason, its source and the head SHA. Moves: `retry` the stage that escalated (spent budget stays spent); `overrule` a FAIL (A-109 B: refund one unit of that stage's budget, rerun the stage); `fix` chosen findings, verify, then continue at a named stage; `accept with risk` (the findings go to accepted risks); `route` to a stage the checker allows; `cancel`. A child cycle stays for "start over", with an option to start from the parent's candidate instead of the base.
2. Widens D-016 and A-072: anything unclassified still escalates, and the owner has the moves above as well as child cycle and cancel. ESCALATED leaves `SETTLED`; the one-open-cycle rule treats it as open and waiting.
3. Spec core rules 2 and 3 change with the ticket that builds this: spent budget stays spent unless the owner overrules, and the owner's choices are the moves above.
4. A-113: the core holds the moves; whether a workflow offers one is policy. An observer may send `retry` with its own source, which gives opt-in automatic relaunch without changing A-105's default.

### A-113 — 2026-10-20 — Principle: capabilities and extension points in the core; defaults are sane, not enforced

*The principle still holds (`AGENTS.md`, `docs/core.md`). Items 1 to 4 applied it to rows of the deleted plan.*

Owner, on the last unranked research items (a gate on cycles waiting for the owner, a stall watchdog, a stronger model for the last fix round, GitHub sync notes): “Okay these all look good, but I want to make sure we're focused on making them possible in the core and with extensions not necessarily just enforcing them.” And: “the check for what and when a ticket becomes available should be extensible”; “The watcdog itself is probably an extension built on our observability right?”; “The stronger model is probably just a different workflow, so again lets just make sure we support it in the workflow engine but we don't necessarily need to do that for our default.” Then, on the session's write-up: “Yes please”.

Effect, a standing principle for every ticket: build the capability or extension point in the core, ship a sane default, and leave policy to workflows and extensions. A ticket that adds policy says which extension point holds it. Applied now (`docs/plan.md`):
1. Dispatch (row 12): an extension point decides which ticket may start next and when; the default refuses a new cycle while K cycles wait on the owner.
2. Watchdog: an observer extension. The core adds what it lacks: progress or heartbeats from a run in flight, and a request that stops one run without settling the cycle (Run records row).
3. A stronger model: a workflow choice. A second commit stage under its own role is likely possible today and gets a proving test; a runtime entry may name a model or arguments (Role prompts row).
4. GitHub sync notes: confirmations of A-095, A-100, no automatic merge, and grants (row 12).

Owner, asked whether to add the principle to `AGENTS.md` as well: “Yes add it to agents.md as well.” It is a line under "Rules".

### A-111 — 2026-10-20 — The smaller research items: three soon, the rest tracked; "Ken Chun" is Kun Chen

*Only "a repository workflow is data, never code" still holds (`docs/core.md`), and the name correction. The tracked items were rows of the deleted plan.*

Asked, from the overnight research (TRIAGE owner items 8 to 18): ticket soon (1) run records: `run_failed.cause`, cost, tokens, model and CLI version per run, and `claude`'s turn and budget caps; (2) JSON workflows, with a repository workflow required to be data (closes A-078); (3) `protocol: 1` on the extension contracts. Track for later: a `doctor` command, a `status` command with clearer job-file errors, clone cleanup, faster tests, and a warning at `accept` when the base moved (`head_changed`/`base_changed` have no producer, A-103). Owner: “Yes agree with the split, these all seem very useful so I'd definitely want them all done at some point.”

Also, the owner on the person the brief named "Ken Chun": “Kun Chen is the correct person” (GitHub `kunchenguid`, author of no-mistakes, which the research used).

Effect: each item is a row in `docs/plan.md`'s later work. The three "soon" items are drafted as tickets first; each needs the owner's go before it is READY.

### A-099 — 2026-10-20 — sweep-git-hardening: merged; the stored-bytes trade-off logged

*The stored-bytes trade-off still holds for snapshot materialization (`docs/work/accepted-risks.md`). The branch and `verify` code it merged are deleted.*

Owner, after the walkthrough: “Okay this is good, but I'd want the tradeoff logged - probably as a limitation in the README if not elsewhere as well. It might be something we need to revisit”.

Effect: `feat/sweep-git-hardening` merges into main locally with `--no-ff`. Verify's checkout reads no attributes and holds the commit's stored bytes; the trade-off (no `eol`, `ident` or LFS conversions; the `core.autocrlf` caveat) is logged in the README's "Known limitations" and as a row in `docs/work/accepted-risks.md`, with the event that reopens it. One fresh in-session review covers the branch (PASS, findings fixed); the `claude -p` reviews and the adversarial review did not run. The owner did not run `npm test`; the session's run on the branch with main merged in is not independent (result in the ticket log).

### A-054 — 2026-10-19 — Strong core, user-definable workflow, extensions

*The direction still holds, restated by `docs/core.md`, which overrides it: core primitives and invariants, policy in workflows. The module list is the deleted pre-refactor code, and extensions are now TypeScript modules rather than JSON-over-stdio processes. "The controller itself never merges" reads as in A-125.*

Owner, opening an architectural discussion: “Basically I want to publish a strong core application, this is probably the state machine. Then the rest of the application is sort of plug and play, adapatable and configurable [...] The other thing that I would want is that the factory itself is modifiable outside the core, not just in configuration but we should look for opportunities to allow something like lua or ts code to be written by a user that is personal and works with our core.”

Offered: extensions sit on the agents' side of the trust line and return claims; three questions (does that rule fit; may users add stages; out-of-process JSON or in-process TypeScript). Reply: “1. Okay I think this is good, we can challenge it along the way though. 2. No I think users should be able to fully customise the stages and steps of the factory workflow. 3. Go with your recommendation with ts as the first-class option”.

Offered: three tiers (engine guarantees, default policy, user extensions), with "humans accept" as the open point. Reply: “I think humans accept should be configurable, otherwise the principles are all good - you even caught a good principle that we need "observability" such that extension can actually see whats going on, and react.”

Offered: keep "the factory never merges" as a guarantee. Reply: “I think the factory never merges should not be a guarantee, perhaps the controller never does - but why not a user extension? Our 'sane' default will be that it doesn't - but I can see a case for a bug that say something like sentry finds on your application, you might want that to auto merge and be deployed if its small right? Thats not my risk appetite but we shouldn't enforce that”.

Effect (D-023):
- The core: the event log (`src/store.ts`); an engine that applies events to a cycle under a workflow definition (today mixed with the default workflow in `src/lifecycle.ts`); the controller, the only writer (`src/controller.ts`); run supervision with deadlines, cancel and recovery; candidate and evidence binding to a Git SHA; an observation stream that observers read and react to through claims or commands; an extension host with the seam contracts, loader, contract test kits and version records.
- Engine guarantees, which no workflow can switch off: only the controller changes state, and every change is a recorded event; evidence and verdicts bind to a SHA, and a new commit makes old evidence invalid; anything the controller cannot classify escalates; every agent loop has a finite budget; extensions return claims and never write state; every run records the versions of the workflow, prompts and extensions it used; the controller itself never merges or deploys. (A-125: in practice, a merge happens only through a grant the owner gave in personal or job configuration; an observer `accept` followed by a merge grant stage is an owner-configured automatic merge.)
- Default policy, which a workflow may change: today's stages and order, two standard reviews and one adversarial review, controller-run checks, fresh-context reviewers, human acceptance, and no merge step.
- User extensions: stages and steps built from step kinds (agent run, controller command, human decision, extension step), roles, prompts, adapters, observers, and merge or deploy steps.
- Extensions run as separate processes over JSON on stdin and stdout, inside the sandbox; TypeScript is the first-class option.
- The spec's principle 5 and D-004 stay true of the default workflow only. The spec is rewritten when the engine is built.
- Open parts and the proposed plan order are in [open-questions.md](open-questions.md), O-016. Plan rows are not changed until the owner approves an order.

### A-049 — 2026-10-18 — Open questions move to their own file

Owner, during the guide walkthrough, after asking for somewhere to flag questions for later research and finding it odd to keep them in a file titled decisions: “yes that makes sense, lets split the file and reference it from decisions as well just in case something is expecting them to still be there.”

Effect: [open-questions.md](open-questions.md) holds every open question, O-001 to O-014, with the research behind the new ones (O-005 widened; O-011 review budget exhaustion; O-012 the Design Studio; O-013 role prompts and skills; O-014 a survey of skills libraries, harnesses and other factories). The `## Open` section here points to it. A decided question is recorded here with the owner's quoted reply and its row leaves that file. `AGENTS.md` lists the file under "Read first".

### A-043 — 2026-10-17 — Lift the scratch-repositories-only limit

*Still holds: any repository. The network and credential gaps now depend on each agent's declared sandbox (network off by default); A-146 records the planner token risk.*

Owner, after step 8 put developer, check and reviewer runs in bubblewrap, offered three answers on the working limit that the A-029 merge introduced (factory runs on scratch repositories only): lift it for repositories without secrets (recommended), keep it, or lift it fully. Told the two open gaps: every run has full network access, and a run can read its own CLI's config directory, credentials included, so a hostile or confused agent could send out the repository and the login. Reply: “lift it fully.”

Effect: the factory may run on any repository, including one that holds secrets. The two gaps stay open and are accepted for now. The network line in [work/parked.md](work/parked.md) is no longer tied to the first repository holding secrets; it waits for a later ticket. The parked lines that cite the limit are marked lifted.

### A-042 — 2026-10-17 — Weigh adversarial findings by risk; record accepted risks

Owner, asked whether to record the rule offered after the 08-e adversarial FAIL (park findings that need deliberately hostile code and do no damage by default): “No rule, we definitely want to consider malicious code - but I don't think we need to make something airtight and waste development time. So you should weigh up the risk when these recommendations come through and potentially merge accepting them. We should probably capture them somewhere in that case though”.

Effect: no default parking rule. Malicious code stays in scope, ranked after damage and leaving the remit (A-037). When an adversarial review fails, the implementer session weighs each finding's risk and recommends one of three outcomes: a fix ticket, parking against a named ticket, or a merge with the risk accepted. The owner still decides. A risk the owner accepts goes to [work/accepted-risks.md](work/accepted-risks.md), with the reason and the event that would reopen it. Unlike a parked line, an accepted risk does not gate any ticket.

### A-037 — 2026-10-16 — Merge 08-a and 08-b with the 08-b adversarial findings parked

*The owner's threat priorities still hold (`docs/security/threat-model.md`). The merged branches and parked findings went with the deleted code.*

Owner, after the 08-b adversarial FAIL on `dc6c461` (two majors: a committed gitlink directory and a dangling symlink survive the untracked removal and reach the unsandboxed reviewer; two minors: a tracked path starting with whitespace is deleted after a clean tree check, and a deep chain plus a locked directory makes the removal throw) and the question how likely they are: “Option 2, for the most part I'm not terribly concerned about malicious code - obviously that is a worry. My primary concern is agents going outside their remit to achieve a goal which they can't otherwise do, or making a mistake - causing damage to the repo or outside (i.e. deleting data from the whole of the tmp dir instead of their own space inside it)”.

Effect: `feat/08-b-tree-permissions` (08-a and 08-b) is merged by the owner with 08-a standard PASS, 08-a adversarial FAIL fixed by 08-b, 08-b standard PASS and 08-b adversarial FAIL on record. The two majors are parked against 08-c (developer and reviewer runs in the sandbox), which closes them: inside the sandbox the owner's home is not bound. The two minors are parked against the next ticket that touches `verify.ts`. Threat model for 08-c and later, in the owner's words: the first concern is an agent going outside its remit or making a mistake that damages the repository or anything outside its own space; deliberately malicious code is a secondary concern.

### A-018 — 2026-10-15 — Merge 02-a/b/c with the 02-c adversarial finding parked

*Only the workflow addition still holds: parked findings gate the ticket named against them (`docs/work/parked.md`). The merged tickets are deleted code.*

Owner, after the 02-c adversarial FAIL on `39d2c59`: “Yep lets do 1, and make sure we are tracking the finding for when it is relevant.”

Effect: the stacked branch carrying tickets 02-a, 02-b and 02-c is merged with standard PASS and adversarial FAIL on record. The finding (a caller applying the unserialised object can diverge from replay) and the other deferred findings are tracked in [work/parked.md](work/parked.md); the first ticket that calls `EventStore.append` from non-test code must cover it. Workflow addition: parked findings gate the ticket named against them.

### A-016 — 2026-10-15 — Stop design iteration; implement the core

*Still holds: stop design iteration; edge-case semantics only when a test or incident needs them (D-016). The core lifecycle v1 baseline is replaced by `docs/core.md`.*

Owner, after reviewing twelve design cycles against the v0.3 plan: “I'd much rather go back to our simpler base and let it run implementation rather than just theorizing and agonizing over a plan and edge cases which don't/haven't occured”, then “Ignore my rules”, then asked to remove the accumulated design material.

Effect: cycle-13 withdrawn before review. v0.1 and v0.2 lifecycle specs, 120 scenarios, twelve review ledgers, the manual workflow and templates were removed from the tree. They remain in Git history before commit `1214ca2` for anyone who needs them. Directions D-008 to D-015 from those cycles (paused-failure handling, held results, child recovery of interrupted development, receipt ordering) are superseded by D-016's single rule.

### A-001 — 2026-10-15 — Bootstrap direction

*Still holds. Claude Code is built (`extensions/claude-code/`); Pi is not yet.*

Owner: “I'm happy with the approach, the tech stack and I think we should target Pi and Claude Code. It should run locally.”

Effect: TypeScript and SQLite, Pi and Claude Code first, local execution. Vendor neutrality remains a constraint.

## Retired IDs

Not in force. The full entries are at commit `c3f91f9`.

| ID | Date | Title | Why retired / replaced by |
| --- | --- | --- | --- |
| A-142 | 2026-10-21 | 11-d: standard 3's test findings fixed on the branch; on to the adversarial review | Fix record for deleted pre-refactor code (11-d) |
| A-141 | 2026-10-21 | 11-d: standard 2's FAIL fixed on the branch, then a third standard review, then the adversarial | Fix record for deleted pre-refactor code (11-d) |
| A-140 | 2026-10-21 | 11-d: two existing test pins change; no command ID is minted | Test-pin record for deleted pre-refactor code (11-d) |
| A-139 | 2026-10-21 | 11-d's design approved with the session's recommendations; 11-d and 11-d2 READY at Trust tier | Design of deleted owner moves; the core has no continuation command (O-011) |
| A-138 | 2026-10-21 | The parked 10-b `decisionConfig` row moves to 11-f | Parked row for deleted `decisionConfig` |
| A-137 | 2026-10-21 | 11-c: the adversarial minors tested on the branch; the race test's wording; a diverged-cycle note for 11-f; an unbounded test to Housekeeping | Fix record for deleted replay code (11-c) |
| A-136 | 2026-10-21 | 11-c's design approved with the session's recommendations; READY at Trust tier | Design of deleted recorded-workflow replay; the core event log replaces it |
| A-135 | 2026-10-21 | 11-b2: the adversarial minors fixed on the branch; pins accepted; moved repository to Housekeeping | Fix record for deleted shared clones (11-b2) |
| A-134 | 2026-10-21 | 11-b2: the mirror bind travels on the run request | Design of deleted mirror bind |
| A-133 | 2026-10-21 | 11-b split from 11-b2; one mirror per repository; 11-b READY at Light tier | Design of deleted layout and mirrors |
| A-132 | 2026-10-21 | 11-a2: the adversarial minor fixed on the branch; the race parked against 11-d | Fix record for deleted driver code (11-a2) |
| A-131 | 2026-10-21 | 11-a2's design approved; READY at Trust tier | Design of deleted `decideAndDrive`; `Controller.decide` replaces it |
| A-130 | 2026-10-21 | 11-a's review minor accepted: cancel prints after every cancel is recorded | Accepted risk on the deleted CLI cancel output |
| A-129 | 2026-10-21 | 11-a is READY at Light tier; `accept` drives on, in a ticket after 11-a; row 11's gaps placed | Design of deleted driver entry point |
| A-128 | 2026-10-21 | The factory is named Medrengard; a private remote | Done: repository named and remote created; old path renames moot; checkout rename in A-147 |
| A-127 | 2026-10-21 | Smaller items: ticket provenance, per-repository sections, secret references, workflow tooling; codex and ACP parked | Rows of the deleted plan; Codex and ACP stay unscheduled |
| A-126 | 2026-10-21 | Workspaces: shared clones against a base-only mirror; overlay checkouts with pools | Design of deleted mirrors and workspaces |
| A-123 | 2026-10-21 | Engine correctness: owner events bound to a SHA and deduplicated; replay divergence detected; linear replay; checker gaps | Design for the deleted engine; replaced by the core event log |
| A-121 | 2026-10-21 | Sandbox hardening without friction; subordinate UID parked | Row of the deleted plan for the deleted sandbox; limits stay open (O-007) |
| A-120 | 2026-10-21 | Strict configuration: one schema, provenance, canonical workflow hash, runtime entries as data | Layered configuration deleted; definitions are owner TypeScript (`docs/core.md`) |
| A-119 | 2026-10-21 | Repository trust: capabilities without friction by default; friction opt-in per repository | Repository-supplied definitions out of scope (`docs/core.md`); data-only rule kept via A-111 |
| A-118 | 2026-10-21 | Defaults set before the sandbox: developer runs the checks; the adversarial reviewer may run commands | Defaults for deleted runtime integrations |
| A-117 | 2026-10-21 | Named outcomes and declared step inputs and outputs, before A-108 and A-109; step-type registry on demand | Named outcomes now exist as workflow edges in `src/primitives.ts`; step-type registry moot |
| A-116 | 2026-10-21 | Stream, keep and parse run output; progress lines; claims through the CLI's schema | Run-output design for deleted runtime integrations |
| A-112 | 2026-10-20 | Two live-run gaps placed; row 11 starts with one driver entry point | Research gaps placed on rows of the deleted plan |
| A-110 | 2026-10-20 | Reviewer wording kept as input to O-013; no prompt change now | Input to O-013, which stays open |
| A-109 | 2026-10-20 | Structured findings, and the owner may overrule a finding inside the cycle | Unbuilt design for the deleted lifecycle; structured findings unscheduled |
| A-108 | 2026-10-20 | A commit stage can act on a red check; the default workflow still escalates | Unbuilt primitive for the deleted engine; the default still escalates on a red check |
| A-107 | 2026-10-20 | Owner-held tests (O-005): visible by default; the core keeps the primitives for a hidden holdout | O-005 stays open; the primitives named were deleted code |
| A-106 | 2026-10-20 | Networked sandboxes get their own network namespace through pasta | Pasta ticket for the deleted sandbox; A-146 schedules named network destinations instead |
| A-105 | 2026-10-20 | Row 11 (recovery): always escalate a crashed run; resume refuses a changed job | No automatic retry restated by `docs/core.md`; job hash went with job JSON |
| A-104 | 2026-10-20 | sweep-lifecycle-constants: merged after the owner's walkthrough | Merge record for deleted pre-refactor code |
| A-103 | 2026-10-20 | sweep-stage-guards: merged after the owner's walkthrough | Merge record for deleted pre-refactor code |
| A-102 | 2026-10-20 | sweep-lazy-runtimes: merged after the owner's walkthrough | Merge record for deleted pre-refactor code |
| A-101 | 2026-10-20 | sweep-terminal-escapes: merged; the prototypes stay as they are | Merge record for deleted code; `proto/` cut |
| A-100 | 2026-10-20 | sweep-reviewer-instructions: merged; reverses 06-b's "read from the candidate commit" | Merge record for deleted reviewer prompt code |
| A-098 | 2026-10-20 | sweep-cancel-aborts: merged after the owner's walkthrough | Merge record for deleted pre-refactor code |
| A-097 | 2026-10-20 | sweep-open-race: merged after the owner's walkthrough | Merge record for deleted pre-refactor code |
| A-096 | 2026-10-20 | sweep-preflight: merged after the owner's walkthrough | Merge record for deleted preflight code |
| A-095 | 2026-10-20 | sweep-head-workflow: merged after the owner's walkthrough | Merge record for deleted repository-workflow import |
| A-094 | 2026-10-20 | learn-refresh: merged after the owner's walkthrough | Merge record; `learn/` cut (`docs/core.md`) |
| A-093 | 2026-10-20 | learn-refresh is READY; build all five batches without stopping | Ticket record; `learn/` cut |
| A-092 | 2026-10-20 | The guide gets a ticket; the owner walks through it instead of reviews | Ticket record; `learn/` cut |
| A-091 | 2026-10-20 | Next: fix and expand the guide | Plan record; `learn/` cut |
| A-090 | 2026-10-20 | 10-d: fix the review findings, then merge | Fix record for deleted observation stream (10-d) |
| A-089 | 2026-10-20 | 10-d: run the reviews | Review record for deleted code (10-d) |
| A-088 | 2026-10-20 | 10-d READY; observation stream design approved | Design of deleted observation stream; `docs/core.md` observation replaces it |
| A-087 | 2026-10-20 | Live run findings recorded in the plan; merge | Findings recorded in the deleted plan |
| A-086 | 2026-10-20 | 10-e: fix the adversarial findings, then merge | Fix record for deleted grants (10-e) |
| A-085 | 2026-10-20 | 10-e: fix the standard 2 findings, then the adversarial review | Fix record for deleted grants (10-e) |
| A-084 | 2026-10-20 | 10-e: owner-run tests waived; run the reviews | Waiver record for deleted code (10-e) |
| A-083 | 2026-10-20 | 10-e READY; grants design approved | Design of deleted grants (O-017) |
| A-082 | 2026-10-20 | 10-c: fix the adversarial findings and the standard 2 minors, then merge without another review | Fix record for deleted command stages (10-c) |
| A-081 | 2026-10-20 | 10-c READY; command stages design approved | Design of deleted command stages; `command` stage kind replaces it |
| A-080 | 2026-10-20 | 10-b: fix the adversarial findings, then merge | Fix record for deleted configuration layers (10-b) |
| A-079 | 2026-10-19 | 10-b: standard 2 findings fixed without another standard review, then adversarial | Fix record for deleted configuration layers (10-b) |
| A-078 | 2026-10-19 | 10-b READY; configuration layers design approved | Design of deleted configuration layers |
| A-077 | 2026-10-19 | 10-f: review minors fixed unreviewed, then merged | Merge record for deleted registries (10-f) |
| A-076 | 2026-10-19 | 10-a merged; its adversarial minors become 10-f | Merge record for deleted registries (10-a) |
| A-075 | 2026-10-19 | 10-a READY; registries design approved | Design of deleted registries |
| A-074 | 2026-10-19 | Row 10 design answers (O-016 items 3 to 6) | Row 10 design (D-024); replaced by `docs/core.md` extensions and observation |
| A-073 | 2026-10-19 | 07-e test and reviews waived; merge | Waiver and merge record for deleted code |
| A-072 | 2026-10-19 | 07-e design approved | Design for deleted fix-run code |
| A-071 | 2026-10-19 | 06-d test and reviews waived; merge; start 07-e | Waiver and merge record for deleted code |
| A-070 | 2026-10-19 | 06-d READY | Ticket record for deleted code |
| A-069 | 2026-10-19 | 04-f and 08-g reviews waived; merge row 9, 04-f and 08-g | Waiver and merge record for deleted code |
| A-068 | 2026-10-19 | 08-g: pi's auth.json writable for every pi run | Pi integration deleted; its accepted risk removed |
| A-067 | 2026-10-19 | 04-f and 08-g READY, stacked on 09-d | Ticket record for deleted code |
| A-066 | 2026-10-19 | 09-d READY; 08-g drafted | Ticket record for deleted spec and Pi code |
| A-065 | 2026-10-19 | 09-c plan deleted | Plan file deletion record |
| A-064 | 2026-10-19 | Three tickets from the 09-c live run, after row 9 | Tickets for deleted code |
| A-063 | 2026-10-19 | 09-c reviews and owner-run tests waived | Waiver record for deleted code |
| A-062 | 2026-10-19 | 09-c prompt split shape | Prompt split for deleted code; role text is `Agent.role` |
| A-061 | 2026-10-19 | 09-b plan deleted; no runs to keep | Plan file deletion record |
| A-060 | 2026-10-19 | 09-b reviews waived | Waiver record for deleted code |
| A-059 | 2026-10-19 | 09-b driver approach | Design of deleted generic driver |
| A-058 | 2026-10-19 | 09-a reviews waived; spec rewrite after 09-c | Waiver record; the spec it names is deleted |
| A-057 | 2026-10-19 | 09-a engine shape | Design of the deleted engine; replaced by `src/primitives.ts` |
| A-056 | 2026-10-19 | Row 9 design answers | Design of the deleted engine; replaced by `docs/core.md` |
| A-055 | 2026-10-19 | Build the workflow engine now, before recovery | Done; the engine it ordered was replaced by the refactor |
| A-053 | 2026-10-19 | Drop the parked 02-a schema cleanup | Concerned deleted `src/store.ts` |
| A-052 | 2026-10-19 | Tracker and code host sync: two seams; recovery first | Tracker and code host seams (D-022) not in the core; PR publication is the default's `pr` extension |
| A-051 | 2026-10-19 | Acceptance evidence stage: design agreed, built later | Design for the deleted lifecycle; open as O-015 |
| A-050 | 2026-10-18 | Merge the guide to main as experimental; its tests leave npm test | `learn/` cut (`docs/core.md`) |
| A-048 | 2026-10-18 | Merge the herdr TUI prototype to main as experimental | `proto/` cut (`docs/core.md`) |
| A-047 | 2026-10-18 | Sandbox the prototype's stage runs; the factory's goal is to run in herdr | `proto/` cut; interactive herdr sessions are a later slice (A-146) |
| A-046 | 2026-10-18 | Throwaway herdr TUI prototype | `proto/` cut |
| A-045 | 2026-10-17 | Fix the 07-d adversarial minors before merge | Fix record for deleted code (07-d) |
| A-044 | 2026-10-17 | Ticket 07-d: owner accept and cancel commands | Commands of deleted `src/main.ts`; `Controller.decide` and the CLI replace them |
| A-041 | 2026-10-16 | Fix ticket for the 08-e adversarial FAIL | Fix ticket for deleted code (08-e) |
| A-040 | 2026-10-16 | Fix ticket for the 08-d adversarial FAIL | Fix ticket for deleted code (08-d) |
| A-039 | 2026-10-16 | Merge 08-c with the adversarial minor parked | Merge record for deleted code (08-c) |
| A-038 | 2026-10-16 | 08-c and 08-d: developer and reviewer runs in the sandbox | Design of deleted runtime sandboxing; the sandbox is now `src/sandbox.ts` |
| A-036 | 2026-10-16 | Fix ticket for the 08-a adversarial FAIL | Fix ticket for deleted code (08-a) |
| A-035 | 2026-10-16 | Sandbox before plan row 8; five design answers | Sandbox design for deleted code; the backend rule is kept as D-019 |
| A-034 | 2026-10-16 | Fix ticket for the 07-b adversarial FAIL | Fix ticket for deleted code (07-b) |
| A-033 | 2026-10-16 | 07-a same-tree refusal on a fix run | Rule of deleted fix-run code |
| A-032 | 2026-10-16 | Step 7 tickets: fix run and end-to-end loop | Design of deleted fix run and loop; the fix stage is default policy |
| A-031 | 2026-10-16 | Fix ticket for the 06-b adversarial FAIL | Fix ticket for deleted code (06-b) |
| A-030 | 2026-10-16 | 06-b reviewer runs: signature, tools, evidence source | Reversed by A-118; code deleted |
| A-029 | 2026-10-16 | Merge 06-a with the adversarial findings parked | Merge record for deleted code (06-a) |
| A-028 | 2026-10-16 | Step 6 design: verification and reviewer runs | Design of deleted verify and review code; checks are command stages |
| A-027 | 2026-10-16 | Fix ticket for the 05-a adversarial FAIL | Fix ticket for deleted code (05-a) |
| A-026 | 2026-10-16 | 05-a developer run design | Design of deleted developer run |
| A-025 | 2026-10-16 | Fix ticket for the 04-d adversarial FAIL | Fix ticket for deleted code (04-d) |
| A-024 | 2026-10-16 | 04-d real adapters design | Deleted Claude and Pi adapters; Claude Code is now `extensions/claude-code/` |
| A-023 | 2026-10-16 | Merge 04-a/04-b/04-c with the 04-c adversarial finding parked | Merge record for deleted code (04-a to 04-c) |
| A-022 | 2026-10-16 | Fix ticket for the 04-b adversarial FAIL | Fix ticket for deleted code (04-b) |
| A-021 | 2026-10-16 | Fix ticket for the 04-a adversarial FAIL | Fix ticket for deleted code (04-a) |
| A-020 | 2026-10-16 | 04-a adapter interface design | Deleted adapter seam; replaced by the runtime adapter primitive |
| A-019 | 2026-10-15 | Merge 03-a/03-b with the 03-b adversarial findings parked | Merge record for deleted code (03-a, 03-b) |
| A-017 | 2026-10-15 | Working agreement | Agreed `workflow.md` process (D-018); replaced by the `AGENTS.md` rules |
| D-024 | 2026-10-19 | Extension shapes, grants and four configuration layers (A-074) | Replaced by `docs/core.md` extensions; configuration layers and grants deleted |
| D-022 | 2026-10-19 | Tracker and CodeHost seams (A-052) | Not in the core; PR publication is the default's `pr` extension |
| D-018 | 2026-10-15 | Fast or Design tickets per `workflow.md` (A-017) | Retired with `workflow.md`; `AGENTS.md` holds the rules |
| D-017 | 2026-10-15 | Design documents are not adversarially reviewed; 2+1 applies to code (A-016) | Review process retired with `workflow.md`; review counts are workflow policy |
| D-008 to D-015 | 2026-10-15 | Directions from the design cycles (paused failures, held results, child recovery, receipt ordering) | Superseded by D-016's single rule (A-016) |
| P-001 | 2026-10-15 | Markdown contracts and manual stage advancement (A-001) | Replaced by the controller |
