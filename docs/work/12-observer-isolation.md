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
