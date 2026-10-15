# SF-001 — Specification acceptance package

**Status: AWAITING OWNER ACCEPTANCE. No approval inferred.**

## Exact candidate and scope

- Reviewed candidate: **`a02c9b010c8888683b43cc2773cc03cde454023b`**.
- Comparison base: `edaa2cbe661c9d616d92733a2287d86e5107ba7d`.
- Specification: [delivery lifecycle v0.1](../../specs/delivery-lifecycle-v0.1.md), with [SC-01–65](../../specs/delivery-lifecycle-v0.1-scenarios.md), as committed at that candidate.
- Proposed follow-on decomposition: [SF-002 outline](../../work/SF-002-outline.md), not READY implementation contracts.
- Audit-only commits after the candidate preserve review results and this package; they do not substitute a different reviewed specification. Exact candidate content governs acceptance.
- No deployable artifact, migration, remote publication, automatic merge or production release. UI/mockups and runtime tests are N/A for this documentation artifact, not waived requirements for the eventual software.

## Outcome and change summary

The candidate defines work/cycle/run identities, owner authority, guarded delivery/control transitions, review and execution budgets, candidate-bound evidence, recovery/containment, and a separate release handoff. Cycle-07 removes the ACTIVE-preserving exception: escalated recovery settles PAUSED after required reconciliation/containment, while eligible healthy siblings may remain observed. SC-61–65 cover timing, owner-pause races, empty histories and mixed required stops. The simplification preserves no-dispatch, budgets, blockers, cancellation and quarantine.

D-008 (conservative paused-execution failure) and D-009 (PAUSED settlement) are already accepted directions. Neither prior approval accepted the complete specification.

## Independent evidence and limitations

| Gate | Candidate-bound result | Evidence |
| --- | --- | --- |
| Standard attempt 1 | PASS, no material findings | [Raw result](standard-1-result.json), [exact input](standard-1-prompt.txt) |
| Adversarial attempt 1 | ship / PASS, no substantive findings | [Exact report](CHALLENGE.md), [raw result](adversarial-1-result.json), [exact input](adversarial-1-prompt.txt) |
| Author structural checks | PASS: Markdown targets, 65 ordered unique IDs, diff whitespace, raw result/SHA validation, unchanged reviewed artifacts | [Ledger](README.md) |
| Owner walkthrough and specification decision | **PENDING** | Procedure below; do not claim an agent completed this human gate |

Both reviewers used separate fresh, tool-disabled Claude Code contexts and full operator-extracted specification/scenario text plus the actual bounded design diff. No developer transcript was supplied; adversarial input omitted standard conclusions. Same vendor/model does not mean shared context. They did not directly inspect Git or execute tests. Review scope was the cycle-07 simplification and its interactions with the supplied full design, not an executable proof of all lifecycle behaviour.

Cycle-07 counts: **standard 1/2 PASS; adversarial 1/1 PASS; infrastructure failures 0**. Earlier failures remain historical evidence, not rewritten PASSes. Full prior history: [work record](../../work/SF-001.md) and linked cycle ledgers. Only cycle-01 had one infrastructure timeout. No runtime infrastructure failure occurred in cycle-07.

## Criterion-to-evidence matrix

| Criterion | Artifact / review evidence | Remaining owner or implementation obligation |
| --- | --- | --- |
| AC1 identities, states, authority | Spec §§2–3; standard scope/interaction traces; adversarial origin-gap and mixed-sibling traces | Owner approves exact model; later fixtures enforce it |
| AC2 budgets and revisions | Spec §4; SC-02–06, 20–22, 41, 48, 52, 61–65; both reviewers' budget/authority analysis | Explicit Q1/Q3 policy decision; later transactional counter tests |
| AC3 evidence freshness | Spec §§4–5; scenario acceptance mapping; review SHA provenance | Later schema, digest, identity and stale-evidence tests |
| AC4 crash/race/containment | Spec §§3, 6; SC-23–30, 59–65; both reviewers' recovery traces | OS/SQLite/adapter experiments; resolve listed residual recovery uncertainty before implementing that path |
| AC5 approval/release boundaries | Spec §§2, 4 Q4, 7; SC-09–15, 31–35, 42–43 | Owner authority/profile decisions; separate release permissions |
| AC6 alternatives and acceptance | Spec §4 Q1–Q5/§8; decision register A-001–A-007 | This explicit owner acceptance is still missing |
| AC7 bounded follow-on work | SF-002 outline, dependency/readiness constraints; standard AC assessment | Refine individual tickets; no automatic READY or implementation |

