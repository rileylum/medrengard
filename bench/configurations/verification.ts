// obra/superpowers' verification-before-completion skill: the agent checks its own work with evidence
// before claiming it. No reviewer, so no tools beyond the baseline's.
// Running it spends the owner's subscription: only with their approval.
import type { Configuration, Environment } from "../workflow.ts";
import { claudeCodeConfiguration, skill } from "./claude-code.ts";

export const prompt =
  "Do what the request says, in your workspace. Use the verification-before-completion skill before you claim " +
  "your work is done. When you are done, commit all your work and claim the commit.";

export default function verification({ access }: Environment): Configuration {
  return claudeCodeConfiguration({ access, prompt, skills: [skill("obra/verification-before-completion")] });
}
