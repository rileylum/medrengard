# Agent session instructions

## Read first

- `docs/STATUS.md`: what is in progress and the next action.
- `docs/workflow.md`: how plan items become tickets, branches, reviews and merges. Follow it.
- `docs/specs/core-lifecycle-v1.md`: the lifecycle being implemented. Two pages. This is the spec.
- The ticket you are working on, under `docs/work/`.
- `docs/decisions.md`: what the owner has decided. Latest entry wins.
- `docs/open-questions.md`: what is still undecided. Check it before proposing a design.
- `docs/live-runs.md`: before any run with real runtimes (a live run): plan, seed, record.

## Rules

- Controller decides state; agents return claims. Evidence binds to a commit SHA.
- Review by tier (`docs/workflow.md`, A-125): seams that hold trust get two standard reviews and one adversarial; refactors, docs and the guide get one. Fail at the limit: stop and ask the owner.
- Anything you cannot classify: stop and ask the owner. Do not invent a recovery path.
- Build capabilities and extension points in the core; ship a sane default; leave policy to workflows and extensions (A-113). A ticket that adds policy names the extension point that holds it. Build an extension point when a workflow or extension the owner runs needs it; until then, plain code (A-124).
- Reviewers get the ticket, diff, SHA and test output. Never the implementer's transcript.
- No automatic merge or deployment.
- Owner approval is a quoted reply recorded in `docs/decisions.md`. Never invent one.
- Zero dependencies until a test needs one. Node 24 built-ins: `node --test`, `node:sqlite`, native TypeScript.
- Write the test first. A spec sentence without a test is a proposal.
- One ticket per branch, `feat/NN-slug`. Work never lands on main except through a PR the owner merges.

## Commands

```
npm test        # node --test 'tests/**/*.test.ts'
```

## End of session

Append to the ticket log and update `docs/STATUS.md`: what changed, which tests ran and their result, the next action.