The matrix is a documentation/readiness assessment. It is not a claim that runtime acceptance criteria have been executed.

## Owner walkthrough (pending)

Observer: project owner. Inspect the frozen specification/scenarios and the independent reports, then confirm or challenge these outcomes:

1. **Bounded review:** SC-03/04 stop after second standard FAIL or adversarial FAIL; an explicit child cycle retains old counters and repeats required gates.
2. **Safe observation:** SC-61/62 — P's blocker prevents dispatch, Q continues safely; either escalation/interruption ordering settles PAUSED. Clearing all blockers restores VERIFYING/PAUSED and requires explicit owner resume.
3. **Mixed/empty recovery:** SC-64/65 — empty recovery settles PAUSED only on proof; required stop completes before settlement; Q can remain observed. Unknown containment cannot be relabelled safe/empty.
4. **Failure:** SC-61 — an observed paused/escalated execution failure requires a child cycle/cancellation, not a deferred same-cycle replacement.
5. **Acceptance/release:** SC-15/19/31/42 — evidence and explicit acceptance bind to a candidate; acceptance alone neither merges nor deploys.

Owner may approve, request a scoped revision, or reject/rethink. Record the actual response; absence of objections is not acceptance.

## Decisions requested with specification approval

Approve or amend the exact candidate's proposed policies explicitly:

- **Q1:** owner-authorised immutable child cycles after terminal review failure/revision; no erased counters or reused failed gates.
- **Q2:** candidate freeze and conservative head/base/context drift escalation; stale verdicts consume their assigned reservation but cannot advance new code.
- **Q3:** one safe automatic replacement execution per cycle, minimum five-second backoff, only eligible ACTIVE-origin non-escalated recovery; D-008 excludes deferred paused/escalated retries. This future controller policy does not silently replace the manual bootstrap infrastructure-failure stop rule.
- **Q4:** owner is sole initial approval authority; only exact profile-permitted check waivers, never provenance/safety/permissions/hard limits/independent review verdicts/final acceptance.
- **Q5:** finite explicit initial-work/batch authority; no standing revision/reset authority or design-approval bypass.
- **P-004:** one adversarial review for every change initially, with no implicit small-change exemption.
- **O-006, initial merge portion only:** owner-only manual merge with the specified candidate/base/provenance checks; no automatic merge/deploy. Foreground/daemon choice, remote setup and other hosting/integration details remain separate.

Suggested decision wording (not a recorded approval): “I approve SF-001 delivery lifecycle v0.1 and its scenario set at a02c9b010c8888683b43cc2773cc03cde454023b, including Q1–Q5, P-004 and the initial manual owner-only merge policy, with the listed implementation obligations retained. Proceed to refine the first SF-002 contract.”

## Residual risks and deferred obligations

- **No implementation proof:** SQLite transactions, CAS/idempotency, launch lookup, process-tree containment, evidence authentication and runtime cancellation remain untested. They block unattended operation until demonstrated.
- **Non-escalated empty-run recovery:** both reviews identify a pre-existing uncertainty about whether such a restart enters RECOVERING and its exit if it does. No safety bypass demonstrated, but fixture semantics must be explicitly resolved before implementing that path; approval must not license an implementer to invent a default. Record/refine this obligation in SF-002D or a prior bounded design task.
- **Current proof across pause races:** enforce evidence revalidation after observation loss even if owner pause commits first. Prose traces do not prove implementation enforcement.
- **Editorial notes:** standard notes remain unmodified after PASS. They are retained evidence, not silently fixed or new acceptance conditions. Material future changes require their own authorised review/approval.
- **Operational friction:** explicit blocker-resolution/resume and conservative no-retry failures may require owner attention. This is a deliberate initial trade-off; measure before changing policy.
- **Other pending setup:** toolchain/package manager, concrete quality profiles/deadlines, Pi/Claude Code capabilities, local process model and release mechanism evidence remain separate decisions/spikes. Specification acceptance does not establish capability or permit deployment.

## Next action

Owner completes the walkthrough/decision for this exact candidate. After approval, record the approval without altering historical verdicts and refine the first SF-002 contract. No implementation before its own readiness and authorisation gates are met.
