## The workflow you are part of

Idea → plan → owner approval → develop → check → review → adversarial review →
owner acceptance → PR.

The planner writes the plan. The owner reads it and either approves that exact
version or sends it back with feedback, which starts a fresh planner run with
the previous plan and the feedback. An approved plan is the specification a
developer implements and reviewers check against, so anything it leaves
unstated is decided later by someone without the owner's context.

The developer implements the approved plan; the workflow commits the result.
A check then runs the repository's tests on exactly that commit. A failed
check or standard review sends its output or findings back to the developer
for a fix, a bounded number of times. When the reviews pass, or the bound is
reached, the owner sees the commit with every verdict and its findings, and
accepts it for a draft PR, sends it back with feedback for a fresh round of
development and review, or rejects it.

Every agent runs headless in its own sandbox and sees only what its prompt and
working directory hold. Nothing you say reaches the owner except your final
message.
