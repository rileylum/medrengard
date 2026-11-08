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
  grade?: Grade;
  // The commits a configuration made in the checkpoint before the one it claimed, oldest first.
  commits?: readonly { commit: string; grade: Grade }[];
};

type Tests = Record<string, { passed: string[]; failed: string[] }>;
type Grade = { pass_counts: Record<string, number>; total_counts: Record<string, number>; tests?: Tests };

const metrics = ["solved", "core", "reliable", "erosion", "verbosity", "breakage", "usd", "seconds"] as const;

type Metric = (typeof metrics)[number];
type Scores = Record<Metric, number | undefined>;

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;

// One complete run's scores, or undefined while it waits for the owner or is still running. A
// checkpoint never graded, after an abandon, counts as unsolved with no Core test passing; erosion
// and verbosity are means over the graded checkpoints.
export function score(run: Run): Scores | undefined {
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
    breakage: meanOf(breakage(run).map((one) => one.broken / one.passed)),
    usd: sumOf(lines.map((line) => line.cost?.usd)),
    seconds: sumOf(lines.map((line) => line.seconds)),
  };
}

/**
 * What a run broke: at each checkpoint after the first, of the tests every earlier checkpoint passed
 * in its own groups, how many fail in that checkpoint's Regression group now. A test is matched by
 * name, which is the same in its own group and in Regression. Checkpoints whose grade lists no
 * tests, as their harness's calibration runs, are left out.
 */
export function breakage(run: Run) {
  const last = new Map(run.lines.map((line) => [line.checkpoint, line]));
  const tests = new Map(
    [...last].flatMap(([checkpoint, line]) =>
      line.status === "finished" && line.grade?.tests !== undefined ? [[checkpoint, line.grade.tests] as const] : [],
    ),
  );
  const passedOwn = (checkpoint: number) =>
    Object.entries(tests.get(checkpoint)!)
      .filter(([group]) => group.startsWith(`checkpoint_${checkpoint}-`) && !group.endsWith("-Regression"))
      .flatMap(([, result]) => result.passed);

  return [...tests]
    .filter(([checkpoint]) => checkpoint > 1)
    .toSorted(([a], [b]) => a - b)
    .flatMap(([checkpoint, groups]) => {
      let broken = 0;
      let passed = 0;

      for (const earlier of tests.keys()) {
        const regression = groups[`checkpoint_${earlier}-Regression`];

        if (earlier >= checkpoint || regression === undefined) continue;

        const failed = new Set(regression.failed);
        const own = passedOwn(earlier);

        passed += own.length;
        broken += own.filter((name) => failed.has(name)).length;
      }

      return passed === 0 ? [] : [{ checkpoint, broken, passed }];
    });
}

// A test's family: its name without the parameters of a parametrized case, within its group.
const familyOf = (group: string, name: string) => `${group}::${name.replace(/\[.*\]$/, "")}`;
const own = (group: string, checkpoint: number) => group.startsWith(`checkpoint_${checkpoint}-`) && !group.endsWith("-Regression");
const solvedBy = (grade: Grade) => (grade.total_counts.Core ?? 0) > 0 && grade.pass_counts.Core === grade.total_counts.Core;

// Each family of a checkpoint's own tests: its cases, and whether every one passed.
function families(tests: Tests, checkpoint: number) {
  const found = new Map<string, { cases: number; passed: boolean }>();

  for (const [group, result] of Object.entries(tests).filter(([group]) => own(group, checkpoint))) {
    for (const [names, passed] of [[result.passed, true], [result.failed, false]] as const) {
      for (const name of names) {
        const key = familyOf(group, name);
        const before = found.get(key) ?? { cases: 0, passed: true };

        found.set(key, { cases: before.cases + 1, passed: before.passed && passed });
      }
    }
  }

  return found;
}

/**
 * What a study's runs did test by test, by family: within a run, what each checkpoint's claimed
 * commit changed from its first; the families every run of a configuration passes and every run of
 * the control fails, or the other way round; and the families every run fails.
 */
