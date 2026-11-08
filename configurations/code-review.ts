// Matt Pocock's code-review skill, as his implement skill uses it: do the work, review it, then
// commit. It reviews committed work, so the agent commits before the review; "act on its findings"
// is ours, as the skill only reports. Agent, because the skill's two reviewers are subagents.
// Running it spends the owner's subscription: only with their approval.
import type { Configuration, Environment } from "../workflow.ts";
import { claudeCodeConfiguration, skill } from "./claude-code.ts";

export const prompt =
  "Do what the request says, in your workspace. When you are done, commit your work, then use the code-review " +
  "skill to review it since the commit you started from, with the request as its spec. Act on its findings, " +
  "then commit all your work and claim the commit.";

export default function codeReview({ access }: Environment): Configuration {
  return claudeCodeConfiguration({ access, prompt, skills: [skill("mattpocock/code-review")], tools: ["Agent"] });
}
