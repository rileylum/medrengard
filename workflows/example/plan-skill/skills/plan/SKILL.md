---
name: plan
description: Structure for a change plan. Use when writing or revising a plan for the owner.
---

Write the plan with these sections, in this order:

1. **Goal** — the change in one or two sentences, in the owner's terms.
2. **Current behaviour** — what the code does today, with `path:line` references.
3. **Change** — what to change and where, file by file. Small enough for one
   reviewable commit; if it is not, say how to split it.
4. **Out of scope** — what the idea might suggest but this change leaves alone.
5. **Open questions** — each ambiguity, with the options and your
   recommendation. Write "None" if there are none.
6. **Verification** — how a developer and a reviewer will know it works: tests
   to add or run, and what to check by hand.

Keep it short. Do not include code beyond a few lines that pin down an interface.
