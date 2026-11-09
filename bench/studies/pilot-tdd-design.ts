// A pilot of test-driven-development and codebase-design: each once on datagate, to check that its skill
// is invoked, how the agent uses it unattended, and that nothing escalates, before tdd-design's repeats.
// No baseline, the owner's choice. Its scores join no comparison; it may change only how a configuration
// is set up, as pilot-review did (docs/review-verify.md, decision V4).
// Paid: only with the owner's approval.
import { defineStudy } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["test-driven-development", "codebase-design"],
  problems: ["datagate"],
  repeats: 1,
});
