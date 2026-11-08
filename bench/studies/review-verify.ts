// The first review and verify study: Matt Pocock's code-review and obra/superpowers'
// verification-before-completion, each compared with a fresh baseline run alongside, paired by
// problem (docs/review-verify.md). n=3, fixed from the published baseline's spread before this ran
// (decision N1). The baseline runs again because a drift check a day after it was published fell
// below its range (V6). Eleven of the twelve iteration problems: test_translator is left out for its
// cost, a third of the study's on its own, chosen by the baseline's cost, not by the pilots (V7).
// Run in stages, the owner checking in between:
//   --problems eve_jump_planner,execution_server,layered_config_synthesizer,datagate,textdrop
//   then mvvault,eve_industry,eve_market_tools,file_merger,meshctl,file_query_tool.
// Paid: only with the owner's approval.
import { added, defineStudy, iteration } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["baseline", "code-review", "verification"],
  problems: [...iteration, ...added].filter((problem) => problem !== "test_translator"),
  repeats: 3,
});
