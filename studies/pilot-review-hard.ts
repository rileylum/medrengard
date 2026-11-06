// The pilot's two configurations once on eve_market_tools, a problem hard for this model (the
// baseline fails it the same way in all five runs, erosion the highest of the twelve), with the
// baseline once beside them as a drift check. A first look, in no comparison.
// Paid: only with the owner's approval.
import { defineStudy } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["baseline", "code-review", "verification"],
  problems: ["eve_market_tools"],
  repeats: 1,
});
