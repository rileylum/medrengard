// The study driver, outside in: a study file in a worktree of the repository as the working tree
// has it, run over the toy problem with the dry stub's configurations and a fake runner, so no
// Docker, network or spend.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { createEngine } from "@medrengard/core/src/engine.ts";
import { repository, toy, type Result } from "./toy.ts";

type Fields = {
  configurations: string[];
  problems: string[];
  repeats: number;
  final?: boolean;
  calibrate?: { effort: string; repeats?: number };
  selection?: {
    current: { problems: string[]; study: string; run: string };
    reruns?: { problems: string[]; study: string; run: string };
    perCell: number;
    seed: number;
  };
};

const gitIn =
  (directory: string) =>
  (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@localhost", "-C", directory, ...args], {
      encoding: "utf8",
    }).trim();

// The repository as the working tree has it, committed in a repository of its own, its main
// checkout, with a worktree beside it as a study runs from: the driver and Medrengard under test are
// the working tree's, whatever it has not committed. Each has Medrengard linked, as npm links it.
function copy(directory: string) {
  const root = join(repository, "..");
  const main = join(directory, "repository");
  const worktree = join(directory, "checkout");
  const files = gitIn(root)("ls-files", "-z", "-co", "--exclude-standard", "--", ".gitignore", "package.json", "core", "bench")
    .split("\0")
    .filter((file) => file !== "" && !file.startsWith("bench/published/") && existsSync(join(root, file)));

  for (const file of files) cpSync(join(root, file), join(main, file));

  gitIn(main)("init", "--quiet");
  gitIn(main)("add", "-A");
  gitIn(main)("commit", "--quiet", "-m", "copy");
  gitIn(main)("worktree", "add", "--quiet", "--detach", worktree);

  for (const at of [main, worktree]) {
    mkdirSync(join(at, "node_modules", "@medrengard"), { recursive: true });
    symlinkSync("../../core", join(at, "node_modules", "@medrengard", "core"));
  }

  return { main, worktree };
}

