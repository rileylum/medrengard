// The baseline: Claude Code through Medrengard's adapter, told only the benchmark's own task, in one
// step. Running it spends the owner's subscription: only with their approval.
import { realpathSync } from "node:fs";
import type { Configuration, Environment } from "../workflow.ts";

export default function baseline({ access, prompt }: Environment): Configuration {
  return {
    start: "implement",
    steps: {
      implement: {
        kind: "agent",
        claims: ["commit"],
        agent: {
          harness: {
            // Real, because the sandbox grants the adapter's real directory, not the symlink.
            run: [
              "node",
              realpathSync(new URL("../.medrengard/adapters/claude-code.ts", import.meta.url)),
              "--permission-mode",
              "bypassPermissions",
              // The owner's usual effort; SlopCodeBench's thinking=medium sets the same on Claude 5.
              "--effort",
              "medium",
              // A safety stop on one attempt; checked after each turn.
              "--max-budget-usd",
              "10",
            ],
          },
          // The full ID, not the alias, so the record names the exact model.
          model: "claude-opus-5-5",
          prompt,
        },
        workspace: "subject",
        inputs: { request: "request" },
        on: { done: "publish" },
        budget: 1,
        access,
      },
    },
  };
}
