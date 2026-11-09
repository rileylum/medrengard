// What code-review's review changed. Each of its checkpoints ends in two commits or more: the
// work, then one addressing the review, always the last; so the review's own diff is the last
// commit's parent to it.
//
//   diffs.ts grade                  grades every commit before a review, as its checkpoint was graded
//                                   (local and free, about 40 s each), cached under the data directory
//   diffs.ts measure                every review's scb-check and tests before and after, into
//                                   data/reviews.jsonl
//   diffs.ts show <commission>      the review's diff, as git prints it
//   diffs.ts findings <commission>  what each reviewer handed back, from the implement step's transcript
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { data, scratch } from "../data.ts";
import { git, quality, runsOf, type Line } from "./record.ts";

const study = "review-verify";

type Tests = NonNullable<NonNullable<Line["grade"]>["tests"]>;

/** Every graded code-review checkpoint of the study, with its commits before and after the review. */
export async function reviews() {
  return (await runsOf(study))
    .filter((run) => run.configuration === "code-review")
    .flatMap(({ problem, repeat, lines }) =>
      [...new Map(lines.map((line) => [line.checkpoint, line])).values()]
        .filter((line) => line.status === "finished" && line.commit !== undefined)
        .map((line) => ({
          problem,
          repeat,
          checkpoint: line.checkpoint,
          commission: line.commission,
          before: git("rev-parse", `${line.commit!}^`).trim(),
          after: line.commit!,
          tests: line.grade!.tests!,
          core: [line.grade!.pass_counts.Core ?? 0, line.grade!.total_counts.Core ?? 0] as const,
        })),
    )
    .toSorted((a, b) => a.commission.localeCompare(b.commission, "en", { numeric: true }));
}

// The measures the posts use, of scb-check's report.
const kept = ["erosion", "cog_erosion", "verbosity", "total_loc", "total_functions", "high_cc_functions"] as const;
const pick = (report: Record<string, number>) => Object.fromEntries(kept.map((key) => [key, report[key]]));

const gradeOf = (commit: string, problem: string, checkpoint: number) =>
  join(data, "writeup", "grades", `${commit}-${problem}-${checkpoint}.json`);

