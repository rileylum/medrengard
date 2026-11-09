// The paid factory: one workflow per configuration under configurations/, each wrapped in the
// benchmark's seed and publish, on one log. Running a commission here spends the owner's
// subscription: only with their approval.
import baseline from "./configurations/baseline.ts";
import codeReview from "./configurations/code-review.ts";
import codebaseDesign from "./configurations/codebase-design.ts";
import testDrivenDevelopment from "./configurations/test-driven-development.ts";
import verification from "./configurations/verification.ts";
import { join } from "node:path";
import { data } from "./data.ts";
import { benchmarkKinds, benchmarkLimits, benchmarkWorkflow, implementAccess, implementPrompt, type Configuration, type Environment } from "./workflow.ts";

const trajectoriesPath = join(data, "state", "trajectories.git");

const configurations: Record<string, (environment: Environment) => Configuration> = {
  baseline,
  "code-review": codeReview,
  verification,
  "test-driven-development": testDrivenDevelopment,
  "codebase-design": codebaseDesign,
};

const environment = { access: implementAccess(), prompt: implementPrompt };

export default {
  log: join(data, "state", "log", "log.sqlite"),
  defaults: { limits: benchmarkLimits },
  kinds: benchmarkKinds,
  workflows: Object.fromEntries(
    Object.entries(configurations).map(([name, configure]) => [
      name,
      benchmarkWorkflow({ trajectories: trajectoriesPath, configuration: configure(environment) }),
    ]),
  ),
};

export const trajectories = trajectoriesPath;
