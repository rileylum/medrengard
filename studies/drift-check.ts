// The baseline once more on datagate, a day after its n=5: both pilot configurations' erosion fell
// below every baseline run there, so this checks whether the baseline itself has moved before the
// published runs serve as the control. Joins no comparison. Paid: only with the owner's approval.
import { defineStudy } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["baseline"],
  problems: ["datagate"],
  repeats: 1,
});
