// The driver: takes one problem through its checkpoints under one configuration, one commission
// each, in order. It builds each checkpoint's start, commissions it, collects the commit publish
// pushed and grades it with the runner, outside the factory, so no step sees the tests. One line
// per checkpoint goes to <results>/<run>/<problem>.jsonl.
//
// It can be run again on the same run: a graded checkpoint is skipped, a finished one graded, and
// an escalated one waits for the owner's decision (exit 3). A retry continues the problem; an
// abandon ends it, as the configuration's failure.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createEngine } from "@medrengard/core/src/engine.ts";
import { data, scratch } from "../data.ts";

const { values } = parseArgs({
  options: {
    factory: { type: "string" },
    configuration: { type: "string" },
    repeat: { type: "string" },
    runner: { type: "string", multiple: true },
    problem: { type: "string" },
    run: { type: "string" },
    results: { type: "string", default: join(data, "results") },
    checkpoints: { type: "string" },
  },
});

const usage =
  "Usage: bench.ts --factory <path> --configuration <name> --problem <name> --run <id> [--repeat <k>] [--runner <argv>…] [--results <dir>] [--checkpoints <n>]";

if (
  values.factory === undefined ||
  values.configuration === undefined ||
  values.problem === undefined ||
  values.run === undefined
) {
  console.error(usage);
  process.exit(2);
}

const { factory, configuration, problem: name, run } = values;
const repeat = values.repeat === undefined ? undefined : Number(values.repeat);
const runner = values.runner ?? [new URL("../bin/runner.sh", import.meta.url).pathname];
const results = resolve(values.results);

// SAFETY: a benchmark factory exports the engine's options and its trajectories repository.
const loaded = (await import(resolve(factory))) as {
  default: Parameters<typeof createEngine>[0];
  trajectories: string;
};
const { trajectories } = loaded;

mkdirSync(dirname(loaded.default.log), { recursive: true });

const engine = createEngine(loaded.default);

if (!Object.hasOwn(loaded.default.workflows, configuration)) {
  console.error(`The factory has no configuration named ${configuration}.`);
  process.exit(2);
}

type Problem = { checkpoints: number; assets: { source: string; path: string }[]; prompts: string[] };
// SlopCodeBench's eval-snapshot report, and its scb-check scores under quality.
type Grade = {
  pass_counts: Record<string, number>;
  total_counts: Record<string, number>;
  quality: { verbosity?: number; erosion?: number };
};

