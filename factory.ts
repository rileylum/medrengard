// The baseline factory: Claude Code through Medrengard's adapter, told only the benchmark's own
// task. Running a commission here spends the owner's subscription: only with their approval.
import { realpathSync } from "node:fs";
import { builtIn } from "#medrengard/defaults/kinds.ts";
import { limits } from "#medrengard/defaults/limits.ts";
import { benchmarkWorkflow, implementAccess, implementPrompt } from "./workflow.ts";

const trajectoriesPath = new URL("state/trajectories.git", import.meta.url).pathname;

export default {
  log: new URL("state/log/log.sqlite", import.meta.url).pathname,
  defaults: { limits },
  kinds: builtIn,
  workflows: {
    benchmark: benchmarkWorkflow({
      trajectories: trajectoriesPath,
      agent: {
        harness: {
          // Real, because the sandbox grants the adapter's real directory, not the symlink.
          run: [
            "node",
            realpathSync(new URL(".medrengard/adapters/claude-code.ts", import.meta.url)),
            "--permission-mode",
            "bypassPermissions",
            // SlopCodeBench's run presets use thinking high, which is effort high on Claude 5.
            "--effort",
            "high",
            // A safety stop while costs are unknown; checked after each turn.
            "--max-budget-usd",
            "5",
          ],
        },
        // The full ID, not the alias, so the record names the exact model.
        model: "claude-opus-5-5",
        prompt: implementPrompt,
      },
      access: implementAccess(),
    }),
  },
};

export const trajectories = trajectoriesPath;
