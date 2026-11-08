// A pilot of the first two review and verify configurations: each once on datagate, to check that
// its skill is invoked, that code-review's reviewers start as subagents, that the cost counts them,
// and that nothing escalates. Its scores join no comparison; it may change only how a
// configuration is set up (docs/review-verify.md, decision V4).
// Paid: only with the owner's approval.
import { defineStudy } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["code-review", "verification"],
  problems: ["datagate"],
  repeats: 1,
});
