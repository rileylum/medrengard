// The driver, outside in: a toy problem of two checkpoints through the real workflow, with the dry
// stub as the agent and a fake runner in place of SlopCodeBench's, so no Docker, network or spend.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "#medrengard/src/engine.ts";

const repository = join(import.meta.dirname, "..");

type Result = {
  checkpoint: number;
  commission: string;
  status: string;
  commit?: string;
  reason?: string;
  seconds?: number;
  cost: { usd: number; turns: number } | null;
  solved?: boolean;
  verbosity?: number;
  erosion?: number;
  grade?: { files: string[]; contents: Record<string, string> };
};

// A problem whose two reference solutions write a.py, with one asset directory unless `assets` is
// false, and a fake runner that reports them and grades a snapshot by listing it.
function toy(t: TestContext, prompts: string[], assets = true) {
  const directory = mkdtempSync(join(tmpdir(), "medrengard-bench-test-"));

  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const problems = join(directory, "problems");

  for (const [n, text] of [
    [1, "one\n"],
    [2, "two\n"],
  ] as const) {
    mkdirSync(join(problems, "toy", "solutions", `checkpoint_${n}`), { recursive: true });
    writeFileSync(join(problems, "toy", "solutions", `checkpoint_${n}`, "a.py"), text);
  }

  // A solution's dependencies, none, so recreating its virtual environment needs no network.
  writeFileSync(join(problems, "toy", "solutions", "checkpoint_1", "requirements.txt"), "# none\n");

  mkdirSync(join(problems, "toy", "files"), { recursive: true });
  writeFileSync(join(problems, "toy", "files", "data.txt"), "asset\n");

  const runner = join(directory, "runner.ts");

  writeFileSync(
    runner,
    `import { readdirSync, readFileSync, statSync } from "node:fs";
     import { join, relative } from "node:path";
     const [command, ...rest] = process.argv.slice(2);
     if (command === "problem") {
       console.log(JSON.stringify({
         checkpoints: ${prompts.length},
         assets: ${JSON.stringify(assets ? [{ source: join(problems, "toy", "files"), path: "files" }] : [])},
         prompts: ${JSON.stringify(prompts)},
       }));
     } else if (command === "grade") {
       const [snapshot] = rest;
       const walk = (dir) => readdirSync(dir).flatMap((name) =>
         statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]);
       const files = walk(snapshot).map((file) => relative(snapshot, file)).sort();
       const contents = Object.fromEntries(files.map((file) => [file, readFileSync(join(snapshot, file), "utf8")]));
       const quality = { verbosity: 0.25, erosion: 0.5 };
       console.log(JSON.stringify({ pass_counts: { Core: 1 }, total_counts: { Core: 1 }, quality, files, contents }));
     } else {
       process.exit(2);
     }
    `,
  );

  const factory = join(directory, "factory.ts");

  writeFileSync(
    factory,
    `import { dryFactory } from ${JSON.stringify(join(repository, "dry/factory.ts"))};
     const dry = dryFactory(${JSON.stringify(join(directory, "state"))}, ${JSON.stringify(problems)});
     export default dry.factory;
     export const trajectories = dry.trajectories;
    `,
  );

  const results = join(directory, "results");

  const bench = (run: string) =>
    spawnSync(
      process.execPath,
      [
        join(repository, "driver/bench.ts"),
        "--factory",
        factory,
        "--runner",
        process.execPath,
        "--runner",
        runner,
        "--problem",
        "toy",
        "--run",
        run,
        "--results",
        results,
      ],
      { encoding: "utf8", cwd: directory },
    );

  const read = (run: string): Result[] =>
    readFileSync(join(results, run, "toy.jsonl"), "utf8")
      .trim()
      .split("\n")
      // SAFETY: the driver writes one result per line.
      .map((line) => JSON.parse(line) as Result);

  return { directory, factory, bench, read, trajectories: join(directory, "state", "trajectories.git") };
}

