# Owner authorisation — standard-2-run-2

Authority: owner reply “Yes” to the explicit request to retry standard review 2 once, against the same frozen candidate, with a 10-minute timeout, then proceed to adversarial review only on PASS.

- Cycle: SF-001-review-01; logical attempt: standard 2.
- Replacement execution: standard-2-run-2; deadline: 600 seconds.
- Candidate: `117d763c9b1d57a1ecb6278a1d88a8480c3bfa83`.
- Base: `f9569aa35f68d3e789152febab3489a47f34b1cb`.
- Input: unchanged `standard-2-prompt.txt` from audit commit `d19f664`.
- Output will be recorded separately in `standard-2-run-2-result.json`; the original empty output and timeout record are preserved.
- No counter reset, design approval, general automatic-retry policy or third standard attempt authorised.
- Another infrastructure failure stops for guidance; a valid FAIL consumes standard verdict 2 and escalates. A valid PASS permits the previously authorised single adversarial review.
