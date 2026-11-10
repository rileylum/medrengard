// One Claude Code step as the baseline runs it, with a skill added: its prompt, its skill and only the
// tools the skill needs. The review and verify configurations are each one of these, so each differs
// from the baseline only in what its skill brings.
import { realpathSync } from "node:fs";
import type { Access } from "@medrengard/core/src/definition.ts";
import type { Configuration } from "../workflow.ts";

/** A skill copied verbatim under skills/, by its source and name. */
export const skill = (path: string) => realpathSync(new URL(`../skills/${path}`, import.meta.url));

// The adapter's default tools; the adapter adds Skill to them for an agent with skills.
const baselineTools = ["Bash", "Read", "Edit", "Write"];

/**
 * The baseline's step with `prompt`, `skills` and `tools` beyond the baseline's, such as Agent for a
 * skill that starts subagents.
 */
export function claudeCodeConfiguration({
  access,
  prompt,
  skills,
  tools = [],
}: {
  access: Access;
  prompt: string;
  skills: string[];
  tools?: string[];
}): Configuration {
  return {
    start: "implement",
    steps: {
      implement: {
        kind: "agent",
        claims: ["commit"],
        agent: {
          harness: {
            run: [
              "node",
              realpathSync(new URL("../../core/adapters/claude-code.ts", import.meta.url)),
              "--permission-mode",
              "bypassPermissions",
              "--effort",
              "medium",
              "--max-budget-usd",
              "10",
              "--tools",
              [...baselineTools, ...tools].join(","),
            ],
          },
          model: "claude-opus-5-5",
          prompt,
          skills,
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
