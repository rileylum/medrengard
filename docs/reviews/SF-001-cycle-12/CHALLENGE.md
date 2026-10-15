# Adversarial review — SF-001-review-12 (adversarial attempt 1)

Reviewed: 502f482248ef8ffb3a765def15f43ea94fb32a2d  ·  Base: 7e39957b155422df133b8cac64f3d965d7d77703
Verdict: needs-attention

This is a tabletop review of the operator-extracted committed documents, the changed-file manifest and the scoped normative diff. It is not direct Git inspection and nothing was executed.

The cycle-12 revision mostly does what A-012/D-014 asked. It removes HELD_DEVELOPMENT and records `correction-recovery-required` in the escalation transaction itself. It also adds trusted-receipt ordering and a sealed barrier before replacement or closure. One interaction defeats a central D-014 aim. A timely trusted completion whose artifact is only *delivery-delayed* still drives a non-escalated Q6 correction into mandatory child recovery. The same mechanism leaves initial development with no defined route. Both are blocking for a revision whose stated purpose is tolerating delivery lag. A third, lower-confidence gap concerns a disproven launcher absence proof.

## Findings

### [medium] Delayed artifact attachment on a non-escalated correction escalates and forces child recovery — `docs/specs/delivery-lifecycle-v0.2.md:96,108,112,132,148`; `docs/specs/delivery-lifecycle-v0.2-scenarios.md:206`

Confidence: 0.6

**Event sequence**

1. A Q6 correction writer X is DEVELOPING/ACTIVE on H1 with C=1. The delivery is non-escalated.
2. X commits H2. The trusted launcher records a valid pre-cutoff receipt that binds the retained artifact identity.
3. Delivery is lost and the lease expires.
4. ACTIVE-origin recovery reconciles the receipt. The retained artifact is not yet retrievable; the store is lagging.

**How the rules route this**

- §3:108 says "Artifact attachment still uses evidence-retrieval, not a new execution."
- The evidence-retrieval rule (§3:148) is defined as adding "an OPEN evidence-retrieval blocker".
- Blockers are escalation records (§3:132: blockers arise once "missing completion artifact ... is observed"). SC-53 places this case in ESCALATED/PAUSED.
- That escalation commits before H2 has been accepted as current. The new disposition row (§3:96) therefore applies: OPEN `correction-recovery-required`, episode ABANDONED_ESCALATION, C retained.
- That blocker is non-waivable and not operationally resolvable, "regardless of whether a valid completion is later recovered".
- Retrieving the artifact later cannot clear it. A child cycle or cancellation becomes mandatory.

**Impact**

- Pure delivery or retrieval lag forfeits a valid, in-scope correction. The parent's spent C, S and A are lost, and the owner must intervene.
- This contradicts §3:110 ("A timely receipt avoids a false timeout based solely on delivery lag").
- It contradicts the D-014 aim of keeping timely trusted completion usable despite later retrieval.
- It contradicts SC-111's promise of one handoff with C/S/A/R/D unchanged.
- SC-105 covers the delayed-artifact branch for reviewers, but SC-111 omits it for development. This hides the divergence.
- The "unknown receipt-source completeness/order is a reconciliation blocker" path (§3:110) does the same if it is recorded as an escalation blocker. A transient lookup gap during a non-escalated correction becomes irreversible.

**Recommendation**

- Define a non-escalating, bounded "development evidence-retrieval pending" obligation for a non-escalated DEVELOPING receipt that awaits its artifact. While it is open, block dispatch and handoff.
- Bound it by the existing execution/evidence deadline. Escalate only on deadline expiry, invalid provenance or another trigger.
- Alternatively, state explicitly that an escalation whose only cause is a retrieval or receipt-lookup blocker for the correction's own timely receipt does not create `correction-recovery-required`.
- Add the delayed-artifact and incomplete-lookup branches to SC-111, and SC-109's ordering, with the expected counters.

### [medium] Unrouted initial-development completion has no escalation disposition, so it is either stranded or gains an unreviewed same-cycle handoff — `docs/specs/delivery-lifecycle-v0.2.md:88,112,136,179`; `docs/specs/delivery-lifecycle-v0.2-scenarios.md:206`

Confidence: 0.5

**What changed**

Cycle-12 introduces a new persisted state. A validated development completion is kept "as unrouted evidence until ACTIVE is permitted" (§3:112), for initial development and Q6 alike.

**Why the inventory misses it**

- The escalation obligation inventory (§3:88) lists PENDING/HELD_PASS routes, assertion failures, Q6 episodes and reviewer reservations. Q6 is now covered by `correction-recovery-required`.
- The inventory does not list an unrouted initial-development completion. The disposition table has no row for it.

**Event sequence**