/** Grades a commit at a checkpoint with SlopCodeBench's grader, as driver/bench.ts does, once. */
async function grade(commit: string, problem: string, checkpoint: number) {
  const cache = gradeOf(commit, problem, checkpoint);

  if (existsSync(cache)) return;

  const work = scratch("writeup-grade-");
  const run = promisify(execFile);

  try {
    mkdirSync(join(work, "code"));
    await run("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", join(data, "state", "trajectories.git"), commit, join(work, "code")]);

    const { stdout } = await run(
      join(import.meta.dirname, "..", "bin", "runner.sh"),
      ["grade", join(work, "code"), problem, String(checkpoint), join(work, "out")],
      { maxBuffer: 1 << 28 },
    );
    // SAFETY: the runner's grade command prints SlopCodeBench's eval-snapshot report.
    const { tests, pass_counts, total_counts } = JSON.parse(stdout) as { tests: Tests; pass_counts: object; total_counts: object };

    mkdirSync(join(cache, ".."), { recursive: true });
    writeFileSync(cache, JSON.stringify({ tests, pass_counts, total_counts }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// The tests of a checkpoint's grade, as group::name, that `to` passes and `from` failed.
const gained = (from: Tests, to: Tests) =>
  Object.entries(to).flatMap(([group, result]) =>
    result.passed.filter((name) => from[group]?.failed.includes(name)).map((name) => `${group}::${name}`),
  );

/**
 * What each reviewer subagent handed back in a commission's implement step, by the description its
 * Agent call gave it ("Spec review", "Standards review"), from Claude Code's stream-json transcript.
 */
export function findings(commission: string) {
  const log = new DatabaseSync(join(data, "state", "log", "log.sqlite"), { readOnly: true });
  const events = log
    .prepare("SELECT event FROM events WHERE commission = ? ORDER BY position")
    .all(commission)
    // SAFETY: the engine wrote these events.
    .map((row) => JSON.parse(String(row.event)) as { type: string; step?: string; transcript?: string });
  const transcript = events.findLast((event) => event.type === "attempt-completed" && event.step === "implement")?.transcript;

  if (transcript === undefined) throw new Error(`${commission} has no completed implement step.`);

  type Content = { type: string; id?: string; name?: string; input?: { description?: string }; tool_use_id?: string; content?: unknown };
  const calls = new Map<string, string>();
  const reports: { reviewer: string; report: string }[] = [];

  for (const text of readFileSync(join(data, "state", "log", "store", transcript), "utf8").split("\n")) {
    if (!text.startsWith("{")) continue;

    // SAFETY: a line of Claude Code's stream-json output.
    const message = JSON.parse(text) as { parent_tool_use_id?: string | null; message?: { content?: Content[] | string } };

    // A subagent's own messages carry its call's id; only the main agent's calls and results count.
    if (message.parent_tool_use_id || !Array.isArray(message.message?.content)) continue;

    for (const content of message.message.content) {
      if (content.type === "tool_use" && (content.name === "Agent" || content.name === "Task")) {
        calls.set(content.id!, content.input?.description ?? "subagent");
      } else if (content.type === "tool_result" && calls.has(content.tool_use_id!)) {
        const body = Array.isArray(content.content)
          ? content.content.map((part: { text?: string }) => part.text ?? "").join("")
          : String(content.content);

        reports.push({ reviewer: calls.get(content.tool_use_id!)!, report: body });
      }
    }
  }

  return reports;
}

if (import.meta.main) {
  const [command, commission] = process.argv.slice(2);

  if (command === "grade") {
    const queue = await reviews();
    const worker = async () => {
      for (let review = queue.shift(); review !== undefined; review = queue.shift()) {
        await grade(review.before, review.problem, review.checkpoint);
        console.error(`${review.commission}: graded`);
      }
    };

    await Promise.all(Array.from({ length: 4 }, worker));
  } else if (command === "measure") {
    const lines = (await reviews()).map(({ tests: after, core, ...review }) => {
      const [, insertions = "0", deletions = "0"] =
        /(?:(\d+) insertions?\(\+\))?(?:, )?(?:(\d+) deletions?\(-\))?$/.exec(
          git("diff", "--shortstat", review.before, review.after).trim(),
        ) ?? [];
      // SAFETY: grade wrote it.
      const { tests: before, pass_counts, total_counts } = JSON.parse(
        readFileSync(gradeOf(review.before, review.problem, review.checkpoint), "utf8"),
      ) as { tests: Tests; pass_counts: Record<string, number>; total_counts: Record<string, number> };

      return {
        ...review,
        insertions: Number(insertions),
        deletions: Number(deletions),
        quality: { before: pick(quality(review.before, review.problem)), after: pick(quality(review.after, review.problem)) },
        tests: { fixed: gained(before, after), broken: gained(after, before) },
        // Core tests passed and graded, before and after the review.
        core: { before: [pass_counts.Core ?? 0, total_counts.Core ?? 0], after: core },
      };
    });

    mkdirSync(join(import.meta.dirname, "data"), { recursive: true });
    writeFileSync(join(import.meta.dirname, "data", "reviews.jsonl"), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  } else if (command === "show" && commission !== undefined) {
    const review = (await reviews()).find((one) => one.commission === commission);

    if (review === undefined) throw new Error(`No code-review checkpoint ${commission} in ${study}.`);

    process.stdout.write(git("diff", review.before, review.after));
  } else if (command === "findings" && commission !== undefined) {
    for (const { reviewer, report } of findings(commission)) process.stdout.write(`## ${reviewer}\n\n${report}\n\n`);
  } else {
    console.error("Usage: diffs.ts grade | measure | show <commission> | findings <commission>");
    process.exit(2);
  }
}
