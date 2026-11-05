// The paid factory: one workflow per configuration under configurations/, each wrapped in the
// benchmark's seed and publish, on one log. Running a commission here spends the owner's
// subscription: only with their approval.
import baseline from "./configurations/baseline.ts";
import { benchmarkKinds, benchmarkLimits, benchmarkWorkflow, implementAccess, implementPrompt, type Configuration, type Environment } from "./workflow.ts";

const trajectoriesPath = new URL("state/trajectories.git", import.meta.url).pathname;

const configurations: Record<string, (environment: Environment) => Configuration> = { baseline };

const environment = { access: implementAccess(), prompt: implementPrompt };

export default {
  log: new URL("state/log/log.sqlite", import.meta.url).pathname,
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