export function tests(runs: readonly Run[], { control }: { control: string }) {
  // Each run's graded checkpoints, the last line of each winning.
  const graded = runs.flatMap((run) =>
    [...new Map(run.lines.map((line) => [line.checkpoint, line])).values()]
      .filter((line) => line.status === "finished" && line.grade?.tests !== undefined)
      .map((line) => ({ run, line, tests: line.grade!.tests! })),
  );

  type Count = { families: number; cases: number };
  const count = (cases: readonly string[]): Count => ({
    families: new Set(cases.map((test) => test.replace(/\[.*\]$/, ""))).size,
    cases: cases.length,
  });
  const add = (a: Count, b: Count) => ({ families: a.families + b.families, cases: a.cases + b.cases });
  // The cases, as group::name, that `to` passes and `from` failed.
  const gained = (from: Tests, to: Tests) =>
    Object.entries(to).flatMap(([group, result]) =>
      result.passed.filter((name) => from[group]?.failed.includes(name)).map((name) => `${group}::${name}`),
    );
  const zero = { families: 0, cases: 0 };

  const within = [
    ...Map.groupBy(
      graded.filter(({ line }) => (line.commits?.length ?? 0) > 0 && line.commits![0]!.grade.tests !== undefined),
      ({ run }) => `${run.configuration}\n${run.problem}`,
    ),
  ].map(([key, checkpoints]) => {
    const [configuration, problem] = key.split("\n") as [string, string];
    const changes = checkpoints.map(({ line, tests: last }) => {
      const first = line.commits![0]!.grade;
      const fixed = gained(first.tests!, last);
      const broken = gained(last, first.tests!);
      const isOwn = (test: string) => own(test.split("::")[0]!, line.checkpoint);

      return {
        fixed,
        broken,
        own: { fixed: count(fixed.filter(isOwn)), broken: count(broken.filter(isOwn)) },
        earlier: { fixed: count(fixed.filter((test) => !isOwn(test))), broken: count(broken.filter((test) => !isOwn(test))) },
        gained: !solvedBy(first) && solvedBy(line.grade!),
        lost: solvedBy(first) && !solvedBy(line.grade!),
      };
    });

    return {
      configuration,
      problem,
      checkpoints: changes.length,
      fixedAt: changes.filter((change) => change.fixed.length > 0).length,
      brokenAt: changes.filter((change) => change.broken.length > 0).length,
      own: {
        fixed: changes.reduce((sum, change) => add(sum, change.own.fixed), zero),
        broken: changes.reduce((sum, change) => add(sum, change.own.broken), zero),
      },
      earlier: {
        fixed: changes.reduce((sum, change) => add(sum, change.earlier.fixed), zero),
        broken: changes.reduce((sum, change) => add(sum, change.earlier.broken), zero),
      },
      solvedGained: changes.filter((change) => change.gained).length,
      solvedLost: changes.filter((change) => change.lost).length,
    };
  });

  // Per problem and checkpoint, each configuration's runs' families.
  const at = Map.groupBy(graded, ({ run, line }) => `${run.problem}\n${line.checkpoint}`);
  const consistent: {
    configuration: string;
    control: string;
    problem: string;
    checkpoint: number;
    family: string;
    cases: number;
    passedBy: string;
  }[] = [];
  const shared: { problem: string; checkpoint: number; family: string; cases: number; runs: number }[] = [];

  for (const [key, entries] of [...at].toSorted(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))) {
    const [problem, n] = key.split("\n") as [string, string];
    const checkpoint = Number(n);
    const byConfiguration = Map.groupBy(
      entries.map(({ run, tests: grade }) => ({ configuration: run.configuration, families: families(grade, checkpoint) })),
      (entry) => entry.configuration,
    );
    const all = entries.map(({ tests: grade }) => families(grade, checkpoint));
    const names = [...new Set(all.flatMap((one) => [...one.keys()]))].toSorted();
    const passes = (runFamilies: Map<string, { passed: boolean }>, name: string) => runFamilies.get(name)?.passed === true;
    const casesOf = (name: string) => Math.max(...all.map((one) => one.get(name)?.cases ?? 0));
    const theirs = byConfiguration.get(control);

    for (const name of names) {
      if (all.every((one) => !passes(one, name))) {
        shared.push({ problem, checkpoint, family: name, cases: casesOf(name), runs: all.length });
      }
    }

    if (theirs === undefined) continue;

    for (const [configuration, ours] of byConfiguration) {
      if (configuration === control) continue;

      for (const name of names) {
        const every = (group: typeof ours, passed: boolean) => group.every((one) => passes(one.families, name) === passed);
        const passedBy = every(ours, true) && every(theirs, false) ? configuration : every(ours, false) && every(theirs, true) ? control : undefined;

        if (passedBy !== undefined) {
          consistent.push({ configuration, control, problem, checkpoint, family: name, cases: casesOf(name), passedBy });
        }
      }
    }
  }

  return { within, consistent, shared };
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/**
 * One configuration's runs of one problem: the complete run whose solved fraction, then erosion,
 * is nearest its median, then the first repeat; none when no run is complete.
 */
export function representative<R extends Run>(runs: readonly R[]): R | undefined {
  const complete = runs.flatMap((run) => {
    const scores = score(run);

    return scores === undefined ? [] : [{ run, solved: scores.solved!, erosion: scores.erosion }];
  });

  if (complete.length === 0) return undefined;

  const solved = median(complete.map((one) => one.solved));
  const erosions = complete.flatMap((one) => (one.erosion === undefined ? [] : [one.erosion]));
  const erosion = erosions.length === 0 ? 0 : median(erosions);
  // A run with no erosion, as one abandoned before any grade, is never nearer than one with it.
  const distance = (value: number | undefined, to: number) => (value === undefined ? Infinity : Math.abs(value - to));

  return complete.toSorted(
    (a, b) =>
      distance(a.solved, solved) - distance(b.solved, solved) ||
      distance(a.erosion, erosion) - distance(b.erosion, erosion) ||
      a.run.repeat - b.run.repeat,
  )[0]!.run;
}

