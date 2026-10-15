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
