# 09-c — Prompt split and version records

Route: Fast. The split was approved in A-056, and there is one obvious way to record a hash.

Goal: each agent prompt is the core's contract plus the workflow's role text, and every run records which versions it used.

Done when:
- The contract part (the claim or verdict format, the SHAs, the nonce delimiters, the rules the controller parses) is built by the core, and an agent stage in the workflow supplies only its role text. Today's wording is the default role text. Verified by test: the default prompts for developer, fix, standard and adversarial runs are unchanged byte for byte, apart from the nonce.
- A workflow's role text cannot remove or reorder the contract part. Verified by a test whose role text contains a fake delimiter and a second `Rules:` section.
- Every agent run's outcome event records the hash of its contract part and of its role text. Verified by test. Old stores without these fields still load.

Constraints: zero dependencies. No paid calls. Stacked on 09-b. Touches `developer.ts`, so the parked 08-f deadline minor must already be closed by 09-b.
Non-goals: new role prompts or skills (O-013, O-014); a run-start event, which recovery needs (row 11).
Verification: `npm test`, run by the owner on the reviewed SHA.

## Log
- 2026-10-19 — drafted on `feat/docs-core-principles` (A-056). Owner, asked to read the three tickets and say go: “merge, I'm happy. We'll then start work on a fresh context”. Read as go for 09-a to 09-c; READY.
- 2026-10-19 — the cycle-record line moved to 09-b (A-059).