// The toy problem with a study `name` over it, committed in a worktree of a copy of the repository.
function study(t: TestContext, prompts: string[], fields: Fields, name = "trial") {
  const problem = toy(t, prompts);
  const { main, worktree } = copy(problem.directory);
  const studies = join(worktree, "trials");
  const file = join(studies, `${name}.ts`);

  mkdirSync(studies);

  const git = gitIn(worktree);
  const fileOf = (study: string) => join(studies, `${study}.ts`);
  // A study file in `at`, over the toy factory, importing the study module beside the driver that runs it.
  const writeIn = (at: string, { selection, ...changed }: Fields, as = name) => {
    writeFileSync(
      join(at, `${as}.ts`),
      `import { defineStudy } from ${JSON.stringify(join(worktree, "bench", "study.ts"))};
       export default defineStudy(${JSON.stringify({ factory: relative(at, problem.factory), ...changed })});
       export const selection = ${JSON.stringify(selection)};
      `,
    );
  };
  const write = (fields: Fields, as = name) => writeIn(studies, fields, as);

  write(fields);
  git("add", "-A");
  git("commit", "--quiet", "-m", "study");

  // SlopCodeBench's harness, faked: it writes their per-checkpoint results for the checkpoints it
  // was told to reach, out of the two it expects, under the scratch directory it is given.
  const harness = join(problem.directory, "harness.ts");

  writeFileSync(
    harness,
    `import { mkdirSync, writeFileSync } from "node:fs";
     import { join } from "node:path";
     const [problem, effort] = process.argv.slice(2);
     const reached = Number(process.env.FAKE_REACHED ?? 2);
     const out = join(process.env.SCRATCH, "outputs", "opus-5.5", "claude_code-2.1.318_just-solve_" + effort + "_0");
     mkdirSync(out, { recursive: true });
     writeFileSync(join(out, "result.json"), JSON.stringify({ expected_checkpoints: 2 }));
     const row = (idx) => ({
       problem, idx, state: Number(process.env.FAKE_ERROR) === idx ? "error" : "ran",
       core_passed: idx === 1 ? 1 : 0, core_total: 1,
       functionality_passed: 3, functionality_total: 4, error_passed: 1, error_total: 1,
       regression_passed: 0, regression_total: 0, duration: 30, cost: 0.5, steps: 4,
       verbosity: 0.3, erosion: 0.6,
     });
     writeFileSync(join(out, "checkpoint_results.jsonl"),
       Array.from({ length: reached }, (_, i) => JSON.stringify(row(i + 1)) + "\\n").join(""));
     for (let idx = 1; idx <= reached; idx++) {
       const snapshot = join(out, problem, "checkpoint_" + idx, "snapshot");
       mkdirSync(snapshot, { recursive: true });
       writeFileSync(join(snapshot, "a.py"), "theirs " + idx + "\\n");
     }
    `,
  );

  const published = join(problem.directory, "published");
  const examples = join(problem.directory, "examples.git");
  const driver = (...args: string[]) => run({}, ...args);
  const run = (env: Record<string, string>, ...args: string[]) => invoke(worktree, env, [file], args);
  // The driver on several studies of this repository, by name.
  const across = (names: string[], ...args: string[]) => invoke(worktree, {}, names.map(fileOf), args);
  // The driver of the checkout `from` on study files.
  const invoke = (from: string, env: Record<string, string>, files: string[], args: string[]) =>
    spawnSync(
      process.execPath,
      [
        join(from, "bench", "driver", "study.ts"),
        ...args,
        ...files,
        "--runner",
        process.execPath,
        "--runner",
        problem.runner,
        "--results",
        problem.results,
        "--calibration",
        process.execPath,
        "--calibration",
        harness,
        "--published",
        published,
        "--examples",
        examples,
      ],
      { encoding: "utf8", cwd: problem.directory, env: { ...process.env, ...env } },
    );

  const lines = (run: string): Result[] =>
    readFileSync(join(problem.results, name, "runs", run, "toy.jsonl"), "utf8")
      .trim()
      .split("\n")
      // SAFETY: the driver writes one result per line.
      .map((line) => JSON.parse(line) as Result);

  const commissions = async () => {
    const { default: options } = await import(problem.factory);

    return createEngine(options)
      .commissions()
      .map((listed) => listed.commission);
  };

  return {
    ...problem,
    file,
    git,
    write,
    writeIn,
    invoke,
    main,
    worktree,
    driver,
    run,
    across,
    lines,
    commissions,
    published,
    examples,
    manifest: join(problem.results, name, "manifest.json"),
  };
}

test(
  "a study runs every configuration, problem and repeat, repeats first, and records what it ran on",
  { timeout: 120_000 },
  async (t) => {
    const { driver, lines, commissions, manifest, worktree, git } = study(t, ["Do one.\n", "Do two.\n"], {
      configurations: ["stub", "polished"],
      problems: ["toy"],
      repeats: 2,
    });

    const ran = driver("run", "--concurrency", "2");

    assert.equal(ran.status, 0, ran.stderr);

    for (const configuration of ["stub", "polished"]) {
      for (const repeat of [1, 2]) {
        const results = lines(`trial-${configuration}-r${repeat}`);

        assert.deepEqual(
          results.map((result) => [result.configuration, result.repeat, result.checkpoint, result.status]),
          [
            [configuration, repeat, 1, "finished"],
            [configuration, repeat, 2, "finished"],
          ],
        );
      }
    }

    // Both first repeats started before either second one.
    const started = (await commissions()).filter((commission) => commission.endsWith("-toy-1"));

    assert.deepEqual(started.slice(0, 2).sort(), ["trial-polished-r1-toy-1", "trial-stub-r1-toy-1"]);

    // SAFETY: the driver writes the manifest as JSON.
    const recorded = JSON.parse(readFileSync(manifest, "utf8")) as {
      study: { hash: string; repeats: number; concurrency?: number };
      repositories: { path: string; commit: string }[];
      pins: { runner: string; python: string };
      versions: { node: string };
      configurations: Record<string, string>;
    };

    assert.match(recorded.study.hash, /^[0-9a-f]{64}$/);
    assert.equal(recorded.study.concurrency, undefined);

    // How it ran is recorded per invocation, as it may change between them.
    const invocations = readFileSync(join(manifest, "..", "invocations.jsonl"), "utf8")
      .trim()
      .split("\n")
      // SAFETY: the driver writes one invocation per line.
      .map((line) => JSON.parse(line) as { at: string; problems: string[]; concurrency: number });

    assert.deepEqual(
      invocations.map(({ problems, concurrency }) => ({ problems, concurrency })),
      [{ problems: ["toy"], concurrency: 2 }],
    );
    // One checkout names the study, the driver and Medrengard.
    assert.deepEqual(recorded.repositories, [{ path: realpathSync(worktree), commit: git("rev-parse", "HEAD") }]);
    assert.deepEqual(recorded.pins, { runner: "fake", problems: "fake", python: "3.12.0", matches: true });
    assert.equal(recorded.versions.node, process.version);
    assert.notEqual(recorded.configurations.stub, recorded.configurations.polished);

    // The summary compares polished with stub, the first configuration, over both repeats.
    const report = driver("report");

    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /\| polished \| toy \| 2 \| 1 \(1–1\) \|/);
    assert.match(report.stdout, /\| polished \| stub \| 0 \[0, 0\] \|/);
    assert.equal(readFileSync(join(manifest, "..", "report.md"), "utf8"), report.stdout);
  },
);