const runnerJson = (...args: string[]) =>
  JSON.parse(execFileSync(runner[0]!, [...runner.slice(1), ...args], { encoding: "utf8" }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=Medrengard bench", "-c", "user.email=medrengard@localhost", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

// SAFETY: the runner's problem command prints a Problem.
const problem = runnerJson("problem", name) as Problem;
const count = values.checkpoints === undefined ? problem.checkpoints : Number(values.checkpoints);

if (!existsSync(trajectories)) execFileSync("git", ["init", "--quiet", "--bare", trajectories]);

const out = join(results, run);

mkdirSync(out, { recursive: true });

const lines = join(out, `${name}.jsonl`);
const record = (line: object) =>
  appendFileSync(lines, `${JSON.stringify({ configuration, ...(repeat === undefined ? {} : { repeat }), checkpoints: count, ...line })}\n`);

// What this run recorded before, the last line of each checkpoint winning.
const recorded = new Map<number, { status: string }>(
  (existsSync(lines) ? readFileSync(lines, "utf8").trim().split("\n").filter(Boolean) : [])
    // SAFETY: only this driver writes these lines.
    .map((line) => JSON.parse(line) as { checkpoint: number; status: string })
    .map((line) => [line.checkpoint, line]),
);

// The checkpoint's start, on the branch named after its commission: the previous result, or
// nothing at the first, with the problem's assets put back as they are, as SlopCodeBench's
// harness does before each checkpoint.
function start(commission: string, previous: string | undefined) {
  const work = scratch("medrengard-bench-start-");

  try {
    git(work, "init", "--quiet");

    if (previous !== undefined) {
      git(work, "fetch", "--quiet", trajectories, `refs/results/${previous}`);
      git(work, "checkout", "--quiet", "FETCH_HEAD");
    }

    for (const asset of problem.assets) {
      rmSync(join(work, asset.path), { recursive: true, force: true });
      cpSync(asset.source, join(work, asset.path), { recursive: true });
      git(work, "add", "--force", "--", asset.path);
    }

    // A first checkpoint with no assets starts from an empty commit, which the start kind accepts.
    if (previous === undefined || git(work, "status", "--porcelain") !== "") {
      git(work, "commit", "--quiet", "--allow-empty", "-m", `start of ${commission}`);
    }

    git(work, "push", "--quiet", "--force", trajectories, `HEAD:refs/heads/${commission}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// What Claude Code's stream-json result line says an attempt cost, or null without one.
function costOf(transcript: string) {
  const result = transcript
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        // SAFETY: only the fields read below are used, each checked by its use.
        return JSON.parse(line) as {
          type?: string;
          total_cost_usd?: number;
          num_turns?: number;
          duration_ms?: number;
        };
      } catch {
        return {};
      }
    })
    .findLast((event) => event.type === "result");

  return result ?? null;
}

// The configuration's cost: each agent attempt's, summed, with how many attempts there were.
// Seconds are Claude Code's own session time, as SlopCodeBench's summary reports; an attempt's time
// also holds what runs before the agent, such as remaking the virtual environment. Null when no
// agent attempt reported one; a sum is left out when any attempt did not report its part.
function cost(commission: string, agents: Set<string>) {
  const attempts = engine
    .record(commission)
    .entries.filter((entry) => entry.entry === "attempt" && agents.has(entry.step) && !("running" in entry));
  const results = attempts
    .map((entry) => (entry.entry === "attempt" ? costOf(engine.transcript(commission, entry.attempt).toString()) : null))
    .filter((result) => result !== null);

  if (results.length === 0) return null;

  const sum = (values: (number | undefined)[]) =>
    values.every((value) => value !== undefined) ? values.reduce((a, b) => a + b, 0) : undefined;
  const ms = sum(results.map((result) => result.duration_ms));

  return {
    usd: sum(results.map((result) => result.total_cost_usd)),
    turns: sum(results.map((result) => result.num_turns)),
    seconds: ms === undefined ? undefined : ms / 1000,
    attempts: attempts.length,
  };
}

// The subscription's weekly use, a fraction, as Claude Code last reported it in the configuration's
// agent attempts, and when it was read: the whole account's use, not this run's alone.
function weekly(commission: string, agents: Set<string>) {
  const readings = engine
    .record(commission)
    .entries.flatMap((entry) =>
      entry.entry === "attempt" && agents.has(entry.step) && !("running" in entry)
        ? [weeklyOf(engine.transcript(commission, entry.attempt).toString())]
        : [],
    )
    .filter((reading) => reading !== undefined);
  const used = readings.at(-1);

  return used === undefined ? {} : { weekly: { used, at: new Date().toISOString() } };
}

function weeklyOf(transcript: string) {
  return transcript
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        // SAFETY: only the field read below is used, checked by its use.
        return JSON.parse(line) as {
          type?: string;
          rate_limit_info?: { unifiedWindows?: { seven_day?: { utilization?: number } } };
        };
      } catch {
        return {};
      }
    })
    .map((event) => (event.type === "rate_limit_event" ? event.rate_limit_info?.unifiedWindows?.seven_day?.utilization : undefined))
    .findLast((used) => used !== undefined);
}

// The time the configuration's agent attempts took, summed.
function timing(commission: string, agents: Set<string>) {
  const spans = engine
    .record(commission)
    .entries.flatMap((entry) =>
      entry.entry === "attempt" &&
      agents.has(entry.step) &&
      "ended" in entry &&
      entry.started !== undefined &&
      entry.ended !== undefined
        ? [entry.ended - entry.started]
        : [],
    );

  return spans.length === 0 ? {} : { seconds: spans.reduce((a, b) => a + b, 0) / 1000 };
}

// The definition the commission runs on, by hash, so lines that ran on different ones can be told apart.
const definitionOf = (commission: string) =>
  createHash("sha256").update(JSON.stringify(engine.definition(commission))).digest("hex");

function grade(commit: string, n: number, output = join(out, name, `checkpoint_${n}`)) {
  const snapshot = scratch("medrengard-bench-snapshot-");

  try {
    execFileSync("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", trajectories, commit, snapshot]);

    // SAFETY: the runner's grade command prints SlopCodeBench's eval-snapshot report.
    return runnerJson("grade", snapshot, name, String(n), output) as Grade;
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

// Python's test files, by pytest's names: what an agent's own tests add is left out of its code's
// scores, as many simple test functions would otherwise dilute erosion and verbosity. lazy: Python's
// names only, as every SlopCodeBench problem is Python; a problem in another language is the trigger.
const isTest = (path: string) => {
  const parts = path.split("/");
  const file = parts.at(-1)!;

  return (
    parts.slice(0, -1).some((part) => part === "tests" || part === "test") ||
    /^test_.*\.py$/.test(file) ||
    file.endsWith("_test.py") ||
    file === "conftest.py"
  );
};

// The erosion and verbosity of the commit's code alone: scb-check, as grading runs it, on the commit
// without its tests.
function codeQuality(commit: string) {
  const snapshot = scratch("medrengard-bench-code-");

  try {
    execFileSync("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", trajectories, commit, snapshot]);

    for (const path of readdirSync(snapshot, { recursive: true, encoding: "utf8" })) {
      if (isTest(path)) rmSync(join(snapshot, path), { recursive: true, force: true });
    }

    // SAFETY: the runner's quality command prints scb-check's report.
    const { erosion, verbosity } = runnerJson("quality", snapshot, name) as { erosion: number; verbosity: number };

    return { erosion, verbosity };
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

// The configuration's agent steps, whose attempts are its cost.
const steps = loaded.default.workflows[configuration]!.steps as Record<string, { kind: string }>;
const agents = new Set(Object.entries(steps).flatMap(([step, { kind }]) => (kind === "agent" ? [step] : [])));
const exists = (commission: string) => engine.commissions().some((listed) => listed.commission === commission);

let previous: string | undefined;

for (let n = 1; n <= count; n += 1) {
  const commission = `${run}-${name}-${n}`;
  const before = recorded.get(n);

  if (before?.status === "finished") {
    previous = commission;
    continue;
  }

  if (before?.status === "abandoned") process.exit(0);

  if (!exists(commission)) {
    start(commission, previous);
    engine.commission(configuration, commission, { title: `${name} checkpoint ${n}`, body: problem.prompts[n - 1]! });
  }

  // A commission left escalated waits for the owner; one they decided, or one interrupted, goes on.
  const current = engine.state(commission);
  const waiting = current.status === "escalated" || current.status === "awaiting";
  const state = waiting || current.status === "finished" ? current : await engine.advance(commission);
  const spent = {
    ...timing(commission, agents),
    cost: cost(commission, agents),
    ...weekly(commission, agents),
    definition: definitionOf(commission),
  };

  if (state.status === "finished" && state.by === "abandoned") {
    record({ checkpoint: n, commission, status: "abandoned", ...spent });
    console.error(`${commission} abandoned by the owner: the problem ends here.`);
    process.exit(0);
  }

  if (state.status !== "finished") {
    const reason = state.status === "escalated" ? state.reason : state.status;
    const step = "step" in state ? state.step.name : undefined;

    // A re-run while it still waits records nothing new.
    if (!waiting) record({ checkpoint: n, commission, status: state.status, step, reason, ...spent });

    console.error(`${commission} ${state.status} at ${step}: ${reason}`);
    process.exit(3);
  }

  const claimed = engine
    .record(commission)
    .entries.flatMap((entry) => (entry.entry === "attempt" && "artifacts" in entry ? entry.artifacts : []))
    .findLast((claim) => claim.artifact.kind === "commit");
  const commit = claimed?.artifact.fields.sha;

  if (commit === undefined || git(trajectories, "rev-parse", `refs/results/${commission}`) !== commit) {
    throw new Error(`${commission} finished, but refs/results/${commission} is not the last commit claimed.`);
  }

  const graded = grade(commit, n);
  // The commits the configuration made in this checkpoint before the one it claimed, such as its
  // work before a review, each graded as the claimed one is, so a study sees what each step changed.
  const commits = git(trajectories, "rev-list", "--reverse", "--first-parent", `refs/heads/${commission}..${commit}`)
    .split("\n")
    .filter((one) => one !== "" && one !== commit)
    .map((one) => ({ commit: one, grade: grade(one, n, join(out, name, `checkpoint_${n}`, "commits", one)) }));
  const solved = (graded.total_counts.Core ?? 0) > 0 && graded.pass_counts.Core === graded.total_counts.Core;

  const { verbosity, erosion } = graded.quality;
  const code = codeQuality(commit);

  record({ checkpoint: n, commission, status: "finished", commit, ...spent, solved, verbosity, erosion, code, grade: graded, commits });
  console.log(
    `${commission}: ${solved ? "solved" : "not solved"}, Core ${graded.pass_counts.Core ?? 0}/${graded.total_counts.Core ?? 0}` +
      `, verbosity ${verbosity}, erosion ${erosion}` +
      `${spent.seconds === undefined ? "" : `, ${spent.seconds} s`}${spent.cost?.usd === undefined ? "" : `, $${spent.cost.usd}`}`,
  );

  previous = commission;
}
