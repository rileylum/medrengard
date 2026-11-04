// The first study: the baseline five times on the iteration set, with SlopCodeBench's own harness
// once beside it for calibration: a sanity check that ours lands in its range, not a measure of
// theirs. Run in stages, the owner checking time and cost between them:
//   --problems datagate,textdrop, then file_query_tool,mvvault, then meshctl,eve_industry.
// Paid: only with the owner's approval.
import { defineStudy, iteration } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["baseline"],
  problems: iteration,
  repeats: 5,
  calibrate: { effort: "medium", repeats: 1 },
});