test(
  "a study run again goes on where it stopped, and refuses a study changed since it started",
  { timeout: 120_000 },
  async (t) => {
    const fields = { configurations: ["stub"], problems: ["toy"], repeats: 1 };
    const { driver, commissions, write, git } = study(t, ["Do one.\n"], fields);

    assert.equal(driver("run").status, 0);

    const before = await commissions();
    const again = driver("run", "--concurrency", "3");

    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(await commissions(), before);

    write({ ...fields, repeats: 2 });
    git("commit", "--quiet", "-am", "more repeats");

    const changed = driver("run");

    assert.equal(changed.status, 2);
    assert.match(changed.stderr, /changed since it started: study/);
    assert.deepEqual(await commissions(), before);
  },
);

test(
  "a study runs up to the repeat it is asked for, and on to the next ones when asked again",
  { timeout: 120_000 },
  async (t) => {
    const { driver, commissions, manifest } = study(t, ["Do one.\n"], {
      configurations: ["stub"],
      problems: ["toy"],
      repeats: 3,
    });

    const first = driver("run", "--repeats", "1");

    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(await commissions(), ["trial-stub-r1-toy-1"]);

    const beyond = driver("run", "--repeats", "4");

    assert.equal(beyond.status, 2);
    assert.match(beyond.stderr, /--repeats must be a whole number from 1 to the study's 3/);

    // Up to repeat 3 runs the two not yet run; the study's own repeats are the default.
    const rest = driver("run", "--repeats", "3");

    assert.equal(rest.status, 0, rest.stderr);
    assert.deepEqual((await commissions()).sort(), ["trial-stub-r1-toy-1", "trial-stub-r2-toy-1", "trial-stub-r3-toy-1"]);
    assert.equal(driver("run").status, 0);
    assert.equal((await commissions()).length, 3);

    // SAFETY: the driver writes one invocation per line.
    const invocations = readFileSync(join(manifest, "..", "invocations.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { repeats: number });

    assert.deepEqual(
      invocations.map(({ repeats }) => repeats),
      [1, 3, 3],
    );
  },
);

test(
  "an escalation stops a study starting problem runs, and its status lists it for the owner",
  { timeout: 120_000 },
  async (t) => {
    const { driver, commissions } = study(t, ["Do one.\ndry: exit1\n"], {
      configurations: ["stub"],
      problems: ["toy"],
      repeats: 2,
    });

    const ran = driver("run", "--concurrency", "1");

    assert.equal(ran.status, 3, ran.stderr);
    assert.deepEqual(await commissions(), ["trial-stub-r1-toy-1"]);

    const status = driver("status");

    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /trial-stub-r1-toy-1 escalated at implement: /);
    assert.match(status.stdout, /trial-stub-r2 toy: not started/);
  },
);

test(
  "a study refuses held-out problems unless final, a configuration the factory lacks, and a changed tree",
  { timeout: 120_000 },
  async (t) => {
    const fields = { configurations: ["stub"], problems: ["toy"], repeats: 1 };
    const { driver, write, git, results } = study(t, ["Do one.\n"], fields);

    write({ ...fields, problems: ["xjq"] });
    git("commit", "--quiet", "-am", "held out");
    assert.match(driver("run").stderr, /xjq is held out/);

    write({ ...fields, configurations: ["missing"] });
    git("commit", "--quiet", "-am", "missing");
    assert.match(driver("run").stderr, /no configuration named missing/);

    // Uncommitted: what ran could not be named.
    write(fields);

    const dirty = driver("run");

    assert.equal(dirty.status, 2);
    assert.match(dirty.stderr, /has uncommitted changes/);
    assert.ok(!existsSync(join(results, "trial")));
  },
);

test(
  "a study refuses the repository's main checkout, and a study file outside the driver's checkout",
  { timeout: 120_000 },
  async (t) => {
    const fields = { configurations: ["stub"], problems: ["toy"], repeats: 1 };
    const { invoke, writeIn, main, worktree, directory, results } = study(t, ["Do one.\n"], fields);

    // The main checkout's own driver, on a study committed there.
    const trials = join(main, "trials");

    mkdirSync(trials);
    writeIn(trials, fields);
    gitIn(main)("add", "-A");
    gitIn(main)("commit", "--quiet", "-m", "study");

    const fromMain = invoke(main, {}, [join(trials, "trial.ts")], ["run"]);

    assert.equal(fromMain.status, 2);
    assert.match(fromMain.stderr, /is the repository's main checkout/);

    // A worktree of another repository, run by this one's driver: what ran would need two commits.
    const other = join(directory, "other");
    const elsewhere = join(directory, "elsewhere");

    mkdirSync(other);
    gitIn(other)("init", "--quiet");
    gitIn(other)("commit", "--quiet", "--allow-empty", "-m", "empty");
    gitIn(other)("worktree", "add", "--quiet", "--detach", elsewhere);
    writeIn(elsewhere, fields);
    gitIn(elsewhere)("add", "-A");
    gitIn(elsewhere)("commit", "--quiet", "-m", "study");

    const outside = invoke(worktree, {}, [join(elsewhere, "trial.ts")], ["run"]);

    assert.equal(outside.status, 2);
    assert.match(outside.stderr, /are not in one checkout/);
    assert.ok(!existsSync(join(results, "trial")));
  },
);

test(
  "a calibrating study runs SlopCodeBench's own harness as one more configuration, for its own repeats, its results read as ours",
  { timeout: 120_000 },
  async (t) => {
    const { driver, lines, results } = study(t, ["Do one.\n", "Do two.\n"], {
      configurations: ["stub"],
      problems: ["toy"],
      repeats: 2,
      calibrate: { effort: "medium", repeats: 1 },
    });

    const ran = driver("run");

    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(lines("trial-stub-r2").length, 2);
    // Their harness runs only the repeats calibration asks for.
    assert.ok(!existsSync(join(results, "trial", "runs", "trial-slopcodebench-r2")));
    assert.doesNotMatch(driver("status").stdout, /slopcodebench-r2/);

    const [first, second] = lines("trial-slopcodebench-r1");

    assert.equal(first?.configuration, "slopcodebench");
    assert.equal(first?.checkpoints, 2);
    assert.equal(first?.solved, true);
    assert.equal(second?.solved, false);
    assert.deepEqual(first?.cost, { usd: 0.5, turns: 4, seconds: 30, attempts: 1 });
    assert.equal(first?.erosion, 0.6);

    const report = driver("report");

    assert.match(report.stdout, /\| slopcodebench \| stub \| -0\.5 \[-0\.5, -0\.5\] \|/);
  },
);

test(
  "a calibration that stops short waits for the owner, and is not run again by itself",
  { timeout: 120_000 },
  async (t) => {
    const { run, driver, lines } = study(t, ["Do one.\n", "Do two.\n"], {
      configurations: ["stub"],
      problems: ["toy"],
      repeats: 1,
      calibrate: { effort: "medium" },
    });

    assert.equal(run({ FAKE_REACHED: "1" }, "run").status, 3);
    assert.match(driver("status").stdout, /trial-slopcodebench-r1-toy-2 stopped: their run stopped/);

    // Run again, it reaches both now, but what stopped stays stopped until the owner decides.
    assert.equal(driver("run").status, 3);
    assert.deepEqual(
      lines("trial-slopcodebench-r1").map((line) => line.status),
      ["finished", "stopped"],
    );
  },
);

test(
  "a calibration checkpoint their harness did not run, as when the agent errs, waits for the owner",
  { timeout: 120_000 },
  async (t) => {
    const { run, lines } = study(t, ["Do one.\n", "Do two.\n"], {
      configurations: ["stub"],
      problems: ["toy"],
      repeats: 1,
      calibrate: { effort: "medium" },
    });

    assert.equal(run({ FAKE_ERROR: "1" }, "run").status, 3);
    assert.deepEqual(
      lines("trial-slopcodebench-r1").map((line) => [line.checkpoint, line.status, line.reason]),
      [[1, "stopped", "their checkpoint 1 is error, not ran"]],
    );
  },
);

test(
  "a survey's select places its problems and the current ones by one run each, and names the iteration set",
  { timeout: 120_000 },
  async (t) => {
    // Five surveyed problems and one current, a cell each with one per cell: every one is kept or chosen.
    const fields = {
      configurations: ["stub"],
      problems: ["a", "b", "c", "d", "e"],
      repeats: 1,
      selection: { current: { problems: ["f"], study: "base", run: "base-stub-r1" }, perCell: 1, seed: 1 },
    };
    const { driver, results, write } = study(t, ["Do one.\n"], fields);
    const line = (checkpoint: number, solved: boolean, erosion: number, status = "finished") => ({
      checkpoint,
      checkpoints: 2,
      status,
      solved,
      erosion,
      cost: { usd: 1 },
      seconds: 1,
      grade: { pass_counts: { Core: solved ? 1 : 0 }, total_counts: { Core: 1 } },
    });
    const put = (path: string, lines: object[]) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, lines.map((one) => `${JSON.stringify(one)}\n`).join(""));
    };
    const surveyed = (problem: string, lines: object[]) =>
      put(join(results, "trial", "runs", "trial-stub-r1", `${problem}.jsonl`), lines);

    // Solve rates a 0, b .5, c .5, d 1, e 1; f, current, 1. Ranked: a, b, c, d, e, f (ties by name).
    surveyed("a", [line(1, false, 0.9), line(2, false, 0.9)]);
    surveyed("b", [line(1, true, 0.2), line(2, false, 0.2)]);
    surveyed("c", [line(1, true, 0.8), line(2, false, 0.8)]);
    surveyed("d", [line(1, true, 0.7), line(2, true, 0.7)]);
    surveyed("e", [line(1, true, 0.1), line(2, true, 0.1)]);
    put(join(results, "base", "runs", "base-stub-r1", "f.jsonl"), [line(1, true, 0.3), line(2, true, 0.3)]);

    const selected = driver("select");

    assert.equal(selected.status, 0, selected.stderr);
    // Hard a, b: b erodes less. Middle c, d: d less. Easy e, f: e less.
    assert.match(selected.stdout, /\| hard \| low \| \+b \(0\.50, 0\.20\) \|/);
    assert.match(selected.stdout, /\| easy \| high \| \*f \(1\.00, 0\.30\) \|/);
    assert.match(selected.stdout, /Iteration set: f, b, a, d, c, e\./);
    assert.equal(readFileSync(join(results, "trial", "selection.md"), "utf8"), selected.stdout);

    // A run not complete cannot place its problem: the owner decides it first.
    surveyed("c", [line(1, true, 0.8), line(2, false, 0.8, "escalated")]);

    const waiting = driver("select");

    assert.equal(waiting.status, 2);
    assert.match(waiting.stderr, /c is not complete in trial-stub-r1/);

    // Run again in a study of its own, as after a limit of the setup's, c is placed by that run.
    write({ ...fields, selection: { ...fields.selection, reruns: { study: "again", run: "again-stub-r1", problems: ["c"] } } });
    put(join(results, "again", "runs", "again-stub-r1", "c.jsonl"), [line(1, true, 0.8), line(2, true, 0.8)]);

    const rerun = driver("select");

    assert.equal(rerun.status, 0, rerun.stderr);
    assert.match(rerun.stdout, /\| middle \| high \| \+c \(1\.00, 0\.80\) \|/);
  },
);

test(
  "a report over several studies joins their runs, heads them with each study's configuration hashes, and refuses a configuration and problem in two",
  { timeout: 120_000 },
  async (t) => {
    const fields = { configurations: ["stub"], problems: ["toy"], repeats: 1 };
    const { driver, across, write, git, results } = study(t, ["Do one.\n", "Do two.\n"], fields);

    write({ ...fields, configurations: ["polished"] }, "other");
    git("add", "-A");
    git("commit", "--quiet", "-m", "other");
    assert.equal(driver("run").status, 0);
    assert.equal(across(["other"], "run").status, 0);

    // Only a report reads several studies.
    const both = across(["trial", "other"], "run");

    assert.equal(both.status, 2);
    assert.match(both.stderr, /run takes one study/);

    const hash = (name: string, configuration: string) =>
      // SAFETY: the driver writes the manifest as JSON.
      (
        JSON.parse(readFileSync(join(results, name, "manifest.json"), "utf8")) as {
          configurations: Record<string, string>;
        }
      ).configurations[configuration]!.slice(0, 12);
    const joined = across(["trial", "other"], "report");

    assert.equal(joined.status, 0, joined.stderr);
    const heads = `- trial: stub ${hash("trial", "stub")}\n- other: polished ${hash("other", "polished")}\n`;

    assert.ok(joined.stdout.startsWith(`# trial, other\n\n${heads}`), joined.stdout);
    assert.match(joined.stdout, /\| stub \| toy \| 1 \|/);
    assert.match(joined.stdout, /\| polished \| stub \| 0 \[0, 0\] \|/);
    // Several studies' report has no place of its own: it is printed only.
    assert.ok(!existsSync(join(results, "trial", "report.md")));
    assert.ok(!existsSync(join(results, "other", "report.md")));

    // The same configuration on the same problem in both would count its runs twice.
    write(fields, "other");
    git("commit", "--quiet", "-am", "overlap");

    const overlapping = across(["trial", "other"], "report");

    assert.equal(overlapping.status, 2);
    assert.match(overlapping.stderr, /stub on toy is in both trial and other/);
  },
);

// Every file under `directory`, by its path relative to it.
const tree = (directory: string): string[] =>
  readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((path) => statSync(join(directory, path)).isFile())
    .sort();

test(
  "publish writes a study's scores without the machine's paths, and the median run's history per problem and configuration, theirs from their snapshots",
  { timeout: 120_000 },
  async (t) => {
    const { driver, lines, published, examples, directory, results } = study(t, ["Do one.\n", "Do two.\n"], {
      configurations: ["stub"],
      problems: ["toy"],
      repeats: 2,
      calibrate: { effort: "medium", repeats: 1 },
    });

    assert.equal(driver("run").status, 0);

    const done = driver("publish");

    assert.equal(done.status, 0, done.stderr);

    const at = join(published, "trial");
    const read = (run: string) =>
      readFileSync(join(at, "runs", run, "toy.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Result & { output?: string });

    assert.deepEqual(tree(at), [
      "invocations.jsonl",
      "manifest.json",
      "report.md",
      "runs/trial-slopcodebench-r1/toy.jsonl",
      "runs/trial-stub-r1/toy.jsonl",
      "runs/trial-stub-r2/toy.jsonl",
    ]);
    assert.deepEqual(read("trial-stub-r2"), lines("trial-stub-r2"));

    // Their lines lose the path to their harness's output, which is not published.
    const theirs = lines("trial-slopcodebench-r1") as (Result & { output?: string })[];

    assert.ok(theirs[0]?.output !== undefined);
    assert.deepEqual(
      read("trial-slopcodebench-r1"),
      theirs.map(({ output: _, ...line }) => line),
    );

    // The manifest names repositories, not where they are.
    // SAFETY: the driver writes the manifest as JSON.
    const manifest = (path: string) =>
      JSON.parse(readFileSync(path, "utf8")) as { repositories: { path: string; commit: string }[] };
    const original = manifest(join(results, "trial", "manifest.json"));

    assert.deepEqual(
      manifest(join(at, "manifest.json")).repositories,
      original.repositories.map(({ path, commit }) => ({ path: basename(path), commit })),
    );
    assert.equal(
      readFileSync(join(at, "invocations.jsonl"), "utf8"),
      readFileSync(join(results, "trial", "invocations.jsonl"), "utf8"),
    );
    assert.match(readFileSync(join(at, "report.md"), "utf8"), /^# trial\n[^]*\| slopcodebench \| stub \|/);

    for (const path of tree(at)) assert.ok(!readFileSync(join(at, path), "utf8").includes(directory), path);

    // Ours: the median run's own commits, r1 as both repeats score alike; tagged per checkpoint.
    const git = (...args: string[]) => execFileSync("git", ["-C", examples, ...args], { encoding: "utf8" }).trim();
    const [first, second] = lines("trial-stub-r1");

    assert.deepEqual(git("branch", "--format=%(refname:short)").split("\n").sort(), [
      "trial/toy/slopcodebench",
      "trial/toy/stub",
    ]);
    assert.equal(git("rev-parse", "trial/toy/stub"), second?.commit);
    assert.equal(git("rev-parse", "trial/toy/stub/checkpoint-1^{commit}"), first?.commit);

    // Theirs: a commit per checkpoint, of what their harness kept of it.
    assert.equal(git("rev-list", "--count", "trial/toy/slopcodebench"), "2");
    assert.equal(git("show", "trial/toy/slopcodebench/checkpoint-1:a.py"), "theirs 1");
    assert.equal(git("show", "trial/toy/slopcodebench:a.py"), "theirs 2");

    // Dated by when their harness kept each snapshot, so publishing again makes the same commits.
    const kept = join(theirs[0]!.output!, "toy", "checkpoint_1", "snapshot");

    const keptAt = String(Math.floor(statSync(kept).mtimeMs / 1000));

    assert.equal(git("log", "-1", "--format=%at %ct", "trial/toy/slopcodebench/checkpoint-1"), `${keptAt} ${keptAt}`);

    // Published again, every name points where it did, so links to it keep working.
    const refs = git("show-ref");

    assert.equal(driver("publish").status, 0);
    assert.equal(git("show-ref"), refs);

    // A line naming where the results are is refused, and what was published stays.
    const before = readFileSync(join(at, "runs", "trial-stub-r1", "toy.jsonl"), "utf8");
    const path = join(results, "trial", "runs", "trial-stub-r1", "toy.jsonl");

    writeFileSync(path, `${readFileSync(path, "utf8")}${JSON.stringify({ ...second, note: join(results, "x") })}\n`);

    const refused = driver("publish");

    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /trial's runs\/trial-stub-r1\/toy\.jsonl would publish /);
    assert.equal(readFileSync(join(at, "runs", "trial-stub-r1", "toy.jsonl"), "utf8"), before);
  },
);

test(
  "publish adds to an abandoned run why it escalated and the owner's feedback, and a run with nothing graded has no history",
  { timeout: 120_000 },
  async (t) => {
    const { driver, published, examples, factory } = study(t, ["Do one.\ndry: exit1\n"], {
      configurations: ["stub"],
      problems: ["toy"],
      repeats: 1,
    });

    assert.equal(driver("run").status, 3);

    const { default: options } = await import(factory);
    const engine = createEngine(options);
    const state = engine.state("trial-stub-r1-toy-1");

    if (state.status !== "escalated") assert.fail(`trial-stub-r1-toy-1 is ${state.status}, not escalated`);

    engine.decide("trial-stub-r1-toy-1", {
      subject: state.subject,
      since: state.since,
      outcome: "abandon",
      feedback: "Not ours to fix.",
    });
    assert.equal(driver("run").status, 0);

    const done = driver("publish");

    assert.equal(done.status, 0, done.stderr);

    const path = join(published, "trial", "runs", "trial-stub-r1", "toy.jsonl");
    const last = readFileSync(path, "utf8").trim().split("\n").at(-1)!;
    // SAFETY: the driver writes one result per line.
    const abandoned = JSON.parse(last) as { status: string; escalation?: string; feedback?: string };

    assert.equal(abandoned.status, "abandoned");
    assert.match(abandoned.escalation ?? "", /implement/);
    assert.equal(abandoned.feedback, "Not ours to fix.");
    assert.equal(execFileSync("git", ["-C", examples, "branch"], { encoding: "utf8" }), "");
  },
);
