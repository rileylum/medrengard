// A toy problem for the drivers' tests: two reference solutions through the real workflow, with
// the dry stub as the agent and a fake runner in place of SlopCodeBench's, so no Docker, network or
// spend.
import type { TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "@medrengard/core/src/engine.ts";

export const repository = join(import.meta.dirname, "..");

export type Result = {
  checkpoint: number;
  commission: string;
  configuration: string;
  repeat?: number;
  checkpoints?: number;
  step?: string;
  definition?: string;
  status: string;
  commit?: string;
  reason?: string;
  seconds?: number;
  cost: { usd: number; turns: number; seconds?: number; attempts?: number } | null;
  weekly?: { used: number; at: string };
  solved?: boolean;
  verbosity?: number;
  erosion?: number;
  grade?: { files: string[]; contents: Record<string, string> };
  commits?: { commit: string; grade: { files: string[]; contents: Record<string, string> } }[];
};

// A problem whose two reference solutions write a.py, the second the same as the first if `same`,
// with one asset directory unless `assets` is false, and a fake runner that reports them and
// grades a snapshot by listing it.
export function toy(t: TestContext, prompts: string[], assets = true, same = false) {
  const directory = mkdtempSync(join(tmpdir(), "medrengard-bench-test-"));

  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const problems = join(directory, "problems");

  for (const [n, text] of [
    [1, "one\n"],
    [2, same ? "one\n" : "two\n"],
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
     } else if (command === "pins") {
       console.log(JSON.stringify({ runner: "fake", problems: "fake", python: "3.12.0", matches: true }));
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

  const bench = (run: string, configuration = "stub") =>
    spawnSync(
      process.execPath,
      [
        join(repository, "driver/bench.ts"),
        "--factory",
        factory,
        "--configuration",
        configuration,
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

  const engine = async () => {
    const { default: options } = await import(factory);

    return createEngine(options);
  };

  return { directory, factory, runner, problems, results, bench, read, engine, trajectories: join(directory, "state", "trajectories.git") };
}
