// The review and verify configurations on test_translator, the problem review-verify left out for
// its cost (V7) and the only one whose published baseline breaks down over time: Core falls after
// checkpoint 4-5 in 4 of 5 runs. Whether lower erosion keeps it solved later. Compared with the
// published baseline's runs there (baseline-added, survey), with no fresh baseline: the owner's
// choice. n=1 first, to measure cost and see the first sign; more repeats are a later decision.
// Paid: only with the owner's approval.
import { defineStudy } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["code-review", "verification"],
  problems: ["test_translator"],
  repeats: 1,
});
