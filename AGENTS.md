# Agent session instructions

## Read first

- `docs/STATUS.md`: what is in progress and the next action.
- `docs/specs/core-lifecycle-v1.md`: the lifecycle being implemented. Two pages. This is the spec.
- `docs/decisions.md`: what the owner has decided. Latest entry wins.

Do not read `docs/specs/delivery-lifecycle-v0.*` or `docs/reviews/` unless a test or incident sends you there. They are deferred reference and audit history.

## Rules

- Controller decides state; agents return claims. Evidence binds to a commit SHA.
- Two standard reviews and one adversarial review per cycle. Fail at the limit: stop and ask the owner.
- Anything you cannot classify: stop and ask the owner. Do not invent a recovery path.
- Reviewers get the contract, diff, SHA and test output. Never the developer transcript.
- No automatic merge or deployment.
- Owner approval is a quoted reply recorded in `docs/decisions.md`. Never invent one.
- Zero dependencies until a test needs one. Node 24 built-ins: `node --test`, `node:sqlite`, native TypeScript.
- Write the test first. A spec sentence without a test is a proposal.

## Commands

```
npm test        # node --test 'tests/**/*.test.ts'
```

## End of session

Update `docs/STATUS.md`: what changed, which tests ran and their result, the next action.
