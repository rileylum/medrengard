# SF-001-review-02 — Bounded revision and review ledger

## Owner authorisation — 2026-10-15

The owner replied “Yes” to the explicit proposal for a new cycle addressing S2-F1–F3 and directly related scenarios, with at most **two standard reviews and one adversarial review**.

- New cycle: SF-001-review-02; parent: SF-001-review-01.
- Parent remains exhausted at standard 2/2 (FAIL, FAIL), adversarial 0/1, infrastructure failures 1. Its candidate and evidence are retained under `docs/reviews/SF-001/` and Git.
- Scope: pre-readiness refinement/initial authority, one-live-lineage and child-creation uniqueness, failed-check waiver/evidence/rerun semantics, and directly related fixtures.
- No general reset policy, final design approval, implementation, automatic merge or deployment authorised.
- Current counters: standard 0/2; adversarial 0/1; infrastructure failures 0.
- Review execution deadline: 600 seconds per invocation; infrastructure failures stop for guidance under the existing manual procedure.

## Revision dispositions

S2-F1–F3 are author-confirmed for this bounded revision; independent verification remains pending. The proposed changes do not silently become approved policy:

- S2-F1: explicit PREPARING supersession, precise nonterminal scope and proposed bounded batch authorisation for initial work (Q5); revisions still require individual authorisation.
- S2-F2: one work-lineage tip, atomic parent/child linkage, REVISED/CLOSED handoff outcomes, no second initial cycle and no duplicate children under different event IDs.
- S2-F3: FAILED evidence remains sticky against later PASS; a permitted explicit failure waiver is a narrow exception to operational-resume prohibition; external reruns cannot bypass launch registration or execution limits.

No review verdict exists yet. Freeze the revised design and run independent standard review before adversarial review and explicit owner design approval.
