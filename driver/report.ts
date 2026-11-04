// A study's summary: per problem, each configuration's mean and range over its complete runs; per
// configuration, means over problems with bootstrap 95% intervals; and each configuration against
// the control, paired by problem. Pure, and seeded, so the same lines give the same summary.

/** One problem run: its result lines as driver/bench.ts wrote them, in order. */
export type Run = {
  configuration: string;
  problem: string;
  repeat: number;
  lines: readonly Line[];
};

type Line = {
  checkpoint: number;
  checkpoints: number;
  status: string;
  solved?: boolean;
  erosion?: number;
  verbosity?: number;
  cost: { usd?: number } | null;
  seconds?: number;
  grade?: { pass_counts: Record<string, number>; total_counts: Record<string, number> };
};

const metrics = ["solved", "core", "reliable", "erosion", "verbosity", "usd", "seconds"] as const;

type Metric = (typeof metrics)[number];
type Scores = Record<Metric, number | undefined>;

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;

// One complete run's scores, or undefined while it waits for the owner or is still running. A
// checkpoint never graded, after an abandon, counts as unsolved with no Core test passing; erosion
// and verbosity are means over the graded checkpoints.
function score(run: Run): Scores | undefined {
  const last = new Map(run.lines.map((line) => [line.checkpoint, line]));
  const lines = [...last.values()];
  const total = lines[0]?.checkpoints ?? 0;
  const graded = lines.filter((line) => line.status === "finished");
  const abandoned = lines.some((line) => line.status === "abandoned");

  if (total === 0 || (graded.length < total && !abandoned)) return undefined;

  const core = graded.map((line) => {
    const passed = line.grade?.pass_counts.Core ?? 0;
    const all = line.grade?.total_counts.Core ?? 0;

    return all === 0 ? 0 : passed / all;
  });
  const solved = graded.filter((line) => line.solved === true).length;
  const defined = (values: (number | undefined)[]) => values.filter((value) => value !== undefined);
  const meanOf = (values: number[]) => (values.length === 0 ? undefined : mean(values));
  const sumOf = (values: (number | undefined)[]) =>
    values.every((value) => value !== undefined) ? values.reduce((a, b) => a + b, 0) : undefined;

  return {
    solved: solved / total,
    core: core.reduce((a, b) => a + b, 0) / total,
    reliable: solved === total ? 1 : 0,
    erosion: meanOf(defined(graded.map((line) => line.erosion))),
    verbosity: meanOf(defined(graded.map((line) => line.verbosity))),
    usd: sumOf(lines.map((line) => line.cost?.usd)),
    seconds: sumOf(lines.map((line) => line.seconds)),
  };
}

