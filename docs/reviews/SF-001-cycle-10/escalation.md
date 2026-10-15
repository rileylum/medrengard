# SF-001 cycle-10 — terminal adversarial escalation

## Frozen evidence

- Authority: A-010; scope narrowed stopped-review/no-verdict and ACTIVE-classification/pre-dispatch correction disposition, matching scenarios; manual at most 2 standard + 1 adversarial.
- Candidate: `85ccd96acf694c48aec8ea8d8ccdbfa19537d54a`.
- Standard comparison/adversarial merge-base: `c81d447e4669911224c0d95419bfdbc89af00f1a`.
- Standard 1: PASS, with low findings and deferred uncertainties. [Raw result](standard-1-result.json), [prompt](standard-1-prompt.txt).
- Adversarial 1: needs-attention / FAIL, 2 medium + 1 low. [Exact report](CHALLENGE.md), [raw result](adversarial-1-result.json), [prompt](adversarial-1-prompt.txt), [workspace proof](adversarial-workspace.txt).
- No design edits after standard PASS. Counters: **standard 1/2 PASS; adversarial 1/1 FAIL; infrastructure failures 0**. Unused standard allowance does not override terminal adversarial stop.

## Findings as reported — not silently adopted policy

| ID | Severity / confidence | Reviewer claim | Standard-review comparison |
| --- | --- | --- | --- |
| C10A1-F1 | Medium / 0.6 | After an abandoned pre-dispatch episode's source failure is legitimately discharged, the same candidate resumes. A later different check crash/defect lacks explicit Q3 precedence and new-Q6 episode semantics: does historical intent permanently block replacement/new correction or can a distinct episode use remaining C? | Standard traced discharge, no resurrection and counters as holding; did not raise this later-different-source branch |
| C10A1-F2 | Medium / 0.5 | Escalation after correction dispatch, with writer stopped without valid result, lacks explicit durable disposition and deterministic restoration outcome; SC-95 refers to existing rules without resolving the case | Standard U1 identified adjacent already-dispatched-writer gap but deferred as pre-existing/outside A-010. Adversarial agrees adjacent/outside narrowed scope, yet treats current coverage claim as material |
| C10A1-F3 | Low / 0.4 | Required-stop finalisation does not explicitly determine fencing/closed-run status; whether late reviewer output consumes the reservation is therefore implementation-dependent | Standard L2 likewise flags this as low, not a blocker to its PASS |

Both reviews say the named missing-review, ACTIVE-classification and undispatched-abandonment paths are covered. Their broader judgments differ; preserve both verdicts. Neither report establishes an unsafe gate bypass from F1/F3. No author adjudication or correction was undertaken after terminal FAIL. The adversarial alternatives are recommendations, not owner-approved policy changes.

Standard additionally notes low clarification issues around reconciliation lookup/deadline, transaction-stage wording and failure-versus-route terminology, plus uncertainty over in-flight diagnostics. Those are retained in its original result; no post-PASS cleanup has changed the candidate.

## Stop and required decision

Cycle-10 stops under the manual rule. No additional review, correction, implementation or full-spec acceptance is authorised. Suggested next action: owner authorises bounded triage of F1's actual Q3/Q6 alternatives and F2's scope/materiality, including whether explicit fencing semantics are needed before acceptance. Triage would not itself grant design edits or a new review cycle. Any correction must separately name its scope, policy direction and budget; do not automatically extend A-010.

## Evidence limits

Fresh tool-disabled reviews using operator-extracted committed context/manifests/scoped diffs, reported model `claude-opus-5-5`, each exit 0 within 600-second deadline; not direct reviewer Git inspection. Adversarial packet excludes historical conclusions and developer reasoning. Exact report copied from raw result to detached workspace and this ledger. Author structural/provenance checks are not executable controller tests; no runnable implementation or runtime proof exists.
