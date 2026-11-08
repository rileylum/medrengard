// The write-up's figures and tables, from the data directory, into figures/: the same data give the
// same files. Needs data/reviews.jsonl from `diffs.ts measure`; measures each run's last commit
// with scb-check once, cached under the data directory.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { breakage, render, score, summarise } from "../driver/report.ts";
import { quality, runsOf, type Recorded } from "./record.ts";
import { intervals, panels } from "./svg.ts";

const out = join(import.meta.dirname, "figures");
const configurations = ["baseline", "code-review", "verification"];
const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const fixed = (value: number, digits = 3) => value.toFixed(digits);
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
const lastOf = (run: Recorded) => new Map(run.lines.map((line) => [line.checkpoint, line]));

mkdirSync(out, { recursive: true });

const study = await runsOf("review-verify");
const summary = summarise(study, { control: "baseline" });
const problems = [...new Set(study.map((run) => run.problem))];
const sections: string[] = ["# Figures and tables", "", "Made by `writeup/figures.ts`; do not edit by hand.", ""];

// Post 2: what each configuration changed, paired by problem.
const measured = [
  ["solved", "solved"],
  ["core", "Core"],
  ["erosion", "erosion"],
  ["verbosity", "verbosity"],
] as const;

writeFileSync(
  join(out, "differences.svg"),
  intervals({
    title: "Against the baseline, paired by problem (n=3, 11 problems)",
    description:
      "Mean difference from the baseline with bootstrap 95% intervals. " +
      summary.versus
        .map((row) => `${row.configuration}: ${measured.map(([key, label]) => `${label} ${fixed(row[key]!.difference)}`).join(", ")}`)
        .join("; "),
    axis: { min: -0.3, max: 0.1, step: 0.1, label: "difference from the baseline", zero: true },
    rows: measured.map(([key, label]) => ({
      label,
      points: summary.versus.map((row) => ({
        series: row.configuration,
        value: row[key]!.difference,
        low: row[key]!.low,
        high: row[key]!.high,
      })),
    })),
  }),
);

const erosionOf = (configuration: string, problem: string) =>
  summary.problems.find((row) => row.configuration === configuration && row.problem === problem)!.erosion;
const byBaseline = problems.toSorted((a, b) => erosionOf("baseline", b).mean! - erosionOf("baseline", a).mean!);

writeFileSync(
  join(out, "erosion-by-problem.svg"),
  intervals({
    title: "Erosion per problem: mean and range over three runs",
    description: byBaseline
      .map((problem) => `${problem}: ${configurations.map((one) => `${one} ${fixed(erosionOf(one, problem).mean!, 2)}`).join(", ")}`)
      .join("; "),
    axis: { min: 0, max: 1, step: 0.2, label: "erosion (lower is better)" },
    rows: byBaseline.map((problem) => ({
      label: problem,
      points: configurations.map((series) => {
        const { mean: value, min: low, max: high } = erosionOf(series, problem);

        return { series, value: value!, low, high };
      }),
    })),
  }),
);

