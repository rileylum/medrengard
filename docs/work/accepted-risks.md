# Accepted risks

Owner-accepted findings that still apply to the primitives implementation.
Historical approvals remain in [decisions.md](../decisions.md); deleted code
and its retired findings remain in Git history. New findings belong in
[parked.md](parked.md), not here without an owner's quoted, dated decision.

| Source | Surviving risk | Original reason and reopen condition |
| --- | --- | --- |
| sweep-git-hardening, A-099 | Checks and reviewers see stored commit bytes. Snapshot materialization applies no attributes, `eol`, `ident`, filters or LFS conversions. | Candidate attributes must not choose a program to execute outside the sandbox. Reopen when a repository requires transformed content for checks. |
| 11-d adversarial, A-143 | Owner decisions have no command IDs. A repeated `decide(id, 'accept', sha)` can accept a later human stage on the same SHA in an owner-defined workflow. | The owner accepted this limitation for hand-run decisions. Reopen when a workflow has two human stages on one SHA or a repeated accept reaches an unintended stage. The new API has no deduplicating command-ID option; that broader limitation is parked separately. |
| Ticket 13, A-146 | The phase-1 planner holds a Claude Code subscription token, has unrestricted network access and reads repository text, so a prompt injection could send the token anywhere. | Accepted for phase 1 by the owner. A following ticket replaces the on/off `network` setting with named destinations; reopen before any agent reads untrusted input such as public issues.

The Pi credential-write, repository-config import, networked sandbox and CLI
cancel-output entries were about deleted integrations. Their removal is not
approval to restore those capabilities without revisiting their risks.
