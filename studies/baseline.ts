// The first study: the baseline five times on the iteration set, with SlopCodeBench's own harness
// beside it for calibration. Run in stages, the owner checking time and cost between them:
//   --problems datagate,textdrop, then file_query_tool,mvvault, then meshctl,eve_industry.
// Paid: only with the owner's approval.
import { defineStudy, iteration } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["baseline"],
  problems: iteration,
  repeats: 5,
  concurrency: 2,
  calibrate: { effort: "medium" },
});
