// The driver: takes one problem through its checkpoints, one commission each, in order. It builds
// each checkpoint's start, commissions it, collects the commit publish pushed and grades it with
// the runner, outside the factory, so no step sees the tests. One line per checkpoint goes to
// <results>/<run>/<problem>.jsonl; an escalated checkpoint stops the problem for the owner.
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createEngine } from "#medrengard/src/engine.ts";

const { values } = parseArgs({
  options: {
    factory: { type: "string" },
    runner: { type: "string", multiple: true },
    problem: { type: "string" },
    run: { type: "string" },
    results: { type: "string", default: "results" },
    checkpoints: { type: "string" },
  },
});

const usage =
  "Usage: bench.ts --factory <path> --problem <name> --run <id> [--runner <argv>…] [--results <dir>] [--checkpoints <n>]";

if (values.factory === undefined || values.problem === undefined || values.run === undefined) {
  console.error(usage);
  process.exit(2);
}

const { factory, problem: name, run } = values;
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

const record = (line: object) => appendFileSync(join(out, `${name}.jsonl`), `${JSON.stringify(line)}\n`);

// The checkpoint's start, on the branch named after its commission: the previous result, or
// nothing at the first, with the problem's assets put back as they are, as SlopCodeBench's
// harness does before each checkpoint.
function start(commission: string, previous: string | undefined) {
  const work = mkdtempSync(join(tmpdir(), "medrengard-bench-start-"));

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

// What Claude Code's stream-json result line says the attempt cost, or null without one.
function cost(transcript: string) {
  const result = transcript
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        // SAFETY: only the fields read below are used, each checked by its use.
        return JSON.parse(line) as { type?: string; total_cost_usd?: number; num_turns?: number; usage?: object };
      } catch {
        return {};
      }
    })
    .findLast((event) => event.type === "result");

  return result === undefined
    ? null
    : { usd: result.total_cost_usd, turns: result.num_turns, ...(result.usage === undefined ? {} : { usage: result.usage }) };
}

function grade(commit: string, n: number) {
  const snapshot = mkdtempSync(join(tmpdir(), "medrengard-bench-snapshot-"));

  try {
    execFileSync("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", trajectories, commit, snapshot]);

    // SAFETY: the runner's grade command prints SlopCodeBench's eval-snapshot report.
    return runnerJson("grade", snapshot, name, String(n), join(out, name, `checkpoint_${n}`)) as Grade;
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

let previous: string | undefined;

for (let n = 1; n <= count; n += 1) {
  const commission = `${run}-${name}-${n}`;

  start(commission, previous);
  engine.commission("benchmark", commission, { title: `${name} checkpoint ${n}`, body: problem.prompts[n - 1]! });

  const state = await engine.advance(commission);
  const { entries } = engine.record(commission);
  const implement = entries.findLast((entry) => entry.entry === "attempt" && entry.step === "implement");
  const timing =
    implement?.entry === "attempt" && implement.started !== undefined && "ended" in implement && implement.ended !== undefined
      ? { seconds: (implement.ended - implement.started) / 1000 }
      : {};
  const spent =
    implement?.entry === "attempt" ? cost(engine.transcript(commission, implement.attempt).toString()) : null;

  if (state.status !== "finished" || state.by !== "end") {
    const reason = state.status === "escalated" ? state.reason : state.status;
    const step = "step" in state ? state.step.name : undefined;

    record({ checkpoint: n, commission, status: state.status, reason, ...timing, cost: spent });
    console.error(`${commission} ${state.status} at ${step}: ${reason}`);
    process.exit(1);
  }

  const claimed = implement?.entry === "attempt" && "artifacts" in implement ? implement.artifacts[0] : undefined;
  const commit = claimed?.artifact.fields.sha;

  if (commit === undefined || git(trajectories, "rev-parse", `refs/results/${commission}`) !== commit) {
    throw new Error(`${commission} finished, but refs/results/${commission} is not the commit implement claimed.`);
  }

  const graded = grade(commit, n);
  const solved = (graded.total_counts.Core ?? 0) > 0 && graded.pass_counts.Core === graded.total_counts.Core;

  const { verbosity, erosion } = graded.quality;

  record({ checkpoint: n, commission, status: "finished", commit, ...timing, cost: spent, solved, verbosity, erosion, grade: graded });
  console.log(
    `${commission}: ${solved ? "solved" : "not solved"}, Core ${graded.pass_counts.Core ?? 0}/${graded.total_counts.Core ?? 0}` +
      `, verbosity ${verbosity}, erosion ${erosion}` +
      `${timing.seconds === undefined ? "" : `, ${timing.seconds} s`}${spent?.usd === undefined ? "" : `, $${spent.usd}`}`,
  );

  previous = commission;
}
