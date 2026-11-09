// obra/superpowers' test-driven-development skill: red, green, refactor, each test watched failing before
// the code that passes it. Chosen over Matt Pocock's tdd, which asks the user to confirm its seams and calls
// his codebase-design, so it is not one practice on its own. No tools beyond the baseline's.
// Running it spends the owner's subscription: only with their approval.
import type { Configuration, Environment } from "../workflow.ts";
import { claudeCodeConfiguration, skill } from "./claude-code.ts";

export const prompt =
  "Do what the request says, in your workspace. Use the test-driven-development skill as you work. When you " +
  "are done, commit all your work and claim the commit.";

export default function testDrivenDevelopment({ access }: Environment): Configuration {
  return claudeCodeConfiguration({ access, prompt, skills: [skill("obra/test-driven-development")] });
}
