# SF-001-review-02 — Bounded revision and review ledger

## Owner authorisation — 2026-10-15

The owner replied “Yes” to the explicit proposal for a new cycle addressing S2-F1–F3 and directly related scenarios, with at most **two standard reviews and one adversarial review**.

- New cycle: SF-001-review-02; parent: SF-001-review-01.
- Parent remains exhausted at standard 2/2 (FAIL, FAIL), adversarial 0/1, infrastructure failures 1. Its candidate and evidence are retained under `docs/reviews/SF-001/` and Git.
- Scope: pre-readiness refinement/initial authority, one-live-lineage and child-creation uniqueness, failed-check waiver/evidence/rerun semantics, and directly related fixtures.
- No general reset policy, final design approval, implementation, automatic merge or deployment authorised.
- Current counters: standard 2/2 (FAIL, FAIL); adversarial 0/1; infrastructure failures 0. Cycle exhausted; ESCALATED.
- Review execution deadline: 600 seconds per invocation; infrastructure failures stop for guidance under the existing manual procedure.

## Revision dispositions

S2-F1–F3 are author-confirmed for this bounded revision; independent verification remains pending. The proposed changes do not silently become approved policy:

- S2-F1: explicit PREPARING supersession, precise nonterminal scope and proposed bounded batch authorisation for initial work (Q5); revisions still require individual authorisation.
- S2-F2: one work-lineage tip, atomic parent/child linkage, REVISED/CLOSED handoff outcomes, no second initial cycle and no duplicate children under different event IDs.
- S2-F3: FAILED evidence remains sticky against later PASS; a permitted explicit failure waiver is a narrow exception to operational-resume prohibition; external reruns cannot bypass launch registration or execution limits.

## Standard review 1 — FAIL; bounded correction prepared

- Candidate `f4bd520298208715808d5f6709b49ce29c898951`, comparison base `117d763c9b1d57a1ecb6278a1d88a8480c3bfa83`.
- [Exact packet](standard-1-prompt.txt) extracted from Git plus original DOCX text and prior independent findings; no author reasoning transcript. [Raw result](standard-1-result.json).
- Fresh tool-disabled Claude Code invocation (`--safe-mode --strict-mcp-config --tools '' --no-session-persistence --permission-mode dontAsk --model opus --output-format json -p`), 600-second deadline. Reported model `claude-opus-5-5`, duration 131.712 seconds, API cost $0.6813376. Valid matching-SHA FAIL; no runtime error or permission denials. Text/tabletop review only.
- S2-F1–F3 resolved as originally raised. C2S1-F1 (batch expiry) and C2S1-F2 (never-launched check) author-confirmed as residual ambiguities within A-002 scope.
- Bounded correction: grant expiry limits creation only, with explicit derived cycle authority/revocation rules; pre-launch check blockers explicitly escalate and may resolve to launch the unused initial execution without Q3 consumption. SC-56–58 added and SC-30 clarified.
- Author structural checks before `f4bd520`: Markdown links, 55 unique scenario IDs and `git diff --check` passed; no executable controller tests.

## Standard review 2 — FAIL; cycle exhausted

- Corrected candidate `a273fc77c75309b0d0396eaeea7ecf76a8864c47`; base `f4bd520298208715808d5f6709b49ce29c898951`.
- [Exact packet](standard-2-prompt.txt) and [raw result](standard-2-result.json), same fresh tool-disabled command, 600-second deadline.
- Valid matching-SHA FAIL, reported `claude-opus-5-5`, duration 130.762 seconds, cost $0.7595376; no runtime errors/permission denials. Tabletop review only.
- C2S1-F1 resolved and C2S1-F2 resolved for a single check. Remaining C2S2-F1: multi-blocker resolution and sibling verification execution behaviour. Disposition uncertain pending owner triage. No further fixes applied.
- Before freezing `a273fc7`, author checked local Markdown links, 58 unique scenario IDs, valid first-review FAIL JSON and `git diff --check`; all passed. These do not establish semantic correctness.
- Stop at **2/2 standard, 0/1 adversarial**. No adversarial review run. See [focused escalation and proposed next scope](escalation.md). No new cycle/budget is authorised yet.
