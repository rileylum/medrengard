// The study driver: runs a study file's problem runs, each a configuration on a problem for one
// repeat, through driver/bench.ts, repeats first, a few at a time.
//
//   study.ts run <study.ts> [--problems a,b] [--concurrency n]
//                                              runs them, or the named problems' only, n at a time (2)
//   study.ts status <study.ts>                 where each problem run stands
//   study.ts report <study.ts>…                its summary, also written to results/<study>/report.md;
//                                              of several studies, their runs together, printed only
//   study.ts select <study.ts>                 a survey's iteration set, also results/<study>/selection.md
//   study.ts publish <study.ts>…               each study's scores into published/<study>/, and each
//                                              problem's median run into the examples repository
//
// Before anything runs it writes results/<study>/manifest.json: the study, the commits of its
// repository and Medrengard's, the runner's pins, the versions, and each configuration's hash. It
// refuses uncommitted changes, pins that do not match, and, once a study has started, any change
// to what its manifest names. Each run appends to results/<study>/invocations.jsonl what it was
// asked for, as that may differ between runs of one study. An escalation stops it starting problem
// runs; the running ones finish.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import type { Selection, Study } from "../study.ts";
import { createEngine } from "#medrengard/src/engine.ts";
import { render, representative, score, summarise, type Run } from "./report.ts";
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
    published: { type: "string", default: "published" },
    examples: { type: "string" },
  },
});

const usage =
  "Usage: study.ts run|status|report|select|publish <study.ts>… [--problems a,b] [--concurrency n] [--runner <argv>…] " +
  "[--calibration <argv>…] [--results <dir>] [--published <dir>] [--examples <repository>]";
const [command, ...paths] = positionals;
const file = paths[0];

if (!["run", "status", "report", "select", "publish"].includes(command ?? "") || file === undefined) {
  console.error(usage);
  process.exit(2);
}

function refuse(message: string): never {
  console.error(message);
  process.exit(2);
}

if (paths.length > 1 && !["report", "publish"].includes(command!)) refuse(`${command} takes one study.`);

type Loaded = {
  file: string;
  name: string;
  study: Study;
  selection: Selection | undefined;
  factory: string;
  // SAFETY: a benchmark factory's default export is the engine's options.
  options: Parameters<typeof createEngine>[0];
  trajectories: string;
  results: string;
  runs: string;
};

async function load(path: string): Promise<Loaded> {
  const file = resolve(path);
  const name = basename(file, ".ts");
  // SAFETY: a study file's default export is a Study, and its selection a Selection, as declared.
  const { default: study, selection } = (await import(file)) as { default: Study; selection?: Selection };
  const factory = resolve(dirname(file), study.factory);
  // SAFETY: a benchmark factory exports the engine's options and its trajectories repository.
  const loaded = (await import(factory)) as { default: Loaded["options"]; trajectories: string };
  const results = join(resolve(values.results), name);

  const { default: options, trajectories } = loaded;

  return { file, name, study, selection, factory, options, trajectories, results, runs: join(results, "runs") };
}

const studies = await Promise.all(paths.map(load));
const first = studies[0]!;
const { file: studyFile, name, study, selection, factory, results, runs } = first;
const workflows: Record<string, unknown> = first.options.workflows;

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
const configurationsOf = ({ study }: Loaded) => [
  ...study.configurations,
  ...(study.calibrate === undefined ? [] : [calibration]),
];