test(
  "a dry run takes each checkpoint from the last one's commit, restores its assets and grades it",
  { timeout: 120_000 },
  async (t) => {
    const prompts = ["Do one.\ndry: rmassets\n", "Keep going: do two.\n"];
    const { directory, factory, bench, read } = toy(t, prompts);

    const ran = bench("r1");

    assert.equal(ran.status, 0, ran.stderr);

    const [first, second] = read("r1");

    assert.equal(first?.status, "finished");
    assert.equal(second?.status, "finished");

    // Checkpoint 2 starts from checkpoint 1's commit.
    const trajectories = join(directory, "state", "trajectories.git");

    execFileSync("git", [
      "-C",
      trajectories,
      "merge-base",
      "--is-ancestor",
      first!.commit!,
      second!.commit!,
    ]);

    // Each was graded on its own commit: checkpoint 1 removed the assets, checkpoint 2's start
    // restored them, as SlopCodeBench's harness does.
    assert.equal(first?.grade?.contents["a.py"], "one\n");
    assert.ok(!first?.grade?.files.includes("files/data.txt"));
    assert.equal(second?.grade?.contents["a.py"], "two\n");
    assert.equal(second?.grade?.contents["files/data.txt"], "asset\n");
    assert.equal(second?.solved, true);

    // SlopCodeBench's two quality scores, as its scb-check reports them.
    assert.equal(second?.verbosity, 0.25);
    assert.equal(second?.erosion, 0.5);
    assert.match(ran.stdout, /r1-toy-2: solved, Core 1\/1, verbosity 0\.25, erosion 0\.5/);

    // The stub's result line, as Claude Code's stream-json ends.
    assert.deepEqual(second?.cost, { usd: 0, turns: 1, seconds: 0.001 });
    assert.ok(typeof second?.seconds === "number");

    // The request is the rendered task, byte for byte.
    const { default: options } = await import(factory);
    const engine = createEngine(options);
    const { request } = engine.record(second!.commission);

    assert.equal(engine.artifact(request.hash).body, prompts[1]);

    // As SlopCodeBench's harness does, a checkpoint after the first starts with its virtual
    // environment made again from requirements.txt; the first has none to make.
    assert.match(engine.transcript(first!.commission, 2).toString(), /^stub: \.venv absent$/m);
    assert.match(engine.transcript(second!.commission, 2).toString(), /^stub: \.venv present$/m);
  },
);

test(
  "a checkpoint that escalates stops its problem, ungraded, for the owner",
  { timeout: 120_000 },
  async (t) => {
    const { bench, read } = toy(t, ["Do one.\ndry: exit1", "Do two."]);

    const ran = bench("r1");

    assert.equal(ran.status, 1);
    assert.match(ran.stderr, /escalated at implement/);

    const results = read("r1");

    assert.equal(results.length, 1);
    assert.equal(results[0]?.status, "escalated");
    assert.equal(results[0]?.grade, undefined);
  },
);

test(
  "a problem with no assets starts from an empty repository",
  { timeout: 120_000 },
  async (t) => {
    const { bench, read, trajectories } = toy(t, ["Do one.\n"], false);

    const ran = bench("r1");

    assert.equal(ran.status, 0, ran.stderr);

    const [first] = read("r1");

    assert.equal(first?.status, "finished");
    assert.deepEqual(first?.grade?.files, ["a.py", "requirements.txt"]);

    // The start the agent was given holds nothing.
    assert.equal(execFileSync("git", ["-C", trajectories, "ls-tree", "r1-toy-1"], { encoding: "utf8" }), "");
  },
);

test(
  "an agent that claims its start back as its work escalates",
  { timeout: 120_000 },
  async (t) => {
    const { bench, read } = toy(t, ["Do one.\n", "Do two.\ndry: noop\n"]);

    const ran = bench("r1");

    assert.equal(ran.status, 1);
    assert.match(ran.stderr, /r1-toy-2 escalated at implement: .* is already the subject\./);
    assert.deepEqual(
      read("r1").map((result) => result.status),
      ["finished", "escalated"],
    );
  },
);
