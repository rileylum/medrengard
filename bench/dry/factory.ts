// The dry factory: the benchmark workflow with the stub as its agent, on its own log under
// /var/tmp, at no cost. dryFactory builds it anywhere, as the tests do. Its configurations: `stub`,
// one step, as the baseline; `polished`, the stub and then the stub again adding a file, so a
// configuration of several agent steps runs free.
import { join } from "node:path";
import { benchmarkKinds, benchmarkLimits, benchmarkWorkflow, implementAccess, implementPrompt, type Configuration } from "../workflow.ts";
import type { Access } from "@medrengard/core/src/replay.ts";
import { data } from "../data.ts";

const stub = new URL("agent.ts", import.meta.url).pathname;

function step(problems: string, access: Access, mode: "solve" | "polish", next: string): Configuration["steps"][string] {
  return {
    kind: "agent",
    claims: ["commit"],
    agent: {
      harness: { run: [process.execPath, stub, problems, mode] },
      model: "dry",
      prompt: implementPrompt,
    },
    workspace: "subject",
    inputs: { request: "request" },
    on: { done: next },
    budget: 1,
    access,
  };
}

/** The dry factory with its log and trajectories under `state`, its stub reading `problems`. */
export function dryFactory(state: string, problems: string) {
  const trajectories = join(state, "trajectories.git");
  const access = implementAccess([
    { path: stub, mode: "read" },
    { path: problems, mode: "read" },
  ]);
  const configurations: Record<string, Configuration> = {
    stub: { start: "implement", steps: { implement: step(problems, access, "solve", "publish") } },
    polished: {
      start: "implement",
      steps: {
        implement: step(problems, access, "solve", "polish"),
        polish: step(problems, access, "polish", "publish"),
      },
    },
  };
  const factory = {
    log: join(state, "log", "log.sqlite"),
    defaults: { limits: benchmarkLimits },
    kinds: benchmarkKinds,
    workflows: Object.fromEntries(
      Object.entries(configurations).map(([name, configuration]) => [name, benchmarkWorkflow({ trajectories, configuration })]),
    ),
  };

  return { factory, trajectories };
}

const dry = dryFactory(
  "/var/tmp/medrengard/bench-dry",
  join(data, "vendor", "scb-problems"),
);

export default dry.factory;

export const trajectories = dry.trajectories;
