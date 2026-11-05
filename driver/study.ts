// The study driver: runs a study file's problem runs, each a configuration on a problem for one
// repeat, through driver/bench.ts, repeats first, a few at a time.
//
//   study.ts run <study.ts> [--problems a,b] [--concurrency n]
//                                              runs them, or the named problems' only, n at a time (2)
//   study.ts status <study.ts>                 where each problem run stands
//   study.ts report <study.ts>                 its summary, also written to results/<study>/report.md
//   study.ts select <study.ts>                 a survey's iteration set, also results/<study>/selection.md
//
// Before anything runs it writes results/<study>/manifest.json: the study, the commits of its
// repository and Medrengard's, the runner's pins, the versions, and each configuration's hash. It
// refuses uncommitted changes, pins that do not match, and, once a study has started, any change
// to what its manifest names. Each run appends to results/<study>/invocations.jsonl what it was
// asked for, as that may differ between runs of one study. An escalation stops it starting problem
// runs; the running ones finish.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import type { Selection, Study } from "../study.ts";
import { render, score, summarise, type Run } from "./report.ts";
import { render as renderSelection, select, type Placement } from "./select.ts";
import { heldOut } from "../study.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runner: { type: "string", multiple: true },
    results: { type: "string", default: "results" },
    problems: { type: "string" },
    concurrency: { type: "string", default: "2" },
    calibration: { type: "string", multiple: true },
  },
});

const usage =
  "Usage: study.ts run|status|report|select <study.ts> [--problems a,b] [--concurrency n] [--runner <argv>…] [--calibration <argv>…] [--results <dir>]";
const [command, file] = positionals;

if (!["run", "status", "report", "select"].includes(command ?? "") || file === undefined) {
  console.error(usage);
  process.exit(2);
}

function refuse(message: string): never {
  console.error(message);
  process.exit(2);
}

const studyFile = resolve(file);
const name = basename(studyFile, ".ts");
// SAFETY: a study file's default export is a Study, and its selection a Selection, as declared.
const { default: study, selection } = (await import(studyFile)) as { default: Study; selection?: Selection };
const factory = resolve(dirname(studyFile), study.factory);
// SAFETY: a benchmark factory exports the engine's options and its trajectories repository.
const loaded = (await import(factory)) as { default: { workflows: Record<string, unknown> }; trajectories: string };
const { workflows } = loaded.default;
const results = join(resolve(values.results), name);
const runs = join(results, "runs");

const missing = study.configurations.filter((configuration) => !Object.hasOwn(workflows, configuration));

if (missing.length > 0) refuse(`The factory has no configuration named ${missing.join(", ")}.`);

const held = study.problems.filter((problem) => heldOut.includes(problem));

if (held.length > 0 && study.final !== true) {
  refuse(`${held.join(", ")} ${held.length === 1 ? "is" : "are"} held out: only a study marked final runs them.`);
}

const chosen = values.problems?.split(",") ?? study.problems;
const strays = chosen.filter((problem) => !study.problems.includes(problem));

if (strays.length > 0) refuse(`The study has no problem named ${strays.join(", ")}.`);

const concurrency = Number(values.concurrency);

if (!Number.isInteger(concurrency) || concurrency < 1) refuse(`--concurrency must be a whole number from 1.`);

type Cell = { configuration: string; problem: string; repeat: number; run: string };

// SlopCodeBench's own harness, in a calibrating study: after the study's own in each repeat.
const calibration = "slopcodebench";
const configurations = [...study.configurations, ...(study.calibrate === undefined ? [] : [calibration])];

const repeats = (configuration: string) =>
  configuration === calibration ? (study.calibrate?.repeats ?? study.repeats) : study.repeats;

// Repeat first: every configuration's and problem's first repeat before any second, so a study
// stopped early has as many repeats of each.
const cells = (problems: readonly string[]): Cell[] =>
  Array.from({ length: study.repeats }, (_, index) => index + 1).flatMap((repeat) =>
    configurations
      .filter((configuration) => repeat <= repeats(configuration))
      .flatMap((configuration) =>
        problems.map((problem) => ({ configuration, problem, repeat, run: `${name}-${configuration}-r${repeat}` })),
      ),
  );

type Line = { checkpoint: number; checkpoints: number; commission: string; status: string; step?: string; reason?: string };

