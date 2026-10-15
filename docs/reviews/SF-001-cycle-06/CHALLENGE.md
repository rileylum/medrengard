# Adversarial review — SF-001-review-06 (delivery lifecycle v0.1, cycle-06 recovery clarifications)

Reviewed: 09e4328d35a68929d9d07579727a323ee965a105  ·  Base: bcb001a9bd374768394584270cffffdf8ced9747 (merge-base bcb001a9bd374768394584270cffffdf8ced9747)
Verdict: needs-attention

Do not ship. The empty-set exit and the removal of the owner-pause wording hold up when traced. The safe-sibling ordering clarification does not. This cycle was authorised specifically to fix decision ordering. Even so, the control outcome (ACTIVE or PAUSED) for escalated ACTIVE-origin recovery still depends on event order and on which overlapping row an implementer applies. SC-62 also asserts an order-equivalence that the spec's own rows and SC-63 contradict. The design's stated success signal is "one unambiguous expected transition and counter outcome" per fixture (`delivery-lifecycle-v0.1.md:17`). This failure lands directly on the semantics this cycle was meant to settle.

## Findings

### [MEDIUM] Escalated ACTIVE-origin recovery has two written control outcomes for reachable sequences, and SC-62's reverse-ordering claim contradicts the rows and SC-63 — `docs/specs/delivery-lifecycle-v0.1.md:118-119`, `docs/specs/delivery-lifecycle-v0.1-scenarios.md:117-118`

Confidence: 0.5

**Sequence (a): SC-62 "reverse ordering".**
1. Start at VERIFYING/ACTIVE `(0,0)`. Q is running with proven read-only confinement. P cannot launch its initial execution because configuration is missing.
2. With no interruption yet, the controller applies the VERIFYING "required check cannot launch its initial execution" row (`delivery-lifecycle-v0.1.md:59`). That row's outcome is **ESCALATED/PAUSED** in one transition. Q receives a keep-observing decision (`:86`).
3. Observation of Q is then interrupted. The interrupted control is PAUSED, so the PAUSED-interruption rows apply (`:114`, `:121`). Healthy reconciliation returns **PAUSED**.

SC-63's final sentence states exactly this: "A later interruption from PAUSED records PAUSED origin and returns PAUSED on healthy reconciliation" (`scenarios.md:118`).

SC-62 says the opposite. It states that the reverse ordering ("safe escalation/keep decision before interruption") "produces the same permitted observation outcome" as the forward ordering, and the forward outcome is "ACTIVE control with delivery ESCALATED" (`scenarios.md:117`). The healthy row supports SC-62's reading. It claims ACTIVE-preserving precedence for "escalation-before-default-pause" (`:118`). However, no transition defines such a window for this blocker class:
- `:59` sets PAUSED atomically.
- `:47` defaults to PAUSED "once containment is proven".
- For a safe VERIFYING blocker, containment is the same read-only confinement proof that the keep-observing decision already requires.

The two-event sequence {P escalation, interruption} therefore yields ESCALATED/ACTIVE in one order and ESCALATED/PAUSED in the other. SC-62 asserts that the orders are equivalent. Taken literally, that contradicts `:59`, `:121` and SC-63. Read charitably, it leaves the control state unspecified. The only path that genuinely reaches ACTIVE-origin recovery after an earlier escalation is an owner resume of ESCALATED/PAUSED to ACTIVE (`:123`), and SC-62 does not state that precondition.

**Sequence (b): mixed sibling set within one recovery.**
1. Start at VERIFYING, with control in ACTIVE-origin RECOVERING. P's safe blocker escalates during recovery (per `:102`).
2. Current evidence proves Q healthy and confined, so Q receives a keep decision.
3. Current confinement of sibling S cannot be established, so the same transaction records a stop intent for S (SC-62 negative branch). The stop row applies (`:119`).
4. S's termination and write containment are later proven, while Q is still live and healthy.

Two rows now match, with different outcomes:
- The stop row says that once all required stops are proven, the outcome is **ESCALATED/PAUSED**. SC-61's complementary branch repeats this ("Proven termination of all required runs yields ESCALATED/PAUSED").
- The healthy row's guard is also satisfied at that instant. The delivery is ACTIVE-origin and ESCALATED. Q has a keep decision. The empty-set exit does not apply because Q is live. S's stop intent is fulfilled, not pending. S was a controller stop, not an execution failure. The healthy row therefore yields **ACTIVE**, and its text claims precedence over default-PAUSED for permitted runs such as Q.

The diff added explicit precedence only between the empty-set row and the healthy row. It added none between the stop row's completion and the healthy row.

**Impact.** This is an inference from the written guards, and nothing has been executed. Safety impact is limited. ESCALATED remains non-dispatchable in both outcomes, and restoration via `:82`/`:125` forces PAUSED anyway. The defect is a contradiction in the authorised scope:
- Two conforming SF-002D implementations or fixture sets would persist different control states for the same input.
- A fixture written from SC-62 would fail against one written from SC-63 or `:59`.
- Either the "ONLY for explicitly permitted observation runs" limit on ACTIVE-preserving precedence or the conservative PAUSED default is being applied inconsistently.

Previous cycles stopped on findings of this same kind: recovery control determinism.

**Recommendation.**
1. Restrict SC-62's reverse-ordering sentence explicitly to the case where control was ACTIVE at the interruption, i.e. owner-resumed ESCALATED/ACTIVE.
2. State that an escalation that committed ESCALATED/PAUSED first leads to PAUSED-origin recovery and returns PAUSED, consistent with SC-63.
3. Either define the "escalation-before-default-pause" window as an actual guarded transition, or delete that phrase from the healthy row.
4. Add one precedence sentence covering a recovery in which a controller stop was required and later proven while permitted siblings remain live. Choose one outcome, most consistently ESCALATED/PAUSED per SC-61. For example, add a healthy-row guard: "no controller stop was required in this recovery episode". Add a matching scenario row for that case.

## Not verified

- **No direct Git inspection.** I had no tools and did not run `git merge-base` or `git diff`. I relied entirely on the operator-supplied extract of the merge-base diff and the numbered file context. Line references come from that extract, and I have not confirmed them against the worktree.
- **No executable checks.** No controller, schema, fixtures or test suite exist. SC-62 to SC-64 are tabletop expectations. Nothing here shows SQLite atomicity, state-version CAS behaviour, OS process containment, adapter lookup or runtime cancellation. The finding above comes from tracing the written guards and precedence, not from any runtime result.
- **Behavioural-finding disposition.** A-006 requires that the "unsupported behavioural-finding disposition" be preserved. The cycle-06 and cycle-05 ledgers (`docs/reviews/SF-001-cycle-0{5,6}/README.md`) were not supplied, so I could not check this or confirm that prior adversarial findings are recorded and unaltered.
- **Prior conclusions.** No previous reviewer conclusions or developer reasoning were provided. I did not check whether the cycle-05 adversarial failure that motivated this cycle is fully resolved, beyond what the diff and context show.
- **Scope and approval.** I assessed scope only against the A-006 text in `docs/decisions.md:57-64`. Owner approval of the full specification remains a separate gate, and this review neither grants nor implies it.