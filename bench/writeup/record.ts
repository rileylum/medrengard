// What the write-up reads from the data directory: a study's result lines and the commits behind
// them. Read only; nothing here runs a model.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { data } from "../data.ts";
import type { Run } from "../driver/report.ts";
import type { Study } from "../study.ts";

export type Line = Run["lines"][number] & { commission: string; commit?: string };
export type Recorded = Omit<Run, "lines"> & { lines: readonly Line[] };

const trajectories = join(data, "state", "trajectories.git");

/**
 * Every problem run a study has begun, from its result lines, in the order the study driver reads
 * them (repeat, then the study's configurations, then its problems), so seeded intervals match its
 * report.
 */
export async function runsOf(name: string): Promise<Recorded[]> {
  // SAFETY: a study file's default export is a Study.
  const { default: study } = (await import(`../studies/${name}.ts`)) as { default: Study };
  const configurations = [...study.configurations, ...(study.calibrate === undefined ? [] : ["slopcodebench"])];
  const runs = join(data, "results", name, "runs");

  return Array.from({ length: study.repeats }, (_, index) => index + 1).flatMap((repeat) =>
    configurations.flatMap((configuration) =>
      study.problems.flatMap((problem) => {
        const path = join(runs, `${name}-${configuration}-r${repeat}`, `${problem}.jsonl`);

        if (!existsSync(path)) return [];

        // SAFETY: driver/bench.ts wrote these lines.
        const lines = readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Line);

        return [{ configuration, problem, repeat, lines }];
      }),
    ),
  );
}

export const git = (...args: string[]) =>
  execFileSync("git", ["-C", trajectories, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

/**
 * scb-check's whole report on a commit, as grading would score it (bin/runner.py quality), kept
 * under the data directory so each commit is measured once.
 */
export function quality(commit: string, problem: string): Record<string, number> {
  const cache = join(data, "writeup", "quality", `${commit}-${problem}.json`);

  if (!existsSync(cache)) {
    const snapshot = mkdtempSync(join(tmpdir(), "writeup-"));

    try {
      execFileSync("sh", ["-c", `git -C "$0" archive "$1" | tar -x -C "$2"`, trajectories, commit, snapshot]);
      const report = execFileSync(join(import.meta.dirname, "..", "bin", "runner.sh"), ["quality", snapshot, problem], {
        encoding: "utf8",
      });

      mkdirSync(join(cache, ".."), { recursive: true });
      writeFileSync(cache, report);
    } finally {
      rmSync(snapshot, { recursive: true, force: true });
    }
  }

  // SAFETY: bin/runner.py wrote it.
  return JSON.parse(readFileSync(cache, "utf8")) as Record<string, number>;
}
