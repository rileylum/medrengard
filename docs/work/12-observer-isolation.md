# 12 — Keep observer return values inside the observation guard

Milestone: M1 in `docs/roadmap.md`. Branch: `feat/12-observer-isolation`.

## Behavior

An observer's returned thenable is part of observation. Its `then` getter,
callback and nested thenables must not acquire controller mutation authority.
A rejected observer result must not veto an event or interrupt delivery to
other observers. Notifications retain committed event order, and the owner
can still change state after observation returns.

## Acceptance and review

- Public-entry-point regressions exercise returned thenable getters, callbacks
  and nested thenables; each attempts to create work from observation.
- Each regression fails before the fix and passes after it. Only owner-created
  work is recorded, mutation attempts are refused, and a second observer sees
  the expected event positions in order.
- Run `npm test` with working bubblewrap namespaces, preserving confinement
  tests. Review the context lifetime and exception/rejection handling against
  the original adversarial reproduction; record the review's scope honestly.
- Preserve the completed refactor's failed review as historical evidence.
  Reconcile the current finding and status without claiming core v1 or
  restoring capabilities outside this fix.

## Log

### 2026-10-24 — Authorized and started

Owner: “Okay please close the defect. I think you're spot on with the approach
after that - we can probably build the whole rest of the product with the
simple loop: define a user journey/agentic workflow, try and build it, see
where there is a lack of support from the primitives and decide if its worth
building.”

Started from `docs/factory-roadmap` at `e4e6c0b` in an isolated local worktree.
The callback runs inside the observation context, but its return value is
currently passed to `Promise.resolve` after leaving that context. No changes
to recovery guarantees, paid-run permissions or merge permissions are implied.

### 2026-10-24 — Fixed and verified

Moved promise assimilation and rejection handling inside the observation
context. This guards both synchronous property access and the asynchronous
jobs created while resolving returned thenables, without changing the public
API or awaiting observers during event delivery.

Validation:

- All three public-API regressions failed on the original implementation:
  the attempted work creation succeeded instead of recording a refusal.
- All three passed after the fix, including a rejected getter/callback result
  that must not interrupt delivery to the next observer.
- `systemd-run --user --scope --quiet npm test`: **57/57 pass**, zero failures,
  cancellations, skips or todos (18.1 s). Real confinement checks remain intact.
  The initial ordinary tool-sandbox test invocation could not run; the user
  scope supplied the required namespace access.
- Implementer review: PASS for this change. Checked callback invocation,
  getter access, deferred and nested thenable resolution, rejection handling,
  restoration of owner context and event delivery order. Regression assertions
  run outside observers so the controller cannot swallow assertion failures.
  This is an implementer review, not a new independent adversarial verdict;
  the historical refactor FAIL remains recorded verbatim.

Removed the resolved finding from `parked.md`; recorded the agreed development
loop in the roadmap and current result in STATUS. This closes the reported
observer defect, not core v1. The next work is M2's concrete provider-to-PR
journey, with recovery guarantees and provider access decided at its design
boundary. The branch is local; the owner merges. No paid runs or external
publication occurred.

### 2026-10-24 — Independent review PASS

Owner: “Can you spawn that review, or give me a prompt to send to anotehr agent”.

A fresh reviewer, given repository context without the implementer's conversation,
reviewed `bbd92de32fac8588b7f255f83ff473dde1f3dc8e` against parent
`e4e6c0b84c6c563947c9c294cf1d9aaca83a4656`. Verdict: **PASS**, no actionable
findings in the observer fix or its reviewed controller interactions.

The reviewer confirmed callback execution, promise assimilation and rejection
handling stay inside the observation context. Returned getters execute under
the guard; promise jobs and asynchronous callbacks created there inherit it.
Throws and rejected results cannot interrupt later observers, and returning
from observation restores owner authority. Notification delivery retains commit
order; asynchronous observer completion is neither ordered nor awaited.

Independent validation on Node v24.13.0 with working bubblewrap:

- `systemd-run --user --scope --quiet npm test`: **57/57 pass**, zero failures,
  cancellations, skips or todos (18.33 s).
- Copied only the new regression file into a clean archive of the parent and
  ran it: **3/3 fail** because mutation refusals were absent, not because of
  sandbox setup. Assertions execute outside swallowed observer errors.
- Ran the original adversarial reproduction against both revisions, adjusting
  its import and diagnostic output to report absent forged work without throwing.
  Parent: forged work exists, positions `[2, 1]`. Target: no forged work,
  positions `[1]`.
- **12 additional public-API probes pass**, covering timer-deferred callbacks,
  nested resolution across timers, native promises, observers after `await`,
  primitive/null throws and rejections, later execution, noncallable `then`
  values, callable thenables and interaction during automatic stages.
- Interaction probes refuse `open`, `decide`, `advance`, subscription changes,
  `close` and recovery of pending work from observation. They preserve reads,
  notification order, stage budget and subsequent owner advancement/decision.
- `git diff --check e4e6c0b bbd92de` passed; the target checkout remained clean
  at the reviewed SHA throughout review.

Temporary probes and evidence are in
`/tmp/medrengard-observer-review-q5n59fkn/`. Rerun the probes with:

```sh
systemd-run --user --scope --quiet env \
  REVIEW_ENTRY=/tmp/medrengard-m1-observer/src/index.ts \
  node --test /tmp/medrengard-observer-review-q5n59fkn/probes.test.mts
```

This closes the reported finding within the trusted-owner-TypeScript boundary.
It does not establish core v1, re-review every removed capability, or claim
isolation from hostile host code, direct database writes or explicit async-context
manipulation. The original refactor FAIL is retained as history. Only review
records changed after the reviewed implementation commit; no new application
test run was needed for those documentation changes. Next: owner acceptance of
the refactor's overall scope and limitations, then owner merge of the local
branch. No paid run, push or merge occurred.
