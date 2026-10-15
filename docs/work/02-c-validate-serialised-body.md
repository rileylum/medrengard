# 02-c — Validate the serialised body

Route: Fast. Fix ticket for 02-b's adversarial FAIL on `582e399`. Internal, no UX, reversible.

Goal: what the store validates is byte-for-byte what it writes, so no in-memory object can pass the guard and persist a body `apply` handles differently.

Done when:
- `append` serialises the event first, validates the parsed body, and stores that body; a sparse `checks` array, an object with `toJSON`, an array carrying a `type` property, and prototype-inherited fields are all rejected before writing; verified by test.
- The guard rejects arrays as events; verified by test.

Constraints: as 02-a and 02-b. Branch is stacked on `feat/02-b-reject-unclassifiable-events`; the PR carries 02-a, 02-b and 02-c and the owner merges once.

Non-goals: the two minors from the 02-b adversarial verdict (fix-run claim reusing a consumed run ID; `open` not checking parent or one-open-cycle-per-work). Both go to the controller ticket.

Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-15 — ticket written after 02-b adversarial FAIL; owner: “Option 1 go”. Branch `feat/02-c-validate-serialised-body`.
- 2026-10-15 — `39d2c59`: owner-run `npm test` 27 pass, 5 todo, 0 fail. Standard 1 PASS (notes only). Adversarial FAIL: all done-when items met and every 02-b reproduction closed, but the goal sentence overclaims; a caller that applies the unserialised object in memory (String wrappers, getters, Proxies) still diverges from replay, because the store cannot see the caller's side. Suggested fix: `append` returns the canonical parsed Event (or applies it and returns the Cycle) and the controller uses only that. Minor: lone-surrogate run IDs collide in the unique index. Budget spent: standard 1/2, adversarial 1/1. Stopped; owner decides. Prompts and verdicts in `/var/tmp/software_factory/02-c/`.
- 2026-10-15 — owner: “Yep lets do 1, and make sure we are tracking the finding for when it is relevant.” (A-018). Merged with 02-a and 02-b. Reviews: standard 1 PASS, adversarial 1 FAIL, parked in [parked.md](parked.md) for the step 4 controller ticket.
