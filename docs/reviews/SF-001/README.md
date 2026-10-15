# SF-001 — Independent review ledger

Cycle: SF-001-review-01. Policy: existing manual bootstrap procedure (not the draft controller policy). Owner authorised local Git setup and fresh-context reviews in the project conversation (“Yes please”). No design approval or new budget is implied.

## Standard attempt 1 — FAIL

- Candidate: `f9569aa35f68d3e789152febab3489a47f34b1cb`, root commit, no parent. Full design reviewed, not an incremental diff.
- Runtime: Claude Code 2.1.300; reported model `claude-opus-5-5`.
- Fresh, single-turn context; no tools, resume, session persistence, plugins/customisations or MCP inputs. CLI: `claude --safe-mode --strict-mcp-config --tools '' --no-session-persistence --permission-mode dontAsk --model opus --output-format json -p`.
- Input: [exact review packet](standard-1-prompt.txt), containing original DOCX body/table text and commit-extracted requirements/design documents. No author reasoning transcript. Source diagrams were not included; this is a text/design review.
- Output: [unaltered runtime JSON](standard-1-result.json). Successful runtime completion with explicit FAIL and matching reviewed SHA; no permission denials or reported runtime errors. Operator generated packet directly with `git show`; reviewer correctly disclosed it could not independently inspect Git without tools.
- Review method: independent tabletop analysis, not executable testing or filesystem inspection. API-reported cost: $0.6107338. This is one bounded manual review invocation, not proof of a production adapter.
- Counter after verdict: standard **1/2**, adversarial **0/1**. Infrastructure events: none.

## Findings and bounded correction

All findings were confirmed by the author against the draft. Disposition is author-confirmed pending independent re-review; fixes below are not a PASS claim.

| Finding | Severity | Defect | Correction prepared |
| --- | --- | --- | --- |
| S1-F1 | High | No state for newly created non-ready cycles; overloaded READY | Explicit owner-created PREPARING, readiness promotion to QUEUED, initial-cycle and child-cycle creation rules |
| S1-F2 | Medium | Missing control/escalation/reservation transitions and manual retry bounds | Actor/guard/evidence table; RESERVED/CONSUMED/CLOSED_UNUSED lifecycle; no same-cycle extra manual execution allowance; containment acknowledgement rules |
| S1-F3 | High | Accepted terminal cycle cannot express revision/merge drift | Separate PENDING/INVALIDATED/MERGED handoff; immutable accepted parent with child cycle; owner-only/manual merge proposal and target-guard requirement |
| S1-F4 | Medium | Base semantics and pre-PASS drift undefined | Base explicitly pinned target tip, separate merge-base; every-stage drift rule, no rebase within fix, stale FAIL precedence and scenarios |
| S1-F5 | Medium | Non-SHA version/authority invalidation missing | Pin context; new version publication alone does not adopt it; revocation/adoption/waiver expiry invalidates; counters preserved |
| S1-F6 | Medium | Evidence phases and scenario outcomes ambiguous | Explicit pre-review/review/acceptance phases; human UAT attachment and failure rules; sharpened scenarios and new SC-36–44 |
| S1-F7 | Low | Git absence stated as current after commit | Date historical absence; record initialisation and candidate in current handoff |

## Standard attempt 2 — execution timed out; no quality verdict

- Frozen corrected candidate: `117d763c9b1d57a1ecb6278a1d88a8480c3bfa83`; base `f9569aa35f68d3e789152febab3489a47f34b1cb`.
- [Exact input](standard-2-prompt.txt), [empty/incomplete output](standard-2-result.json), [infrastructure event and requested decision](standard-2-infrastructure.md).
- Harness timeout after 240 seconds; no matching invocation remained in subsequent process inspection. No retry or adversarial run started.
- Completed counters remain standard **1/2**, adversarial **0/1**. Infrastructure failures: **1**. Standard logical attempt 2 is reserved/pending, not completed.
- Author checks before freezing the correction: local Markdown link targets, 44 unique ordered scenario IDs, valid first-review JSON/FAIL, and `git diff --check` all passed. These are not independent semantic verification.

## Standard attempt 2 — authorised replacement completed: FAIL

- Owner authorised the one replacement execution at a 600-second deadline: [authorisation](standard-2-retry-authorisation.md).
- Same candidate/base and unchanged packet as the interrupted execution; candidate spec/scenarios/SF-002 outline and packet checked against Git before launch.
- [Raw result](standard-2-run-2-result.json): valid completed verdict **FAIL** for `117d763c9b1d57a1ecb6278a1d88a8480c3bfa83`; reported model `claude-opus-5-5`, duration 256.071 seconds, API cost $0.9731816, no runtime error or permission denials.
- Reviewer resolved S1-F1–F7 as originally raised but reported S2-F1–F3: PREPARING refinement/initial authority, one-live-cycle uniqueness, and failed-check waiver/rerun semantics. New findings remain uncertain pending owner triage; no further corrections applied.
- Completed counters: **standard 2/2 (FAIL, FAIL); adversarial 0/1**. Infrastructure failures remain **1**; the successful replacement is not a third quality attempt.
- **STOPPED / ESCALATED.** No adversarial review or design fix performed after this verdict. See [escalation packet and proposed next-cycle scope](escalation.md).

A new correction/review cycle requires explicit owner scope and budget authorisation. Do not reset this cycle's counters or treat the retry authorisation as approval of another cycle.
