// The study driver, outside in: a study file in its own repository, run over the toy problem with
// the dry stub's configurations and a fake runner, so no Docker, network or spend.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEngine } from "#medrengard/src/engine.ts";
import { repository, toy, type Result } from "./toy.ts";

type Fields = {
  configurations: string[];
  problems: string[];
  repeats: number;
  concurrency: number;
  final?: boolean;
  calibrate?: { effort: string };
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

  const write = (changed: Fields) => {
    writeFileSync(
      file,
      `import { defineStudy } from ${JSON.stringify(join(repository, "study.ts"))};
       export default defineStudy(${JSON.stringify({ factory: "../factory.ts", ...changed })});
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
       problem, idx, state: "ran", core_passed: idx === 1 ? 1 : 0, core_total: 1,
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
      concurrency: 2,
    });

    const ran = driver("run");

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
      study: { hash: string; repeats: number; concurrency: number };
      repositories: { path: string; commit: string }[];
      pins: { runner: string; python: string };
      versions: { node: string };
      configurations: Record<string, string>;
    };

    assert.match(recorded.study.hash, /^[0-9a-f]{64}$/);
    assert.equal(recorded.study.concurrency, 2);
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
    const fields = { configurations: ["stub"], problems: ["toy"], repeats: 1, concurrency: 1 };
    const { driver, commissions, write, git } = study(t, ["Do one.\n"], fields);

    assert.equal(driver("run").status, 0);

    const before = await commissions();
    const again = driver("run");

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
      concurrency: 1,
    });

    const ran = driver("run");

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
    const fields = { configurations: ["stub"], problems: ["toy"], repeats: 1, concurrency: 1 };
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
  "a calibrating study runs SlopCodeBench's own harness as one more configuration, its results read as ours",
  { timeout: 120_000 },
  async (t) => {
    const { driver, lines } = study(t, ["Do one.\n", "Do two.\n"], {
      configurations: ["stub"],
      problems: ["toy"],
      repeats: 1,
      concurrency: 2,
      calibrate: { effort: "medium" },
    });

    const ran = driver("run");

    assert.equal(ran.status, 0, ran.stderr);

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
      concurrency: 1,
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
