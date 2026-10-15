# SF-001 cycle-12 — terminal adversarial escalation

## Frozen authority and evidence

A-013 authorised A-012/D-014 retained trusted completion evidence, child recovery of escalated dispatched corrections, related fence/replacement/closure ordering and matching scenarios, with manual at most two standard and one adversarial reviews. No full-spec acceptance or implementation authority.

- Cycle base/adversarial merge-base: `7e39957b155422df133b8cac64f3d965d7d77703`.
- Standard 1 candidate: `6fecd12c55ccd7ed6249dea88ab1bd68c117ed5d` — FAIL. [Prompt](standard-1-prompt.txt), [raw result](standard-1-result.json), [stderr](standard-1-stderr.txt).
- Final candidate: **`502f482248ef8ffb3a765def15f43ea94fb32a2d`** — standard 2 PASS, then adversarial needs-attention/FAIL on SAME SHA.
- Standard 2 [prompt](standard-2-prompt.txt), [raw result](standard-2-result.json), [stderr](standard-2-stderr.txt). Correction comparison is against standard-1 candidate.
- Adversarial [prompt](adversarial-1-prompt.txt), [raw result](adversarial-1-result.json), [stderr](adversarial-1-stderr.txt), [exact report](CHALLENGE.md), [detached workspace proof](adversarial-workspace.txt).
- **Final counters: standard 2/2 (FAIL, PASS); adversarial 1/1 FAIL; infrastructure failures 0.** No design changes after standard PASS. No automatic correction, extra review or cycle-13.

All three fresh tool-disabled CLI executions completed exit 0 within 600-second deadlines; model reported `claude-opus-5-5`. Tabletop analyses of operator-extracted committed text/manifests/scoped diffs, not direct reviewer Git inspection or executable verification. Adversarial input excludes developer reasoning and previous conclusions. Reviewer returned CHALLENGE inside a Markdown fence: that exact body, including its final newline, is copied to the ledger and detached workspace; raw JSON retains the surrounding introduction and summary too.

## First-review correction

C12S1-F1: retained-receipt wording overgeneralised escalated/child-only routing to non-escalated recovery. Corrected with ordinary role/stage/control routing and once-only non-escalated initial/Q6 development handoff. C12S1-F2: late-result count needed explicit absence-proof cutoffs. Corrected with unsealed complete-through snapshot versus full-interval/sealed absence, anomaly handling for contradictory earlier receipts, and eligible later-recorded receipt counting behind existing blockers. Added SC-111/112; 112 scenarios total.

Final standard review says both material findings are resolved, no material findings remaining. It retains low/deferred notes on initial-development escalation disposition, quarantine-exit versus sealed closure, editorial wording, and cross-source ordering capability. This PASS is preserved as issued, not erased by the later FAIL.

## Adversarial findings as reported — not silently adopted

| ID | Severity / confidence | Claim and concrete path | Standard comparison / decision needed |
| --- | --- | --- | --- |
| C12A1-F1 | Medium / 0.6 | Non-escalated Q6 writer has timely receipt but artifact unavailable; evidence-retrieval blocker escalates, which commits correction-recovery-required; later retrieval cannot restore parent. Reviewer calls this contrary to delivery-lag tolerance and proposes non-escalating retrieval or an escalation exception | Standard accepted receipt/evidence-retrieval and child-recovery guards. A-012 deliberately distinguishes preserved evidence from permission to resume; whether this operational cost violates the agreed policy needs triage/owner judgment, not automatic acceptance of a new exception |
| C12A1-F2 | Medium / 0.5 | Initial development has unrouted completion; artifact retrieval causes escalation; retrieval resolves blocker, then restored DEVELOPING/PAUSED + resume has disputed handoff versus stranded-result outcome | Standard explicitly noted/deferred this mostly pre-existing initial-development escalation gap as low; adversarial treats the new unrouted-evidence interaction as material. Scope/materiality disagreement; no extra initial-development policy authorised by this verdict |
| C12A1-F3 | Medium / 0.4 | A genuine old FAIL receipt contradicts a trusted absence/seal after replacement PASS; report infers anomaly-only handling could leave dependent proofs trusted and hide failure | No matching material standard finding. Broad provenance/conflicting-output guards exist, so exact precedence/effect needs source trace before confirming the claimed bypass. Proposed capability revocation/dependent-route invalidation is not adopted policy |

The report's F1 statement that parent counters are “lost” must not be read as erased history: parent counts/evidence are retained and intentionally do not replenish a child. No post-verdict author adjudication has been performed. Preserve these as reported concerns and review disagreements, not three automatically confirmed implementation defects. No runtime exists to establish their claimed operational consequences.

## Next decision

Suggested next action: owner authorises bounded triage against the selected D-014 policy, specifically:

1. Is child recovery after artifact/lookup-triggered escalation an intended conservative cost, or should bounded non-escalating retrieval be a separately selected change? Preserving timely evidence alone is not permission to resume.
2. Does initial-development escalation need a newly authorised explicit disposition before full acceptance, rather than being deferred under this correction-only scope?
3. Do existing provenance/safety rules already stop advancement when an absence proof is disproved, or is explicit dependent-proof/capability invalidation missing?

Triage would authorise analysis only, not another specification edit or review. Any subsequent correction must name its policy direction/scope and a fresh manual budget. No implementation or exact-spec acceptance inferred; terminal adversarial stop remains in force.

## Checks and limitations

Author checks: 112 ordered unique scenarios, local Markdown targets, authored-Markdown whitespace (raw CHALLENGE excluded), result JSON success/verdict/full SHA, frozen normative bytes unchanged, earlier review evidence preserved, exact CHALLENGE body equality and detached worktree tracked diff empty. The full staged Markdown whitespace check flags two trailing spaces on exact CHALLENGE line 127; the report is preserved unchanged and the scoped authored-Markdown check passes. This is a raw-evidence formatting limitation, not review infrastructure failure. Raw prompts retain embedded Git-diff whitespace as exact review inputs; they are not reformatted to satisfy a whole-packet whitespace check. No executable controller tests, SQLite/process experiments, runtime adapter capability proof, dependencies or deployable artifact.
