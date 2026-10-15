# SF-001 cycle-11 — terminal standard-review escalation

## Authority and frozen evidence

A-011/D-013 authorised the three abandonment/stopped-correction/result-fence directions, matching scenarios and manual at most two standard plus one adversarial review. No implementation or complete-spec acceptance was granted.

- Cycle base: `752c0e1f280a1a628341022fa5ef513f318751ec`.
- Standard 1 candidate: `9f3651d4a29ce879e0210141276e54fff77eb467` — FAIL. [Prompt](standard-1-prompt.txt), [raw result](standard-1-result.json), [stderr](standard-1-stderr.txt).
- Final candidate: **`5c6da6c751e2dc68109ffd44d97472bd028af673`** — standard 2 FAIL. [Prompt](standard-2-prompt.txt), [raw result](standard-2-result.json), [stderr](standard-2-stderr.txt).
- Final standard comparison includes cycle diff and bounded correction diff against the first candidate. Both reviews were fresh tool-disabled tabletop analyses, model reported `claude-opus-5-5`; both CLI invocations exited 0 within 600 seconds.
- **Counters: standard 2/2 (FAIL, FAIL); adversarial 0/1; infrastructure failures 0.** No adversarial invocation, no post-final-verdict design edits, no automatic cycle-12.

## First review and permitted correction

C11S1-F1 (medium): valid correction completion reconciled during escalation had no explicit current-candidate/held-result handoff. The bounded correction added HELD_DEVELOPMENT with H1 current, explicit source-failure blockers, normal blocker restoration and once-only owner-resume handoff to H2; output arriving after correction-writer-incomplete cannot change candidate currency. It also aligned the related source-blocker wording and lease-expiry/execution-timeout uncertainty. Added SC-103/104, for 104 scenarios total.

Standard 2 says C11S1-F1 and the source-blocker issue are resolved, subject to its new retained-receipt finding below. The entire candidate remains rejected; a resolved individual finding is not a PASS.

## Final findings — original reviewer claims retained

| ID | Severity / confidence | Reported concern | Status at stop |
| --- | --- | --- | --- |
| C11S2-F1 | Medium / medium–high | Trusted launcher completion produced before lease expiry but first reconciled after expiry: admission-fence wording versus retained-evidence rules can yield diagnostic/child-only versus accepted held-result/possible restoration | Reviewer calls a material inconsistency; no post-verdict author adjudication or correction |
| C11S2-F2 | Low / medium, uncertainty | Q3 replacement commits before the old run is explicitly fenced; late original verdict may consume the shared reservation while replacement runs, causing conflict/wasted replacement | Uncertainty, not silently promoted to a confirmed safety defect |
| C11S2-F3 | Low / high, owner visibility, not a defect | HELD_DEVELOPMENT restoration requires all H1 blockers discharged: review-origin failure cannot restore, and a genuine verification defect generally needs an exact permitted FAILED waiver even though H2 already fixes it | Detailed author-selected handoff remains draft; owner must see/choose the trade-off, not infer approval from A-011 |

### Concrete F1 sequence

1. Registered reviewer X has SR=1. Owner pause followed by W expiry requires a stop.
2. X produces a valid PASS and trusted launcher retains its receipt at t0, but controller delivery is lost.
3. X terminates and its lease expires at t1 > t0.
4. Bounded stop reconciliation runs after t1, within its own cancellation deadline, and finds the receipt.
5. The report contrasts evidence retrieval → consumed verdict/HELD_PASS with post-expiry fencing → diagnostic/unfulfilled-review blocker. The analogous writer case chooses between HELD_DEVELOPMENT and correction-writer-incomplete.

Neither outcome is claimed to bypass quality gates. The disputed boundary is admissibility/counter history and restorable versus terminal disposition. Original rules also condition retained completion on eligibility; preserve the report as a claim requiring a policy/precedence decision, rather than treating the proposed remedy as already authorised.

## Owner decisions needed before another revision

1. **Retained completion versus expiry:**
   - Reviewer Option 1: a trusted launcher record predating expiry/fence/closure and execution deadline remains admissible through bounded reconciliation/retrieval; worker timing claims alone do not qualify. This would require an explicit exception/precedence rule against the current admission-time fence and careful replacement/terminal-closure ordering.
   - Reviewer Option 2: controller must reconcile it before expiry; later receipts are diagnostic. Make this conservative loss-of-evidence consequence and affected scenarios explicit. This may require more child cycles after otherwise successful work.
   - Do not adopt either automatically or fabricate runtime proof of trusted receipt timing.
2. **Held development path:** confirm the current guarded handoff (H1 remains current, H1 source waivers/prerequisites resolved, then one revalidated H2 handoff with fresh H2 checks), or choose child/cancel-only recovery for completion discovered during escalation. Current held path does not waive failures, reuse H1 evidence on H2 or promise recovery for review-origin defects. Requiring a waiver on the candidate being discarded is a real operational/audit cost.
3. If authorising correction, explicitly scope the related Q3 replacement-fence ordering and matching scenarios; do not silently broaden the cycle or erase spent budgets.

Suggested next action: an owner policy decision on these retained-evidence and held-handoff trade-offs before authorising any further cycle. No new budget is requested by recording this packet; any revision needs a separate explicit scope/direction and manual review limit. The unused adversarial allowance cannot be invoked without a standard PASS.

## Checks and limits

Author structural/provenance checks: local Markdown targets, 104 ordered unique scenario IDs, Markdown-only diff whitespace, result JSON success/verdict/full SHA, and unchanged final normative candidate/earlier evidence. No executable controller, SQLite transaction tests, OS containment proof, runtime integration, release or deployment exists. Reviews used extracted text/manifests/scoped diffs, not direct reviewer Git inspection. Full staged `git diff --cached --check` reports trailing spaces in standard-2's exact prompt (numbered blank lines and embedded diff context); raw prompt is retained unchanged, with scoped Markdown checks passing. This is an evidence-formatting limitation, not a failed review invocation or new infrastructure event. Raw reports are retained exactly; no CHALLENGE exists for this cycle because no adversarial review ran.