function status() {
  for (const cell of cells(study.problems)) {
    const path = join(runs, cell.run, `${cell.problem}.jsonl`);
    const label = `${cell.run} ${cell.problem}`;

    if (!existsSync(path)) {
      console.log(`${label}: not started`);
      continue;
    }

    const last = new Map<number, Line>(
      readFileSync(path, "utf8")
        .trim()
        .split("\n")
        // SAFETY: only driver/bench.ts writes these lines.
        .map((line) => JSON.parse(line) as Line)
        .map((line) => [line.checkpoint, line]),
    );
    const lines = [...last.values()];
    const graded = lines.filter((line) => line.status === "finished").length;
    const total = lines[0]?.checkpoints ?? 0;
    const stopped = lines.find((line) => line.status !== "finished");

    if (stopped?.status === "abandoned") {
      console.log(`${label}: abandoned at checkpoint ${stopped.checkpoint}, ${graded} of ${total} graded`);
    } else if (stopped !== undefined) {
      const at = stopped.step === undefined ? "" : ` at ${stopped.step}`;

      console.log(`${stopped.commission} ${stopped.status}${at}: ${stopped.reason}`);
    } else {
      console.log(`${label}: ${graded} of ${total} graded${graded === total ? ", done" : ""}`);
    }
  }
}

const git = (directory: string, ...args: string[]) =>
  execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();

// The repository holding `path`: its commit, refusing uncommitted changes, so a result can be
// traced to the code that produced it.
function repository(path: string) {
  const top = git(path, "rev-parse", "--show-toplevel");

  if (git(top, "status", "--porcelain") !== "") refuse(`${top} has uncommitted changes: commit them first.`);

  return { path: top, commit: git(top, "rev-parse", "HEAD") };
}

const runner = values.runner ?? [new URL("../bin/runner.sh", import.meta.url).pathname];

// The files under each path, by content hash, so a skill edited in place changes its configuration's hash.
function files(path: string): Record<string, string> {
  if (!statSync(path).isDirectory()) {
    return { [path]: createHash("sha256").update(readFileSync(path)).digest("hex") };
  }

  return Object.assign({}, ...readdirSync(path).map((entry) => files(join(path, entry))));
}

function configurationHash(workflow: unknown) {
  // SAFETY: a workflow's steps, of which only agent steps' skills are read.
  const steps = Object.values((workflow as { steps: Record<string, { agent?: { skills?: string[] } }> }).steps);
  const skills = steps.flatMap((step) => step.agent?.skills ?? []).map(files);

  return createHash("sha256").update(JSON.stringify({ workflow, skills })).digest("hex");
}

