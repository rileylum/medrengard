// The stub on the Easy problems of the iteration set, once, through the real grader: a free check
// that a study runs end to end.
import { defineStudy } from "../study.ts";

export default defineStudy({
  factory: "../dry/factory.ts",
  configurations: ["stub", "polished"],
  problems: ["datagate", "textdrop"],
  repeats: 1,
  concurrency: 2,
});
