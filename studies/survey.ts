// The baseline once on every problem neither set holds, to choose the iteration set's next six by
// difficulty for this model rather than by label: `study.ts select` places them, and the current
// six by their first baseline run, on driver/select.ts's grid. Fixed before the survey ran.
// Paid: only with the owner's approval.
import { defineSelection, defineStudy, iteration, unused } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["baseline"],
  problems: unused,
  repeats: 1,
});

export const selection = defineSelection({
  current: { problems: iteration, study: "baseline", run: "baseline-baseline-r1" },
  // Added after the survey: these two stopped when the agent filled a 256 MiB /tmp held in memory.
  reruns: { problems: ["dynamic_buffer", "mocked_http"], study: "survey-rerun", run: "survey-rerun-baseline-r1" },
  perCell: 2,
  seed: 20261105,
});