function version(program: string) {
  try {
    return execFileSync(program, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function manifest() {
  const medrengard = dirname(realpathSync(fileURLToPath(import.meta.resolve("#medrengard/src/engine.ts"))));
  const pins = JSON.parse(execFileSync(runner[0]!, [...runner.slice(1), "pins"], { encoding: "utf8" })) as {
    matches: boolean;
  };

  if (!pins.matches) refuse(`The runner's checkouts do not match pins.json: ${JSON.stringify(pins)}`);

  return {
    study: { hash: createHash("sha256").update(readFileSync(studyFile)).digest("hex"), ...study },
    repositories: [repository(dirname(studyFile)), repository(medrengard)],
    pins,
    versions: { node: process.version, claude: version("claude") },
    configurations: Object.fromEntries(
      study.configurations.map((configuration) => [configuration, configurationHash(workflows[configuration])]),
    ),
  };
}

// Runs one problem run to its end or its first wait: 0 done, 3 waiting for the owner, else failed.
function cell({ configuration, problem, repeat, run }: Cell): Promise<number> {
  const theirs = [
    fileURLToPath(new URL("../calibration/cell.ts", import.meta.url)),
    "--problem",
    problem,
    "--run",
    run,
    "--repeat",
    String(repeat),
    "--effort",
    study.calibrate?.effort ?? "",
    "--results",
    runs,
    "--scratch",
    join(results, "calibration"),
    ...(values.calibration ?? []).flatMap((part) => ["--harness", part]),
  ];
  const ours = [
    fileURLToPath(new URL("bench.ts", import.meta.url)),
    "--factory",
    factory,
    "--configuration",
    configuration,
    "--problem",
    problem,
    "--run",
    run,
    "--repeat",
    String(repeat),
    "--results",
    runs,
    ...runner.flatMap((part) => ["--runner", part]),
  ];

  return new Promise((done) => {
    spawn(process.execPath, configuration === calibration ? theirs : ours, { stdio: ["ignore", "inherit", "inherit"] }).on(
      "close",
      (code) => done(code ?? 1),
    );
  });
}

async function runStudy() {
  const current = manifest();
  const path = join(results, "manifest.json");

  if (existsSync(path)) {
    // SAFETY: this driver wrote it.
    const started = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const changed = Object.keys(current).filter(
      (key) => !isDeepStrictEqual(started[key], JSON.parse(JSON.stringify(current[key as keyof typeof current]))),
    );

    if (changed.length > 0) refuse(`The study ${name} changed since it started: ${changed.join(", ")}.`);
  } else {
    mkdirSync(results, { recursive: true });
    writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
  }

  // Made once here, as problem runs started together would each try to make it.
  if (!existsSync(loaded.trajectories)) {
    execFileSync("git", ["init", "--quiet", "--bare", loaded.trajectories]);
  }

  appendFileSync(
    join(results, "invocations.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), problems: chosen, concurrency })}\n`,
  );

  const queue = cells(chosen);
  const ended = { failed: false, waiting: false };

  // A wait or a failure stops new problem runs; the running ones finish.
  const worker = async () => {
    for (let next = queue.shift(); next !== undefined && !ended.failed && !ended.waiting; next = queue.shift()) {
      const code = await cell(next);

      if (code === 3) ended.waiting = true;
      else if (code !== 0) ended.failed = true;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  if (ended.failed || ended.waiting) {
    console.error(`The study ${name} stopped for the owner: see study.ts status ${file}.`);
  }

  // A failure outranks a wait.
  process.exit(ended.failed ? 1 : ended.waiting ? 3 : 0);
}

// Every problem run of the study that has begun, against the first configuration, the control.
function report() {
  const begun: Run[] = cells(study.problems).flatMap(({ configuration, problem, repeat, run }) => {
    const path = join(runs, run, `${problem}.jsonl`);

    if (!existsSync(path)) return [];

    const lines = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      // SAFETY: only driver/bench.ts writes these lines.
      .map((line) => JSON.parse(line) as Run["lines"][number]);

    return [{ configuration, problem, repeat, lines }];
  });
  const text = `# ${name}\n\n${render(summarise(begun, { control: study.configurations[0]! }))}`;

  writeFileSync(join(results, "report.md"), text);
  process.stdout.write(text);
}

// One complete run's placement on the selection grid, refusing a run still waiting or running.
function placement(problem: string, run: string, path: string): Placement {
  const lines = existsSync(path)
    ? readFileSync(path, "utf8")
        .trim()
        .split("\n")
        // SAFETY: only driver/bench.ts writes these lines.
        .map((line) => JSON.parse(line) as Run["lines"][number])
    : [];
  const scores = score({ configuration: "", problem, repeat: 1, lines });

  if (scores?.solved === undefined || scores.core === undefined || scores.erosion === undefined) {
    refuse(`${problem} is not complete in ${run}: decide it, or run the study, before selecting.`);
  }

  return { problem, solved: scores.solved, core: scores.core, erosion: scores.erosion };
}

// A survey's problems by its first run, or the rerun the selection names, the current ones by theirs.
function selectIteration() {
  if (selection === undefined) refuse(`${name} names no selection.`);

  const surveyed = { study: name, run: `${name}-${study.configurations[0]}-r1` };
  const { current, reruns } = selection;
  const from = (problem: string, source: { study: string; run: string }) =>
    placement(problem, source.run, join(resolve(values.results), source.study, "runs", source.run, `${problem}.jsonl`));
  const placements = [
    ...study.problems.map((problem) => from(problem, reruns?.problems.includes(problem) ? reruns : surveyed)),
    ...current.problems.map((problem) => from(problem, current)),
  ];
  const text = `# ${name}\n\n${renderSelection(select(placements, { current: current.problems, perCell: selection.perCell, seed: selection.seed }))}`;

  writeFileSync(join(results, "selection.md"), text);
  process.stdout.write(text);
}

if (command === "status") status();
else if (command === "report") report();
else if (command === "select") selectIteration();
else await runStudy();
