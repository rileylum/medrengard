# SF-001 cycle-10 review ledger

Authority: A-010, owner “Yes go ahead” to narrowed obligation-disposition correction and at most two standard reviews/one adversarial review. Parent cycle-09 stopped standard 2/2 (FAIL, PASS), adversarial 1/1 FAIL; all earlier evidence remains unchanged.

Scope: C9A1-F1/F2 as narrowed by authorised cycle-09 triage: stopped required reviewer without verdict after reconciliation; ACTIVE failure classification and admitted pre-dispatch correction obligations; matching scenarios and direct audit/outline alignment. No unrelated redesign, implementation or specification acceptance.

Base: `c81d447e4669911224c0d95419bfdbc89af00f1a`. Frozen candidate: `85ccd96acf694c48aec8ea8d8ccdbfa19537d54a`. No design changes after standard PASS. **Stopped after adversarial FAIL**; [escalation/disagreement packet](escalation.md).

## Budget

- **Standard 1/2 (PASS); adversarial 1/1 (needs-attention/FAIL); infrastructure failures 0.** Remaining standard slot cannot bypass terminal adversarial stop.
- First standard FAIL allows bounded correction and second standard; second FAIL stops. Standard PASS proceeds to one adversarial review; any adversarial FAIL stops. Infrastructure failure requires guidance, not silent retry. Product configurable budgets do not apply to manual reviewing of this specification.

## Evidence method

Fresh tool-disabled independent contexts over operator-extracted committed documents, numbered normative context, full changed-file manifests and scoped Git diffs. Review packets exclude developer reasoning/transcripts; adversarial packet additionally excludes previous conclusions. These are tabletop design reviews, not direct reviewer Git inspection or executable controller verification. Actual prompts/raw JSON/stderr retained per attempt. Both fresh Claude CLI invocations completed exit 0 within 600-second deadlines, model reported `claude-opus-5-5`.

| Attempt | Candidate | Verdict | Evidence |
| --- | --- | --- | --- |
| Standard 1 | `85ccd96acf694c48aec8ea8d8ccdbfa19537d54a` | PASS with low/deferred notes | [prompt](standard-1-prompt.txt), [raw JSON](standard-1-result.json), [stderr](standard-1-stderr.txt) |
| Adversarial 1 | same SHA | needs-attention / FAIL; 2 medium, 1 low | [prompt](adversarial-1-prompt.txt), [raw JSON](adversarial-1-result.json), [stderr](adversarial-1-stderr.txt), [exact CHALLENGE](CHALLENGE.md), [workspace](adversarial-workspace.txt) |

Author checks passed before freezing: `git diff --check`; Python asserted 96 ordered unique scenario IDs, all local Markdown targets exist, and tracked v0.1/cycle-09 evidence unchanged. These are structural/provenance checks, not semantic proof. No runtime tests or deployable artifact. No owner acceptance inferred. Post-review checks also validate raw JSON success/verdict/SHA, exact CHALLENGE equality, frozen design unchanged and detached workspace tracked diff empty. No further design edits or reviews authorised. Owner subsequently replied “yes” to bounded author triage only; [completed analysis](triage.md) narrows the findings without rewriting either verdict. Next action is owner policy/scope/budget decision, not automatic correction. Reviewed design, raw reports and counters remain unchanged.