// Repeat first: every configuration's and problem's first repeat before any second, so a study
// stopped early has as many repeats of each.
const cellsOf = (loaded: Loaded, problems: readonly string[]): Cell[] => {
  const { study, name } = loaded;
  const repeats = (configuration: string) =>
    configuration === calibration ? (study.calibrate?.repeats ?? study.repeats) : study.repeats;

  return Array.from({ length: study.repeats }, (_, index) => index + 1).flatMap((repeat) =>
    configurationsOf(loaded)
      .filter((configuration) => repeat <= repeats(configuration))
      .flatMap((configuration) =>
        problems.map((problem) => ({ configuration, problem, repeat, run: `${name}-${configuration}-r${repeat}` })),
      ),
  );
};
const cells = (problems: readonly string[]) => cellsOf(first, problems);

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
  if (!existsSync(first.trajectories)) {
    execFileSync("git", ["init", "--quiet", "--bare", first.trajectories]);
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

// A problem run's lines as driver/bench.ts or calibration/cell.ts wrote them.
type Written = Run["lines"][number] & { commission: string; commit?: string; output?: string };

const readLines = (path: string): Written[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    // SAFETY: only driver/bench.ts and calibration/cell.ts write these lines.
    .map((line) => JSON.parse(line) as Written);

// Every problem run of a study that has begun.
const begun = (loaded: Loaded): (Omit<Run, "lines"> & { lines: Written[] })[] =>
  cellsOf(loaded, loaded.study.problems).flatMap(({ configuration, problem, repeat, run }) => {
    const path = join(loaded.runs, run, `${problem}.jsonl`);

    return existsSync(path) ? [{ configuration, problem, repeat, lines: readLines(path) }] : [];
  });

// A study's configurations as the summary heads them: ours by hash, as its manifest records them.
function heading(loaded: Loaded) {
  const path = join(loaded.results, "manifest.json");
  // SAFETY: this driver wrote it.
  const manifest = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as { configurations: Record<string, string> })
    : undefined;
  const { configurations, calibrate } = loaded.study;
  const ours = configurations.map((one) => `${one} ${manifest?.configurations[one]?.slice(0, 12) ?? "not started"}`);
  const theirs = calibrate === undefined ? [] : [`${calibration} (their harness, effort ${calibrate.effort})`];

  return `- ${loaded.name}: ${[...ours, ...theirs].join(", ")}`;
}

// The studies' runs together, against the first study's first configuration, the control. A
// configuration on a problem in two studies would count its runs twice, so it is refused.
function summary(group: readonly Loaded[]) {
  const seen = new Map<string, string>();

  for (const loaded of group) {
    for (const configuration of configurationsOf(loaded)) {
      for (const problem of loaded.study.problems) {
        const key = `${configuration} on ${problem}`;
        const before = seen.get(key);

        if (before !== undefined) refuse(`${key} is in both ${before} and ${loaded.name}: its runs would count twice.`);

        seen.set(key, loaded.name);
      }
    }
  }

  const title = group.map((loaded) => loaded.name).join(", ");
  const heads = group.map(heading).join("\n");
  const all = summarise(group.flatMap(begun), { control: group[0]!.study.configurations[0]! });

  return `# ${title}\n\n${heads}\n\n${render(all)}`;
}

function report() {
  const text = summary(studies);

  // Several studies together have no results directory of their own.
  if (studies.length === 1) writeFileSync(join(results, "report.md"), text);

  process.stdout.write(text);
}

// Publishing: each study's scores, without the machine's paths, and an example history per
// problem and configuration. The examples' names never change, so links to them keep working.
function publish() {
  const top = git(dirname(studyFile), "rev-parse", "--show-toplevel");
  const examples = resolve(values.examples ?? join(dirname(top), "medrengard-bench-examples"));

  if (!existsSync(examples)) execFileSync("git", ["init", "--quiet", "--bare", examples]);

  for (const loaded of studies) {
    publishScores(loaded);
    publishExamples(loaded, examples);
  }
}

// The paths no published file may name: the owner's home and where the results are.
const local = [homedir(), dirname(resolve(values.results))];

function publishScores(loaded: Loaded) {
  const written = new Map<string, string>();
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const jsonl = (lines: readonly unknown[]) => lines.map((line) => `${JSON.stringify(line)}\n`).join("");

  for (const entry of readdirSync(loaded.results).filter((entry) => /^manifest.*\.json$/.test(entry))) {
    // SAFETY: this driver wrote it.
    const manifest = JSON.parse(readFileSync(join(loaded.results, entry), "utf8")) as {
      repositories: { path: string }[];
    };
    const repositories = manifest.repositories.map((one) => ({ ...one, path: basename(one.path) }));

    written.set(entry, json({ ...manifest, repositories }));
  }

  for (const entry of ["invocations.jsonl", "selection.md"]) {
    if (existsSync(join(loaded.results, entry))) written.set(entry, readFileSync(join(loaded.results, entry), "utf8"));
  }

  written.set("report.md", summary([loaded]));

  const engine = createEngine(loaded.options);

  for (const { configuration, problem, repeat, lines } of begun(loaded)) {
    // Their harness's output is not published, so the path to it goes; an abandon says why.
    const published = lines.map(({ output: _, ...line }) => {
      if (line.status !== "abandoned") return line;

      const entries = engine.record(line.commission).entries;
      const escalation = entries
        .map((entry) =>
          "escalated" in entry ? entry.escalated : entry.entry === "escalation" ? entry.reason : undefined,
        )
        .findLast((reason) => reason !== undefined);
      const decision = entries.findLast((entry) => entry.entry === "decision" && entry.outcome === "abandon");

      return { ...line, escalation, feedback: decision?.entry === "decision" ? decision.feedback : undefined };
    });

    written.set(join("runs", `${loaded.name}-${configuration}-r${repeat}`, `${problem}.jsonl`), jsonl(published));
  }

  for (const [path, text] of written) {
    const named = local.find((one) => text.includes(one));

    if (named !== undefined) refuse(`${loaded.name}'s ${path} would publish ${named}: nothing was published.`);
  }

  const to = join(resolve(values.published), loaded.name);

  rmSync(to, { recursive: true, force: true });

  for (const [path, text] of written) {
    mkdirSync(dirname(join(to, path)), { recursive: true });
    writeFileSync(join(to, path), text);
  }
}

// Per problem and configuration, its median run's history as the branch
// <study>/<problem>/<configuration>, each graded checkpoint tagged <branch>/checkpoint-<n>. Ours
// are the run's own commits; theirs a commit per checkpoint of the snapshot their harness kept.
function publishExamples(loaded: Loaded, examples: string) {
  const groups = Map.groupBy(begun(loaded), (run) => `${run.problem}/${run.configuration}`);

  for (const [key, group] of groups) {
    const chosen = representative(group);
    const graded = [...new Map((chosen?.lines ?? []).map((line) => [line.checkpoint, line])).values()].filter(
      (line) => line.status === "finished",
    );

    if (chosen === undefined || graded.length === 0) continue;

    const branch = `${loaded.name}/${key}`;
    const commits =
      chosen.configuration === calibration
        ? theirHistory(examples, chosen.problem, graded)
        : ourHistory(examples, loaded.trajectories, branch, graded);

    graded.forEach((line, index) =>
      git(examples, "update-ref", `refs/tags/${branch}/checkpoint-${line.checkpoint}`, commits[index]!),
    );
    git(examples, "update-ref", `refs/heads/${branch}`, commits.at(-1)!);
  }
}

function ourHistory(examples: string, trajectories: string, branch: string, graded: readonly Written[]) {
  const last = graded.at(-1)!;

  git(examples, "fetch", "--quiet", "--no-tags", trajectories, `+refs/results/${last.commission}:refs/heads/${branch}`);

  return graded.map((line) => line.commit!);
}

// Their snapshots as commits, dated by when their harness wrote each, so publishing again makes
// the same commits.
function theirHistory(examples: string, problem: string, graded: readonly Written[]) {
  const scratch = mkdtempSync(join(tmpdir(), "medrengard-publish-"));
  const commits: string[] = [];

  try {
    for (const line of graded) {
      const snapshot = join(line.output!, problem, `checkpoint_${line.checkpoint}`, "snapshot");
      const date = `${Math.floor(statSync(snapshot).mtimeMs / 1000)} +0000`;
      const who = { name: "SlopCodeBench harness", email: "slopcodebench@localhost" };
      const env = {
        ...process.env,
        GIT_INDEX_FILE: join(scratch, "index"),
        GIT_AUTHOR_NAME: who.name,
        GIT_AUTHOR_EMAIL: who.email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: who.name,
        GIT_COMMITTER_EMAIL: who.email,
        GIT_COMMITTER_DATE: date,
      };
      const run = (...args: string[]) =>
        execFileSync("git", ["-c", "commit.gpgSign=false", "--git-dir", examples, "--work-tree", snapshot, ...args], {
          encoding: "utf8",
          env,
          cwd: snapshot,
        }).trim();

      rmSync(join(scratch, "index"), { force: true });
      run("add", "--all", "--force", ".");

      const parent = commits.at(-1) === undefined ? [] : ["-p", commits.at(-1)!];

      commits.push(run("commit-tree", run("write-tree"), ...parent, "-m", `checkpoint ${line.checkpoint}`));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  return commits;
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
else if (command === "publish") publish();
else await runStudy();
