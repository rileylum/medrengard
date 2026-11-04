// The dry factory: the benchmark workflow with the stub as its agent, on its own log under
// /var/tmp, at no cost. dryFactory builds it anywhere, as the tests do.
import { join } from "node:path";
import { builtIn } from "#medrengard/defaults/kinds.ts";
import { limits } from "#medrengard/defaults/limits.ts";
import { benchmarkWorkflow, implementAccess, implementPrompt } from "../workflow.ts";

const stub = new URL("agent.ts", import.meta.url).pathname;

/** The dry factory with its log and trajectories under `state`, its stub reading `problems`. */
export function dryFactory(state: string, problems: string) {
  const trajectories = join(state, "trajectories.git");
  const factory = {
    log: join(state, "log", "log.sqlite"),
    defaults: { limits },
    kinds: builtIn,
    workflows: {
      benchmark: benchmarkWorkflow({
        trajectories,
        agent: {
          harness: { run: [process.execPath, stub, problems] },
          model: "dry",
          prompt: implementPrompt,
        },
        access: implementAccess([
          { path: stub, mode: "read" },
          { path: problems, mode: "read" },
        ]),
      }),
    },
  };

  return { factory, trajectories };
}

const dry = dryFactory(
  "/var/tmp/medrengard/bench-dry",
  new URL("../vendor/scb-problems", import.meta.url).pathname,
);

export default dry.factory;

export const trajectories = dry.trajectories;
