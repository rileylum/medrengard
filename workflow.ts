// The benchmark workflow: one commission per checkpoint. seed checks out the start the driver made
// for it, implement is the configuration under test, and publish hands its commit back to the
// driver. Only the agent varies between configurations; the steps around it stay the same.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Access, Agent, Limits } from "#medrengard/src/replay.ts";
import { defineWorkflow } from "#medrengard/src/replay.ts";
import { claudeCode, contract } from "#medrengard/defaults/access.ts";

const read = (path: string) => ({ path, mode: "read" as const });
const bin = new URL("bin", import.meta.url).pathname;

/** What every configuration's agent is told: the task itself is the request, as the benchmark renders it. */
export const implementPrompt =
  "Do what the request says, in your workspace. When you are done, commit all your work and claim the commit.";

// Python 3.12, which the benchmark targets, from uv's own installations: the real directory, so
// the definition names its patch version.
function python312() {
  const executable = execFileSync("uv", ["python", "find", "--no-project", "3.12"], {
    encoding: "utf8",
  }).trim();

  return realpathSync(dirname(dirname(executable)));
}

/**
 * The implement step's access: Claude Code's, a 1 GiB home for pip's and uv's caches, Python 3.12
 * first on PATH, uv, and Git told to leave out what SlopCodeBench's snapshots leave out, such as
 * `.venv`. `paths` are added, such as a stub and what it reads.
 */
export function implementAccess(paths: Access["paths"] = []): Access {
  const python = python312();
  const ownerHome = homedir();

  return {
    ...claudeCode,
    paths: [
      ...claudeCode.paths.filter((entry) => entry.path !== ownerHome),
      { path: ownerHome, mode: "empty", size: 1024 * 1024 * 1024 },
      read(python),
      read(join(bin, "excludes")),
      ...paths,
    ],
    // PATH is set, not passed through, so python is 3.12; the rest find node, claude and bwrap.
    environment: ["HOME", "LANG"],
    values: {
      ...claudeCode.values,
      PATH: [
        join(python, "bin"),
        dirname(process.execPath),
        join(ownerHome, ".local", "bin"),
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
      ].join(":"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.excludesFile",
      GIT_CONFIG_VALUE_0: join(bin, "excludes"),
    },
  };
}

export type Options = {
  /** The bare repository the driver puts each checkpoint's start in and publish pushes results to. */
  trajectories: string;
  /** The configuration under test. */
  agent: Agent;
  access: Access;
  limits?: Partial<Limits>;
};

export function benchmarkWorkflow({ trajectories, agent, access, limits }: Options) {
  const node = read(process.execPath);
  const git = (mode: "read" | "write") => ({
    ...contract,
    paths: [...contract.paths, node, read(bin), { path: trajectories, mode }],
  });
  const quick = { idle: 60, attempt: 300, transcript: 1024 * 1024, input: 1024 * 1024 };

  return defineWorkflow({
    start: "seed",
    steps: {
      // The branch named after the commission, which the driver made: the previous checkpoint's
      // result with the problem's assets restored, or the assets alone at the first.
      seed: {
        kind: "command",
        claims: ["commit"],
        run: [process.execPath, join(bin, "seed.ts"), trajectories],
        workspace: "empty",
        inputs: {},
        on: { done: "implement" },
        budget: 1,
        access: git("read"),
        limits: quick,
      },
      implement: {
        kind: "agent",
        claims: ["commit"],
        agent,
        workspace: "subject",
        inputs: { request: "request" },
        on: { done: "publish" },
        budget: 1,
        access,
        ...(limits === undefined ? {} : { limits }),
      },
      // Pushes the commit to refs/results/<commission>, where the driver grades it from.
      publish: {
        kind: "command",
        claims: [],
        run: [process.execPath, join(bin, "publish.ts"), trajectories],
        workspace: "subject",
        inputs: {},
        on: { done: "end" },
        budget: 1,
        access: git("write"),
        limits: quick,
      },
    },
  });
}
