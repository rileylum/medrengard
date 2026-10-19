# 06-d — Reviewers see the candidate's commit messages

Route: Fast. One new quoted section in the review contract, built the same way as the others.

Goal: a reviewer can check a ticket requirement about commits (message, count, author) without a `.git` it does not have.

Done when:
- The review prompt has a nonce-delimited `COMMITS <base>..<head>` section listing each commit in `base..head`, oldest first, with its full SHA, author and full message. Verified by test at `review` with the fixture CLI.
- A commit message that holds a forged delimiter line is quoted content: it matches no real delimiter. Verified by test, as for instruction files (06-c).
- The section is cut like the diff when it is very long, and the cut is marked. Verified by test.
- The review contract hash changes, and the golden files in `tests/fixtures/prompts/` change only by the new section. Verified by test and by the diff of the golden files.

Constraints: zero dependencies. No paid calls. Git runs in the job's repository, as for the diff. Builds on 09-c (`src/prompt.ts`, `ReviewParts`).
Non-goals: commit signatures; the developer's transcript, which reviewers never get.
Verification: `npm test`, run by the owner.

Evidence (2026-10-19, owner-run `RUNTIME_SPIKE=1 npm test`, live `main.ts` job): the standard reviewer failed `da3bcd2` with "nothing shows the ticket's required commit message "add HELLO.md" … the checkout has no .git directory to check".

## Log
- 2026-10-19 — drafted after the 09-c live run (A-064). Not READY until the owner says go.
