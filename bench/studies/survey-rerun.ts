// The baseline once more on the two surveyed problems whose run stopped at a limit of the setup's,
// a memory-backed /tmp of 256 MiB, run again with /tmp and the home on disk to place them.
// Paid: only with the owner's approval.
import { defineStudy } from "../study.ts";

export default defineStudy({
  factory: "../factory.ts",
  configurations: ["baseline"],
  problems: ["dynamic_buffer", "mocked_http"],
  repeats: 1,
});
