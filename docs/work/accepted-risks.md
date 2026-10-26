# Accepted risks

Owner-accepted findings that still apply to the primitives implementation.
Historical approvals remain in [decisions.md](../decisions.md); deleted code
and its retired findings remain in Git history. New findings belong in
[parked.md](parked.md), not here without an owner's quoted, dated decision.

| Source | Surviving risk | Original reason and reopen condition |
| --- | --- | --- |
| sweep-git-hardening, A-099 | Checks and reviewers see stored commit bytes. Snapshot materialization applies no attributes, `eol`, `ident`, filters or LFS conversions. | Candidate attributes must not choose a program to execute outside the sandbox. Reopen when a repository requires transformed content for checks. |
| 11-d adversarial, A-143 | Owner decisions have no command IDs. A repeated `decide(id, outcome, sha)` can pass a later human stage on the same SHA if that stage has an edge for the same outcome. | The owner accepted this limitation for hand-run decisions. Ticket 14's default has two human stages that can see one SHA, `deviation` and `owner`; they share no forward outcome (`proceed` against `accept`), so a repeated decision meant for one is refused at the other, and a repeated `changes` only starts another round. Reopen when two such stages share a forward outcome, or before an automated owner-command transport. |
| Ticket 13, A-146, A-148 | Agents hold a Claude Code subscription token with unrestricted network and read repository text; ticket 14's developer also has `Bash`. A prompt injection could send the token anywhere. | Accepted for phase 1 (A-146), then within the owner's appetite: hostile input is not a design driver on personal repositories (A-148). A following ticket replaces the on/off `network` setting with named destinations; reopen before any agent reads text from people other than the owner, such as public issues. |

The Pi credential-write, repository-config import, old networked sandbox and
CLI cancel-output entries were about deleted integrations. A networked sandbox
returned under A-146 with the risk above; restoring the others needs their
risks revisited.
