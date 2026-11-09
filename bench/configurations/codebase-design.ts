// Matt Pocock's codebase-design skill, design before code: deep modules behind small interfaces, seams placed
// on purpose. "Before you write them" is ours, so the design comes first rather than as a check afterwards.
// No Agent: its design-it-twice subagents run only when the user asks for alternatives, which this does not.
// Running it spends the owner's subscription: only with their approval.
import type { Configuration, Environment } from "../workflow.ts";
import { claudeCodeConfiguration, skill } from "./claude-code.ts";

export const prompt =
  "Do what the request says, in your workspace. Use the codebase-design skill to design your changes before " +
  "you write them. When you are done, commit all your work and claim the commit.";

export default function codebaseDesign({ access }: Environment): Configuration {
  return claudeCodeConfiguration({ access, prompt, skills: [skill("mattpocock/codebase-design")] });
}
