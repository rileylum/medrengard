// obra/superpowers' verification-before-completion skill, three times on the twelve iteration problems, compared with the published
// baseline (n=5) paired by problem: study.ts report studies/baseline.ts studies/baseline-added.ts
// studies/verification.ts. n was fixed from the baseline's spread before this ran (decision N1).
// Paid: only with the owner's approval.
import { added, defineStudy, iteration } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["verification"],
  problems: [...iteration, ...added],
  repeats: 3,
});
