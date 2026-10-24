# M2 — First user journey definition

Status: journey agreed; implementation ticket and design still to be prepared.
Documentation branch: `docs/first-user-journey`, based on merged main `ce7c8a0`.
Canonical scope: [roadmap](../roadmap.md#first-user-journey--agreed-2026-10-24).
Decision: [A-145](../decisions.md#a-145--2026-10-24--first-user-journey-with-human-approval-and-feedback).

## Log

### 2026-10-24 — Journey and human feedback loops agreed

Owner: “Okay yeah thats pretty much my idea, idea -> plan/spec -> implement ->
review -> PR.” Then: “And yes you're right we need to have the feedback loop -
at this stage with the human in the loop to approve. Lets lock that in,
document it where it makes sense including the handoff so the next session
knows what to do.”

Recorded the journey in the roadmap: plan/spec refinement and approval,
automatic development/check/review stages, bounded reviewer/fix feedback,
owner-requested result revision and approval before PR publication, durable
feedback and an inspectable interruption/escalation path. Recorded A-145 and
updated STATUS and the local handoff. No implementation was requested or made.

Confirmed main already contains the core refactor and reviewed observer fix
through merge `ce7c8a0`. The earlier pending-merge handoff is superseded.
Current code validation remains the independent 57/57 gate plus 12 observer
probes recorded in ticket 12. This session checks Markdown links and
`git diff --check`; no application tests are rerun for documentation only.

Next: use a concrete small change to define entry input and the plan/spec
approval experience. Map the stages and feedback onto the current public API,
then prepare the first bounded implementation ticket. Do not assume the current
default workflow already implements spec revision, durable feedback transport,
provider access, escalation continuation or real publication. Read the roadmap's
unresolved decisions at the relevant boundary. Implementation begins only under
a subsequent implementation instruction; paid scenarios follow `live-runs.md`.
