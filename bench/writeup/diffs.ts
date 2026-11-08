// What code-review's review changed. Each of its checkpoints ends in two commits or more: the
// work, then one addressing the review, always the last; so the review's own diff is the last
// commit's parent to it.
//
//   diffs.ts measure            every review's scb-check before and after, into data/reviews.jsonl
//   diffs.ts show <commission>  the review's diff, as git prints it
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, quality, runsOf } from "./record.ts";

const study = "review-verify";

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
        })),
    )
    .toSorted((a, b) => a.commission.localeCompare(b.commission, "en", { numeric: true }));
}

// The measures the posts use, of scb-check's report.
const kept = ["erosion", "cog_erosion", "verbosity", "total_loc", "total_functions", "high_cc_functions"] as const;
const pick = (report: Record<string, number>) => Object.fromEntries(kept.map((key) => [key, report[key]]));

if (import.meta.main) {
  const [command, commission] = process.argv.slice(2);

  if (command === "measure") {
    const lines = (await reviews()).map((review) => {
      const [, insertions = "0", deletions = "0"] =
        /(?:(\d+) insertions?\(\+\))?(?:, )?(?:(\d+) deletions?\(-\))?$/.exec(
          git("diff", "--shortstat", review.before, review.after).trim(),
        ) ?? [];

      return {
        ...review,
        insertions: Number(insertions),
        deletions: Number(deletions),
        quality: { before: pick(quality(review.before, review.problem)), after: pick(quality(review.after, review.problem)) },
      };
    });

    mkdirSync(join(import.meta.dirname, "data"), { recursive: true });
    writeFileSync(join(import.meta.dirname, "data", "reviews.jsonl"), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  } else if (command === "show" && commission !== undefined) {
    const review = (await reviews()).find((one) => one.commission === commission);

    if (review === undefined) throw new Error(`No code-review checkpoint ${commission} in ${study}.`);

    process.stdout.write(git("diff", review.before, review.after));
  } else {
    console.error("Usage: diffs.ts measure | show <commission>");
    process.exit(2);
  }
}
