// The benchmark workflow: one commission per checkpoint. seed checks out the start the driver made
// for it, the configuration under test takes it to a commit, and publish hands that commit back to
// the driver. Only the configuration varies; the steps around it stay the same.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Access, Workflow } from "#medrengard/src/replay.ts";
import { claudeCode, contract } from "#medrengard/defaults/access.ts";
import { builtIn } from "#medrengard/defaults/kinds.ts";
import { limits } from "#medrengard/defaults/limits.ts";
import type { Kind } from "#medrengard/src/kinds.ts";

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
 * The implement step's access: Claude Code's, with /tmp and the home, which holds pip's and uv's
 * caches, as scratch areas on disk rather than in memory, Python 3.12 first on PATH, uv, and Git
 * told to leave out what SlopCodeBench's snapshots leave out, such as `.venv`. `paths` are added,
 * such as a stub and what it reads.
 */
export function implementAccess(paths: Access["paths"] = []): Access {
  const python = python312();
  const ownerHome = homedir();

  return {
    ...claudeCode,
    paths: [
      ...claudeCode.paths.filter((entry) => entry.path !== ownerHome && entry.path !== "/tmp"),
      // An agent may install whole toolchains to test with, as SlopCodeBench's own harness lets it.
      { path: "/tmp", mode: "scratch" },
      { path: ownerHome, mode: "scratch" },
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

/**
 * Medrengard's default limits, with 16 GiB of disk for an attempt: its scratch areas count there,
 * and SlopCodeBench's harness, in Docker, bounds none.
 */
export const benchmarkLimits = { ...limits, disk: 16 * 1024 * 1024 * 1024 };

/**
 * The built-in kinds and start: the commit a checkpoint is given, which, unlike a commit, need not
 * change anything, so a first checkpoint can start from an empty repository. Its workspace is built
 * as a commit's, and the commit verifier compares a claimed commit with it as with a commit.
 */
export const benchmarkKinds = {
  ...builtIn,
  start: {
    role: "subject",
    description: "The commit a checkpoint starts from, named by the full SHA of HEAD.",
    fields: { sha: { limit: 64, required: true } },
    body: { required: false, limit: 1024 },
    verifier: {
      run: [process.execPath, join(bin, "verify-start.ts")],
      access: {
        ...contract,
        paths: [...contract.paths, read(process.execPath), read(bin)],
        workspace: "read",
      },
      limit: 60,
      memory: 4 * 1024 * 1024 * 1024,
      processes: 1024,
      kept: 1024 * 1024 * 1024,
    },
    materialiser: builtIn.commit.materialiser,
  } satisfies Kind,
};

/**
 * What a benchmark gives every configuration: the access its agent steps run with, which holds the
 * benchmark's environment, and the prompt that tells an agent to do what the request says.
 */
export type Environment = { access: Access; prompt: string };

/**
 * The configuration under test: the steps that take a checkpoint's start, the subject, to a commit,
 * entered at `start`. A step goes to `publish` once the subject is the commit to grade; the request
 * is the input query `request`. `seed` and `publish` are the benchmark's.
 */
export type Configuration = { start: string; steps: Workflow["steps"] };

export type Options = {
  /** The bare repository the driver puts each checkpoint's start in and publish pushes results to. */
  trajectories: string;
  configuration: Configuration;
};

// SlopCodeBench's resume commands, which its harness runs before the agent at each checkpoint after
// the first: its snapshots leave .venv out, as ours do, and its prompt says to keep using it.
// Failures are ignored, as theirs are; their output goes to the transcript.
const venv = `if [ -f requirements.txt ]; then
  python -m venv .venv || true
  .venv/bin/pip install -r requirements.txt 2>&1 || true
fi
exec "$@"`;

const reserved = ["seed", "publish"];

export function benchmarkWorkflow({ trajectories, configuration }: Options) {
  const node = read(process.execPath);
  const git = (mode: "read" | "write") => ({
    ...contract,
    paths: [...contract.paths, node, read(bin), { path: trajectories, mode }],
  });
  const quick = { idle: 60, attempt: 300, transcript: 1024 * 1024, input: 1024 * 1024 };
  const clash = reserved.filter((name) => Object.hasOwn(configuration.steps, name));

  if (clash.length > 0) {
    throw new Error(`A configuration cannot name a step ${clash.join(" or ")}: the benchmark's.`);
  }

  // Every agent step working on the subject runs after its virtual environment is made again.
  const steps = Object.fromEntries(
    Object.entries(configuration.steps).map(([name, step]) => [
      name,
      step.kind === "agent" && step.workspace === "subject"
        ? { ...step, agent: { ...step.agent, harness: { ...step.agent.harness, run: ["sh", "-c", venv, "sh", ...step.agent.harness.run] } } }
        : step,
    ]),
  );

  return {
    start: "seed",
    steps: {
      // The branch named after the commission, which the driver made: the previous checkpoint's
      // result with the problem's assets restored, or the assets alone at the first.
      seed: {
        kind: "command",
        claims: ["start"],
        run: [process.execPath, join(bin, "seed.ts"), trajectories],
        workspace: "empty",
        inputs: {},
        on: { done: configuration.start },
        budget: 1,
        access: git("read"),
        limits: quick,
      },
      ...steps,
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
  } satisfies Workflow;
}