sections.push("## review-verify: the summary", "", render(summary).replace(/^## /gm, "### "), "");

// Post 4: correctness over the checkpoints, with test_translator from the published baseline and
// review-verify-long's single runs.
const corePerCheckpoint = (runs: readonly Recorded[]) => {
  const byCheckpoint = new Map<number, number[]>();

  for (const run of runs.filter((one) => score(one) !== undefined)) {
    for (const line of lastOf(run).values()) {
      const all = line.grade?.total_counts.Core ?? 0;
      const value = line.status === "finished" && all > 0 ? (line.grade!.pass_counts.Core ?? 0) / all : 0;

      byCheckpoint.set(line.checkpoint, [...(byCheckpoint.get(line.checkpoint) ?? []), value]);
    }
  }

  return [...byCheckpoint].toSorted(([a], [b]) => a - b).map(([checkpoint, values]) => [checkpoint, mean(values)] as const);
};
const translator = [
  ...(await runsOf("baseline-added")).filter((run) => run.problem === "test_translator"),
  ...(await runsOf("review-verify-long")),
];
const panelsOf = (runs: readonly Recorded[], problem: string) => ({
  label: problem,
  lines: configurations
    .map((series) => ({ series, points: corePerCheckpoint(runs.filter((run) => run.problem === problem && run.configuration === series)) }))
    .filter((line) => line.points.length > 0),
});

writeFileSync(
  join(out, "core-by-checkpoint.svg"),
  panels({
    title: "Core pass fraction at each checkpoint, mean over runs",
    description:
      "One panel per problem; review-verify's three runs per configuration, and for test_translator the published " +
      "baseline's five with one run each of code-review and verification.",
    y: { min: 0, max: 1, label: "Core pass fraction" },
    x: { label: "checkpoint" },
    panels: [...problems.toSorted().map((problem) => panelsOf(study, problem)), panelsOf(translator, "test_translator")],
  }),
);

// Posts 2 and 3: erosion over the checkpoints, with code-review's code also as it stood before its
// review, so the review's own diff shows apart from what the configuration changed before it.
const erosionPerCheckpoint = (runs: readonly Recorded[]) =>
  [
    ...Map.groupBy(
      runs.flatMap((run) => [...lastOf(run).values()].filter((line) => line.erosion !== undefined)),
      (line) => line.checkpoint,
    ),
  ]
    .toSorted(([a], [b]) => a - b)
    .map(([checkpoint, lines]) => [checkpoint, mean(lines.map((line) => line.erosion!))] as const);
// SAFETY: diffs.ts measure wrote it.
const beforeReview = readFileSync(join(import.meta.dirname, "data", "reviews.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { problem: string; checkpoint: number; quality: { before: { erosion: number } } });

writeFileSync(
  join(out, "erosion-by-checkpoint.svg"),
  panels({
    title: "Erosion at each checkpoint, mean over three runs",
    description:
      "One panel per problem. code-review before its review is its code at the commit before the one addressing the " +
      "review, at the same checkpoint, measured with the same scb-check.",
    y: { min: 0, max: 1, label: "erosion (lower is better)" },
    x: { label: "checkpoint" },
    panels: problems.toSorted().map((problem) => ({
      label: problem,
      lines: [
        ...configurations.map((series) => ({
          series,
          points: erosionPerCheckpoint(study.filter((run) => run.problem === problem && run.configuration === series)),
        })),
        {
          series: "code-review before its review",
          points: [...Map.groupBy(beforeReview.filter((row) => row.problem === problem), (row) => row.checkpoint)]
            .toSorted(([a], [b]) => a - b)
            .map(([checkpoint, rows]) => [checkpoint, mean(rows.map((row) => row.quality.before.erosion))] as const),
        },
      ],
    })),
  }),
);

// Post 4: breakage, the mean over checkpoints after the first, by study and configuration.
const studies = ["baseline", "survey", "survey-rerun", "baseline-added", "review-verify", "review-verify-long"];
const recorded = await Promise.all(studies.map(runsOf));
const broken = studies.flatMap((name, index) =>
  recorded[index]!.flatMap((run) =>
    breakage(run).map((one) => ({ study: name, configuration: run.configuration, problem: run.problem, repeat: run.repeat, ...one })),
  ),
);
const groups = Map.groupBy(broken, (one) => `${one.study} | ${one.configuration}`);

sections.push(
  "## Breakage: tests passed at their own checkpoint and failing later",
  "",
  "Per checkpoint after the first, the share of every earlier checkpoint's passed tests failing in its Regression group; " +
    "the mean over checkpoints. Their harness's calibration runs list no tests and are left out.",
  "",
  table(
    ["study", "configuration", "checkpoints", "mean", "checkpoints with any"],
    [...groups].map(([key, rows]) => [
      ...key.split(" | "),
      String(rows.length),
      percent(mean(rows.map((row) => row.broken / row.passed))),
      String(rows.filter((row) => row.broken > 0).length),
    ]),
  ),
  "",
  "Checkpoints breaking 5% or more:",
  "",
  table(
    ["study", "configuration", "problem", "repeat", "checkpoint", "broken / passed"],
    broken
      .filter((row) => row.broken / row.passed >= 0.05)
      .map((row) => [row.study, row.configuration, row.problem, String(row.repeat), String(row.checkpoint), `${row.broken} / ${row.passed} (${fixed(row.broken / row.passed, 2)})`]),
  ),
  "",
);

// Post 3: what the review itself changed, from data/reviews.jsonl.
type Review = {
  problem: string;
  checkpoint: number;
  commission: string;
  tests: Record<"fixed" | "broken", string[]>;
  core: Record<"before" | "after", [number, number]>;
  insertions: number;
  deletions: number;
  quality: Record<"before" | "after", Record<string, number>>;
};
// SAFETY: diffs.ts measure wrote it.
const reviews = readFileSync(join(import.meta.dirname, "data", "reviews.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as Review);
const keys = ["erosion", "cog_erosion", "verbosity", "total_loc", "total_functions", "high_cc_functions"];
const change = (rows: readonly Review[], key: string) =>
  `${fixed(mean(rows.map((row) => row.quality.before[key]!)), 2)} → ${fixed(mean(rows.map((row) => row.quality.after[key]!)), 2)}`;

sections.push(
  "## code-review: before and after its review, at the same checkpoint",
  "",
  `${reviews.length} checkpoints. Lines changed by the review: mean ${fixed(mean(reviews.map((row) => row.insertions + row.deletions)), 0)}. ` +
    `Erosion lower after the review at ${reviews.filter((row) => row.quality.after.erosion! < row.quality.before.erosion!).length}, ` +
    `higher at ${reviews.filter((row) => row.quality.after.erosion! > row.quality.before.erosion!).length}.`,
  "",
  table(
    ["problem", "checkpoints", ...keys],
    [
      ...[...Map.groupBy(reviews, (row) => row.problem)]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([problem, rows]) => [problem, String(rows.length), ...keys.map((key) => change(rows, key))]),
      ["all", String(reviews.length), ...keys.map((key) => change(reviews, key))],
    ],
  ),
  "",
);

// Post 3: what the review did to the checkpoint's own tests, graded before and after it.
const own = (review: Review, tests: readonly string[]) =>
  tests.filter((test) => test.startsWith(`checkpoint_${review.checkpoint}-`) && !test.startsWith(`checkpoint_${review.checkpoint}-Regression`));
const solvedAt = ([passed, total]: [number, number]) => total > 0 && passed === total;

sections.push(
  "## code-review: the checkpoint's tests before and after its review",
  "",
  "Each review's commit before and after, graded at its checkpoint as the study graded it. Own tests: the " +
    "checkpoint's groups other than Regression, which reruns earlier checkpoints' tests. A parametrized test counts once per case.",
  "",
  table(
    ["problem", "checkpoints", "with a test fixed", "with a test broken", "own tests fixed", "own tests broken", "Regression fixed", "Regression broken", "solved gained", "solved lost"],
    [
      ...[...Map.groupBy(reviews, (row) => row.problem)].toSorted(([a], [b]) => a.localeCompare(b)),
      ["all", reviews] as const,
    ].map(([problem, rows]) => [
      problem,
      String(rows.length),
      String(rows.filter((row) => row.tests.fixed.length > 0).length),
      String(rows.filter((row) => row.tests.broken.length > 0).length),
      String(rows.reduce((sum, row) => sum + own(row, row.tests.fixed).length, 0)),
      String(rows.reduce((sum, row) => sum + own(row, row.tests.broken).length, 0)),
      String(rows.reduce((sum, row) => sum + row.tests.fixed.length - own(row, row.tests.fixed).length, 0)),
      String(rows.reduce((sum, row) => sum + row.tests.broken.length - own(row, row.tests.broken).length, 0)),
      String(rows.filter((row) => !solvedAt(row.core.before) && solvedAt(row.core.after)).length),
      String(rows.filter((row) => solvedAt(row.core.before) && !solvedAt(row.core.after)).length),
    ]),
  ),
  "",
  "Checkpoints whose review changed whether they were solved: " +
    reviews
      .filter((row) => solvedAt(row.core.before) !== solvedAt(row.core.after))
      .map((row) => `${row.commission} (Core ${row.core.before.join("/")} → ${row.core.after.join("/")})`)
      .join(", ") +
    ".",
  "",
);

// Post 3: the final code of every run, each configuration's mean over problems.
const finals = study.flatMap((run) => {
  const last = lastOf(run).get(run.lines[0]!.checkpoints);

  return last?.status === "finished" && last.commit !== undefined
    ? [{ configuration: run.configuration, problem: run.problem, report: quality(last.commit, run.problem) }]
    : [];
});
const perProblem = (configuration: string, key: string) =>
  problems.map((problem) =>
    mean(finals.filter((one) => one.configuration === configuration && one.problem === problem).map((one) => one.report[key]!)),
  );

sections.push(
  "## The final code: each configuration's last checkpoint, mean over problems",
  "",
  table(
    ["measure", ...configurations, "code-review lower on", "verification lower on"],
    keys.map((key) => {
      const base = perProblem("baseline", key);
      const lower = (configuration: string) =>
        `${perProblem(configuration, key).filter((value, index) => value < base[index]!).length} / ${problems.length}`;

      return [key, ...configurations.map((one) => fixed(mean(perProblem(one, key)), 2)), lower("code-review"), lower("verification")];
    }),
  ),
  "",
);

writeFileSync(join(out, "tables.md"), sections.join("\n"));
