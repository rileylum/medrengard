// The study driver, outside in: a study file in its own repository, run over the toy problem with
// the dry stub's configurations and a fake runner, so no Docker, network or spend.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { createEngine } from "#medrengard/src/engine.ts";
import { repository, toy, type Result } from "./toy.ts";

type Fields = {
  configurations: string[];
  problems: string[];
  repeats: number;
  final?: boolean;
  calibrate?: { effort: string; repeats?: number };
  selection?: { current: { problems: string[]; study: string; run: string }; perCell: number; seed: number };
};

// The toy problem with a study `name` over it, committed in a repository of its own.
function study(t: TestContext, prompts: string[], fields: Fields, name = "trial") {
  const problem = toy(t, prompts);
  const studies = join(problem.directory, "studies");
  const file = join(studies, `${name}.ts`);

  mkdirSync(studies);

  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@localhost", "-C", studies, ...args], {
      encoding: "utf8",
    });

  const write = ({ selection, ...changed }: Fields) => {
    writeFileSync(
      file,
      `import { defineStudy } from ${JSON.stringify(join(repository, "study.ts"))};
       export default defineStudy(${JSON.stringify({ factory: "../factory.ts", ...changed })});
       export const selection = ${JSON.stringify(selection)};
      `,
    );
  };

  write(fields);
  git("init", "--quiet");
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
    `,
  );

  const driver = (...args: string[]) => run({}, ...args);
  const run = (env: Record<string, string>, ...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        join(repository, "driver/study.ts"),
        ...args,
        file,
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

  return { ...problem, file, git, write, driver, run, lines, commissions, manifest: join(problem.results, name, "manifest.json") };
}

test(
  "a study runs every configuration, problem and repeat, repeats first, and records what it ran on",
  { timeout: 120_000 },
  async (t) => {
    const { driver, lines, commissions, manifest } = study(t, ["Do one.\n", "Do two.\n"], {
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
    assert.equal(recorded.repositories.length, 2);
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
    const { driver, results } = study(t, ["Do one.\n"], {
      configurations: ["stub"],
      problems: ["a", "b", "c", "d", "e"],
      repeats: 1,
      selection: { current: { problems: ["f"], study: "base", run: "base-stub-r1" }, perCell: 1, seed: 1 },
    });
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
  },
);