1. Initial DEVELOPING. The owner pauses.
2. The writer's H1 receipt is recovered. Its artifact is missing, so an evidence-retrieval blocker escalates (same mechanism as the first finding).
3. The owner retrieves the artifact. The blocker-set rule (§3:136) restores DEVELOPING/PAUSED.
4. The owner resumes.

**Two contradictory readings**

The owner-resume row (§3:179) applies "a non-escalated pending quality/development result" after restoration. §3:112 says "This rule is NOT a handoff out of ESCALATED delivery; initial-development escalation retains its existing blockers". SC-111 says "Initial escalated development does not gain a new recovery route."

- **(a) The handoff applies.** Restore-then-resume becomes the same-cycle escalated development handoff that §3:112 and SC-111 deny. That handoff was not reviewed for this path.
- **(b) The handoff is forbidden.** The cycle returns to DEVELOPING/ACTIVE with the writer contained and its only result unroutable. §3:112 rules out a "lost result trigger" or relaunch, and no Q3 path applies, so the cycle has no defined exit.

Either way, the next transition depends on implementation guesswork, which SF-001's goal forbids.

**Recommendation**

- Add the unrouted development completion to the §3:88 inventory with an explicit disposition row.
- Either name it a HELD route with once-only release after restoration, or route it to an INVALIDATED/child-required outcome.
- Add the matching restore/resume branch to SC-111.

### [medium] A disproven launcher absence proof is only recorded as an anomaly; prior seals and replacements stay trusted — `docs/specs/delivery-lifecycle-v0.2.md:110,114`; `docs/specs/delivery-lifecycle-v0.2-scenarios.md:207`

Confidence: 0.4

**What the spec says**

- A receipt positioned at or before a previously proven complete-absence cutoff "contradicts that proof: record a provenance anomaly, do not count/route it" (§3:110, SC-112(a)).
- The sealed barrier (§3:114) makes Q3 replacement and CLOSED_UNUSED finalisation depend wholly on the same launcher's complete-inventory proofs.
- Only *missing* capability blocks unattended eligibility. A *demonstrated* false completeness proof does not.

**Inferred event sequence** (no rule shows this race directly)

1. The same launcher earlier produced a sealed "complete absence" inventory for a reviewer run R1.
2. On the strength of that inventory, a Q3 replacement R2 committed, and R2's PASS consumed the ordinal.
3. A genuine R1 FAIL receipt positioned before that seal later surfaces.
4. Post-replacement output is "diagnostic/anomalous only", so the FAIL never counts. The PASS stands.

**Impact**

- An unreliable trust root can hide a real quality FAIL behind a replacement PASS.
- The only signal is an anomaly record. It does not escalate the nonterminal cycle, invalidate dependent seals or revoke capability eligibility.

**Recommendation**

- Treat any contradiction of a recorded completeness or seal proof as a provenance/safety event.
- Escalate (or quarantine) the affected cycle with `result-route-invalid` for routes that relied on that launcher's proofs.
- Mark the launcher capability ineligible for unattended execution until it is revalidated.
- Add this as an SC-112(a) and SC-107 branch.

## Not verified

- **Inspection scope.** I did not run `git merge-base`, a diff or any check. I reviewed only operator-extracted text and the scoped diff.
- **Excluded content.** The following were excluded or not supplied, so I cannot confirm their alignment, ledger accuracy or counter records:
  - the diffs for `docs/STATUS.md`, `docs/decisions.md` and `docs/work/SF-001.md`;
  - the cycle-12 review README and the standard-1 prompt, result and stderr;
  - the historical approval-gate hunk.
- **Author structural checks.** SC-01 through SC-112 appear contiguous and ordered in the extract (112 rows). I did not resolve local links. Markdown whitespace cannot be judged from an extract. I did not confirm preservation of previous cycle evidence (frozen cycle-11 artifacts, prior verdicts).
- **AC coverage.**
  - AC1–AC4 are the focus of the findings above.
  - AC5–AC7 have unchanged mapping rows except the SC range updates. I found no regression there, but did not re-walk them in full.
  - AC6/AC7 depend on owner approval and SF-002 refinement, which are deferred.
- **Uncertainty, not raised as a finding.** A child that names preserved H2 as "starting material" must still pass "normal readiness/development" (§3:120, SC-103). The spec does not say:
  - whether a child developer result equal to the named H2 (no new commit) is a valid development result;
  - how H2 built on the parent's B1 is handled when the child captures a different B1.
  
  This needs explicit fixture semantics in SF-002, but I could not show a concrete harmful transition.
- **Runtime capability.** Launcher capabilities (durable ordered receipts, complete lookup, sealing, cross-system ordering against controller-defined lease expiry) are design obligations only. Nothing here demonstrates them.
