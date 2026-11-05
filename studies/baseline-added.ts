// The baseline five times on the six problems added to iterate on, so all twelve have its spread.
// Run on the configuration with /tmp and the home on disk (Medrengard scratch areas).
// Paid: only with the owner's approval.
import { added, defineStudy } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["baseline"],
  problems: added,
  repeats: 5,
});