// A small seeded generator (mulberry32), so intervals do not change from one summary to the next.
export function generator(seed: number) {
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
  // Breakage draws from a generator of its own, so adding it left every other metric's intervals
  // as they were.
  const random = generator(seed);
  const apart = generator(seed);
  const drawing = (metric: Metric) => {
    const source = metric === "breakage" ? apart : random;
    const pick = <T>(values: readonly T[]) => values[Math.floor(source() * values.length)]!;

    return { pick, resampledMean: (values: readonly number[]) => mean(values.map(() => pick(values))) };
  };

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
      breakage: range(valuesOf(runScores, "breakage")),
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
        const { pick, resampledMean } = drawing(metric);
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
          const { pick, resampledMean } = drawing(metric);
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

  return { incomplete, problems, overall, versus, ...tests(runs, { control }) };
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
  const tally = (count: { families: number; cases: number }) => `${count.families} (${count.cases})`;
  const diff = (value: { difference: number; low: number; high: number } | undefined) =>
    value === undefined ? "–" : `${figure(value.difference)} [${figure(value.low)}, ${figure(value.high)}]`;

  return [
    "## Per problem: mean (min–max) over complete runs",
    "",
    table(
      ["configuration", "problem", "runs", "solved", "Core", "reliable", "erosion", "verbosity", "breakage", "$", "seconds"],
      summary.problems.map((row) => [
        row.configuration,
        row.problem,
        String(row.runs),
        spread(row.solved),
        spread(row.core),
        figure(row.reliable),
        spread(row.erosion),
        spread(row.verbosity),
        spread(row.breakage),
        spread(row.usd),
        spread(row.seconds),
      ]),
    ),
    "",
    "## Per configuration: mean over problems [bootstrap 95%]",
    "",
    table(
      ["configuration", "solved", "Core", "reliable", "erosion", "verbosity", "breakage", "$ per problem"],
      summary.overall.map((row) => [
        row.configuration,
        ci(row.solved),
        ci(row.core),
        ci(row.reliable),
        ci(row.erosion),
        ci(row.verbosity),
        ci(row.breakage),
        ci(row.usd),
      ]),
    ),
    "",
    "## Against the control: difference, paired by problem [bootstrap 95%]",
    "",
    summary.versus.length === 0
      ? "No configuration to compare."
      : table(
          ["configuration", "control", "solved", "Core", "reliable", "erosion", "verbosity", "breakage", "$ per problem"],
          summary.versus.map((row) => [
            row.configuration,
            row.control,
            diff(row.solved),
            diff(row.core),
            diff(row.reliable),
            diff(row.erosion),
            diff(row.verbosity),
            diff(row.breakage),
            diff(row.usd),
          ]),
        ),
    "",
    "## Within a run: what each checkpoint's claimed commit changed from its first",
    "",
    "Test families (cases) the claimed commit passes and the checkpoint's first commit failed (fixed), or the other way " +
      "round (broken): the checkpoint's own tests, and earlier checkpoints' rerun as Regression.",
    "",
    summary.within.length === 0
      ? "No configuration made more than one commit in a checkpoint."
      : table(
          ["configuration", "problem", "checkpoints", "with a fix", "with a break", "own fixed", "own broken", "earlier fixed", "earlier broken", "solved gained", "solved lost"],
          summary.within.map((row) => [
            row.configuration,
            row.problem,
            String(row.checkpoints),
            String(row.fixedAt),
            String(row.brokenAt),
            tally(row.own.fixed),
            tally(row.own.broken),
            tally(row.earlier.fixed),
            tally(row.earlier.broken),
            String(row.solvedGained),
            String(row.solvedLost),
          ]),
        ),
    "",
    "## Consistent differences against the control",
    "",
    "Test families of a checkpoint's own tests that every run of one passes and every run of the other fails.",
    "",
    summary.consistent.length === 0
      ? "None."
      : table(
          ["configuration", "control", "problem", "checkpoint", "family", "cases", "passed by"],
          summary.consistent.map((row) => [row.configuration, row.control, row.problem, String(row.checkpoint), row.family, String(row.cases), row.passedBy]),
        ),
    "",
    "## Shared failures",
    "",
    "Test families of a checkpoint's own tests that every run of every configuration fails: no configuration here gets past them.",
    "",
    summary.shared.length === 0
      ? "None."
      : table(
          ["problem", "checkpoint", "family", "cases", "runs"],
          summary.shared.map((row) => [row.problem, String(row.checkpoint), row.family, String(row.cases), String(row.runs)]),
        ),
    "",
    summary.incomplete.length === 0
      ? "Every run is complete."
      : `Left out, not complete: ${summary.incomplete.map((run) => `${run.configuration} r${run.repeat} ${run.problem}`).join(", ")}.`,
    "",
  ].join("\n");
}