// A small seeded generator (mulberry32), so intervals do not change from one summary to the next.
function generator(seed: number) {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;

    let t = Math.imul(state ^ (state >>> 15), 1 | state);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iterations = 2000;

// The 2.5th and 97.5th percentiles of `draw`, drawn `iterations` times.
function interval(draw: () => number) {
  const draws = Array.from({ length: iterations }, draw).sort((a, b) => a - b);

  return { low: draws[Math.floor(0.025 * iterations)]!, high: draws[Math.ceil(0.975 * iterations) - 1]! };
}

/**
 * Summarises a study's runs. Every figure is over complete runs; `control` is the configuration
 * the others are compared with.
 */
export function summarise(runs: readonly Run[], { control, seed = 1 }: { control: string; seed?: number }) {
  const random = generator(seed);
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
  const resampledMean = (values: readonly number[]) => mean(values.map(() => pick(values)));

  const incomplete: { configuration: string; problem: string; repeat: number }[] = [];
  // Each configuration's scores, by problem, one per complete run.
  const scores = new Map<string, Map<string, Scores[]>>();

  for (const run of runs) {
    const scored = score(run);

    if (scored === undefined) {
      incomplete.push({ configuration: run.configuration, problem: run.problem, repeat: run.repeat });
      continue;
    }

    const byProblem = scores.get(run.configuration) ?? new Map<string, Scores[]>();

    scores.set(run.configuration, byProblem);
    byProblem.set(run.problem, [...(byProblem.get(run.problem) ?? []), scored]);
  }

  const valuesOf = (runScores: readonly Scores[], metric: Metric) =>
    runScores.map((scored) => scored[metric]).filter((value) => value !== undefined);

  const range = (values: number[]) =>
    values.length === 0
      ? { mean: undefined, min: undefined, max: undefined }
      : { mean: mean(values), min: Math.min(...values), max: Math.max(...values) };

  const problems = [...scores].flatMap(([configuration, byProblem]) =>
    [...byProblem].map(([problem, runScores]) => ({
      configuration,
      problem,
      runs: runScores.length,
      solved: range(valuesOf(runScores, "solved")),
      core: range(valuesOf(runScores, "core")),
      reliable: mean(valuesOf(runScores, "reliable")),
      erosion: range(valuesOf(runScores, "erosion")),
      verbosity: range(valuesOf(runScores, "verbosity")),
      usd: range(valuesOf(runScores, "usd")),
      seconds: range(valuesOf(runScores, "seconds")),
    })),
  );

  // Per problem the values of `metric` over its runs, leaving out problems with none.
  const perProblem = (byProblem: Map<string, Scores[]>, metric: Metric, only?: Set<string>) =>
    [...byProblem]
      .filter(([problem]) => only === undefined || only.has(problem))
      .map(([problem, runScores]) => [problem, valuesOf(runScores, metric)] as const)
      .filter(([, values]) => values.length > 0);

  const overall = [...scores].map(([configuration, byProblem]) => ({
    configuration,
    ...Object.fromEntries(
      metrics.map((metric) => {
        const groups = perProblem(byProblem, metric).map(([, values]) => values);

        if (groups.length === 0) return [metric, undefined];

        return [
          metric,
          {
            mean: mean(groups.map(mean)),
            ...interval(() => mean(groups.map(() => resampledMean(pick(groups))))),
          },
        ];
      }),
    ),
  })) as ({ configuration: string } & Record<Metric, { mean: number; low: number; high: number } | undefined>)[];

  const controlScores = scores.get(control);
  const versus = [...scores]
    .filter(([configuration]) => configuration !== control && controlScores !== undefined)
    .map(([configuration, byProblem]) => ({
      configuration,
      control,
      ...Object.fromEntries(
        metrics.map((metric) => {
          const theirs = new Map(perProblem(controlScores!, metric));
          const paired = perProblem(byProblem, metric, new Set(theirs.keys())).map(
            ([problem, values]) => [values, theirs.get(problem)!] as const,
          );

          if (paired.length === 0) return [metric, undefined];

          return [
            metric,
            {
              difference: mean(paired.map(([ours, theirs]) => mean(ours) - mean(theirs))),
              ...interval(() =>
                mean(
                  paired.map(() => {
                    const [ours, theirs] = pick(paired);

                    return resampledMean(ours) - resampledMean(theirs);
                  }),
                ),
              ),
            },
          ];
        }),
      ),
    })) as ({ configuration: string; control: string } & Record<
    Metric,
    { difference: number; low: number; high: number } | undefined
  >)[];

  return { incomplete, problems, overall, versus };
}

const figure = (value: number | undefined) => (value === undefined ? "–" : String(Math.round(value * 1000) / 1000));

/** The summary as Markdown tables. */
export function render(summary: ReturnType<typeof summarise>) {
  const table = (head: string[], rows: string[][]) =>
    [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join(
      "\n",
    );
  const spread = (value: { mean?: number; min?: number; max?: number }) =>
    `${figure(value.mean)} (${figure(value.min)}–${figure(value.max)})`;
  const ci = (value: { mean: number; low: number; high: number } | undefined) =>
    value === undefined ? "–" : `${figure(value.mean)} [${figure(value.low)}, ${figure(value.high)}]`;
  const diff = (value: { difference: number; low: number; high: number } | undefined) =>
    value === undefined ? "–" : `${figure(value.difference)} [${figure(value.low)}, ${figure(value.high)}]`;

  return [
    "## Per problem: mean (min–max) over complete runs",
    "",
    table(
      ["configuration", "problem", "runs", "solved", "Core", "reliable", "erosion", "verbosity", "$", "seconds"],
      summary.problems.map((row) => [
        row.configuration,
        row.problem,
        String(row.runs),
        spread(row.solved),
        spread(row.core),
        figure(row.reliable),
        spread(row.erosion),
        spread(row.verbosity),
        spread(row.usd),
        spread(row.seconds),
      ]),
    ),
    "",
    "## Per configuration: mean over problems [bootstrap 95%]",
    "",
    table(
      ["configuration", "solved", "Core", "reliable", "erosion", "verbosity", "$ per problem"],
      summary.overall.map((row) => [
        row.configuration,
        ci(row.solved),
        ci(row.core),
        ci(row.reliable),
        ci(row.erosion),
        ci(row.verbosity),
        ci(row.usd),
      ]),
    ),
    "",
    "## Against the control: difference, paired by problem [bootstrap 95%]",
    "",
    summary.versus.length === 0
      ? "No configuration to compare."
      : table(
          ["configuration", "control", "solved", "Core", "reliable", "erosion", "verbosity", "$ per problem"],
          summary.versus.map((row) => [
            row.configuration,
            row.control,
            diff(row.solved),
            diff(row.core),
            diff(row.reliable),
            diff(row.erosion),
            diff(row.verbosity),
            diff(row.usd),
          ]),
        ),
    "",
    summary.incomplete.length === 0
      ? "Every run is complete."
      : `Left out, not complete: ${summary.incomplete.map((run) => `${run.configuration} r${run.repeat} ${run.problem}`).join(", ")}.`,
    "",
  ].join("\n");
}
