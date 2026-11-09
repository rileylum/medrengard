// A study's summary, from result lines whose figures are worked out by hand below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { breakage, representative, summarise, tests, type Run } from "../driver/report.ts";

const graded = (checkpoint: number, passed: number, total: number, erosion: number, verbosity: number, usd: number) => ({
  checkpoint,
  checkpoints: 2,
  status: "finished",
  solved: passed === total,
  erosion,
  verbosity,
  cost: { usd },
  seconds: 10,
  grade: { pass_counts: { Core: passed }, total_counts: { Core: total } },
});

const runs: Run[] = [
  // Solves both: solved 1, Core 1, reliable; erosion (.5 + .7) / 2 = .6; $3.
  { configuration: "base", problem: "p", repeat: 1, lines: [graded(1, 2, 2, 0.5, 0.2, 1), graded(2, 3, 3, 0.7, 0.4, 2)] },
  // Misses checkpoint 2: solved .5, Core (1 + 1/3) / 2 = 2/3; erosion .5; $2.
  { configuration: "base", problem: "p", repeat: 2, lines: [graded(1, 2, 2, 0.4, 0.2, 1), graded(2, 1, 3, 0.6, 0.2, 1)] },
  // Waiting for the owner: left out, and listed.
  {
    configuration: "base",
    problem: "p",
    repeat: 3,
    lines: [{ checkpoint: 1, checkpoints: 2, status: "escalated", cost: null }],
  },
  // Abandoned at checkpoint 2, which counts as unsolved with no Core test passing: solved .5, Core .5.
  {
    configuration: "other",
    problem: "p",
    repeat: 1,
    lines: [graded(1, 2, 2, 0.3, 0.1, 1), { checkpoint: 2, checkpoints: 2, status: "abandoned", cost: { usd: 4 } }],
  },
];

test("a summary gives each problem's mean and range over complete runs, and leaves out runs still waiting", () => {
  const summary = summarise(runs, { control: "base" });

  assert.deepEqual(summary.incomplete, [{ configuration: "base", problem: "p", repeat: 3 }]);

  const base = summary.problems.find((row) => row.configuration === "base")!;

  assert.equal(base.runs, 2);
  assert.deepEqual(base.solved, { mean: 0.75, min: 0.5, max: 1 });
  assert.ok(Math.abs(base.core.mean! - 5 / 6) < 1e-9);
  assert.equal(base.reliable, 0.5);
  assert.ok(Math.abs(base.erosion.mean! - 0.55) < 1e-9);
  assert.deepEqual(base.usd, { mean: 2.5, min: 2, max: 3 });

  const other = summary.problems.find((row) => row.configuration === "other")!;

  assert.deepEqual(other.solved, { mean: 0.5, min: 0.5, max: 0.5 });
  assert.deepEqual(other.core, { mean: 0.5, min: 0.5, max: 0.5 });
  assert.equal(other.reliable, 0);
  assert.equal(other.usd.mean, 5);
});

test("a summary's intervals resample problems, then repeats, and compare each configuration with the control", () => {
  const summary = summarise(runs, { control: "base" });

  // One problem with repeats solving 1 and .5: a resampled mean is .5, .75 or 1.
  const base = summary.overall.find((row) => row.configuration === "base")!;

  assert.deepEqual(base.solved, { mean: 0.75, low: 0.5, high: 1 });

  // other's .5 against base's: a difference of -.5, -.25 or 0.
  const versus = summary.versus.find((row) => row.configuration === "other")!;

  assert.equal(versus.control, "base");
  assert.deepEqual(versus.solved, { difference: -0.25, low: -0.5, high: 0 });

  // Seeded: the same lines give the same summary.
  assert.deepEqual(summarise(runs, { control: "base" }), summary);
});

test("a problem's representative run is its median: solved, then erosion, nearest the median, then the first repeat", () => {
  const run = (repeat: number, solves: boolean[], erosion: number): Run => ({
    configuration: "base",
    problem: "p",
    repeat,
    lines: solves.map((solved, index) => ({
      ...graded(index + 1, solved ? 1 : 0, 1, erosion, 0.2, 1),
      checkpoints: solves.length,
    })),
  });
  const waiting: Run = {
    configuration: "base",
    problem: "p",
    repeat: 9,
    lines: [{ checkpoint: 1, checkpoints: 2, status: "escalated", cost: null }],
  };

  // Solved 1, .25, .75, .25, .5: the median .5 is repeat 5's alone; a run still waiting is not a candidate.
  const spread = [
    run(1, [true, true, true, true], 0.1),
    run(2, [true, false, false, false], 0.1),
    run(3, [true, true, true, false], 0.1),
    run(4, [true, false, false, false], 0.1),
    run(5, [true, true, false, false], 0.9),
    waiting,
  ];

  assert.equal(representative(spread)?.repeat, 5);

  // All solved 1: erosion .9, .5, .6 has the median .6, repeat 3's.
  const tied = [run(1, [true], 0.9), run(2, [true], 0.5), run(3, [true], 0.6)];

  assert.equal(representative(tied)?.repeat, 3);

  // Solved and erosion the same: the first repeat. Even counts take the mean of the middle two:
  // solved 0 and 1 have the median .5, each as near; erosion the same; repeat 2 comes first.
  assert.equal(representative([run(4, [true], 0.5), run(2, [false], 0.5)])?.repeat, 2);

  // No complete run: none.
  assert.equal(representative([waiting]), undefined);
});

// A graded checkpoint whose tests are given by group, as the grader's report lists them.
const tested = (checkpoint: number, tests: Record<string, { passed?: string[]; failed?: string[] }>) => ({
  checkpoint,
  checkpoints: 3,
  status: "finished",
  cost: null,
  grade: {
    pass_counts: {},
    total_counts: {},
    tests: Object.fromEntries(
      Object.entries(tests).map(([group, { passed = [], failed = [] }]) => [group, { passed, failed, skipped: [] }]),
    ),
  },
});

test("breakage is, at each later checkpoint, the share of tests passed in their own checkpoint that now fail", () => {
  const run: Run = {
    configuration: "base",
    problem: "p",
    repeat: 1,
    lines: [
      // Checkpoint 1 passes a and b in its own groups and fails c, which never counts.
      tested(1, { "checkpoint_1-Core": { passed: ["a"], failed: ["c"] }, "checkpoint_1-Error": { passed: ["b"] } }),
      // A first grade of checkpoint 2, replaced by the next line.
      tested(2, { "checkpoint_1-Regression": { failed: ["a", "b", "c"] }, "checkpoint_2-Core": { passed: ["d"] } }),
      // Checkpoint 2 breaks b of checkpoint 1's two: 1/2. Some problems also grade a checkpoint's own
      // Regression group, which is neither its own tests nor a later breakage.
      tested(2, {
        "checkpoint_1-Regression": { passed: ["a"], failed: ["b", "c"] },
        "checkpoint_2-Core": { passed: ["d", "e"] },
        "checkpoint_2-Regression": { passed: ["x"], failed: ["d"] },
      }),
      // Checkpoint 3 breaks a and d of the four passed before it: 2/4.
      tested(3, {
        "checkpoint_1-Regression": { passed: ["b"], failed: ["a", "c"] },
        "checkpoint_2-Regression": { passed: ["e"], failed: ["d"] },
        "checkpoint_3-Core": { passed: ["f"] },
      }),
    ],
  };

  assert.deepEqual(breakage(run), [
    { checkpoint: 2, broken: 1, passed: 2 },
    { checkpoint: 3, broken: 2, passed: 4 },
  ]);
});

test("breakage leaves out checkpoints with no tests listed, as their harness's calibration runs", () => {
  const untested = { checkpoint: 2, checkpoints: 2, status: "finished", cost: null, grade: { pass_counts: {}, total_counts: {} } };
  const run: Run = {
    configuration: "slopcodebench",
    problem: "p",
    repeat: 1,
    lines: [tested(1, { "checkpoint_1-Core": { passed: ["a"] } }), untested],
  };

  assert.deepEqual(breakage(run), []);
});

test("breakage is one of a summary's metrics, per problem, per configuration and against the control", () => {
  const graded = (checkpoint: number, groups: Record<string, { passed?: string[]; failed?: string[] }>) => ({
    ...tested(checkpoint, groups),
    checkpoints: 2,
    solved: true,
    grade: { ...tested(checkpoint, groups).grade, pass_counts: { Core: 1 }, total_counts: { Core: 1 } },
  });
  const run = (configuration: string, broken: string[]): Run => ({
    configuration,
    problem: "p",
    repeat: 1,
    lines: [
      graded(1, { "checkpoint_1-Core": { passed: ["a", "b"] } }),
      graded(2, {
        "checkpoint_1-Regression": { passed: ["a", "b"].filter((name) => !broken.includes(name)), failed: broken },
        "checkpoint_2-Core": { passed: ["c"] },
      }),
    ],
  });
  // base breaks b of a and b at checkpoint 2: .5; other breaks nothing.
  const summary = summarise([run("base", ["b"]), run("other", [])], { control: "base" });

  assert.equal(summary.problems.find((row) => row.configuration === "base")!.breakage.mean, 0.5);
  assert.deepEqual(summary.overall.find((row) => row.configuration === "base")!.breakage, { mean: 0.5, low: 0.5, high: 0.5 });
  assert.equal(summary.versus[0]!.breakage!.difference, -0.5);
});

// The tests of one checkpoint's grade, by group, and its Core counts.
const gradeOf = (groups: Record<string, { passed?: string[]; failed?: string[] }>) => {
  const { grade } = tested(1, groups);
  const core = Object.entries(grade.tests).filter(([group]) => group.endsWith("-Core"));

  return {
    ...grade,
    pass_counts: { Core: core.reduce((sum, [, result]) => sum + result.passed.length, 0) },
    total_counts: { Core: core.reduce((sum, [, result]) => sum + result.passed.length + result.failed.length, 0) },
  };
};
// A run's line for a checkpoint: the claimed commit's grade, and the earlier commits' if any.
const line = (
  checkpoint: number,
  claimed: Record<string, { passed?: string[]; failed?: string[] }>,
  earlier?: Record<string, { passed?: string[]; failed?: string[] }>,
) => ({
  checkpoint,
  checkpoints: 2,
  status: "finished",
  cost: null,
  grade: gradeOf(claimed),
  ...(earlier === undefined ? {} : { commits: [{ commit: "c0", grade: gradeOf(earlier) }] }),
});

// At checkpoint 1, family b has two cases; e fails in every run. Checkpoint 2 adds c, and reruns
// checkpoint 1's tests.
const unfixed = { "checkpoint_1-Core": { passed: ["a"], failed: ["b[1]", "b[2]"] }, "checkpoint_1-Error": { failed: ["e"] } };
const fixed = { "checkpoint_1-Core": { passed: ["a", "b[1]", "b[2]"] }, "checkpoint_1-Error": { failed: ["e"] } };
// Family d at checkpoint 2 passes only in review r1: not every run of review, so no consistent
// difference, and not failed by every run, so not shared.
const second = (failing: string[], d = false) => ({
  "checkpoint_1-Regression": { passed: ["a", "b[1]", "b[2]"].filter((name) => !failing.includes(name)), failed: [...failing, "e"] },
  "checkpoint_2-Core": { passed: ["c"] },
  "checkpoint_2-Functionality": d ? { passed: ["d"] } : { failed: ["d"] },
});
const studied: Run[] = [
  // The control never fixes b.
  ...[1, 2].map((repeat) => ({
    configuration: "base",
    problem: "p",
    repeat,
    lines: [line(1, unfixed), line(2, second(["b[1]", "b[2]"]))],
  })),
  // review r1's review fixes b at checkpoint 1, solving it, and at checkpoint 2 restores a, which
  // its work there broke.
  { configuration: "review", problem: "p", repeat: 1, lines: [line(1, fixed, unfixed), line(2, second([], true), second(["a"], true))] },
  // review r2's work had b right already; its review changes nothing.
  { configuration: "review", problem: "p", repeat: 2, lines: [line(1, fixed, fixed), line(2, second([]), second([]))] },
];

test("within a run, what the claimed commit changed from the first commit of its checkpoint, by test family", () => {
  assert.deepEqual(tests(studied, { control: "base" }).within, [
    {
      configuration: "review",
      problem: "p",
      checkpoints: 4,
      fixedAt: 2,
      brokenAt: 0,
      own: { fixed: { families: 1, cases: 2 }, broken: { families: 0, cases: 0 } },
      earlier: { fixed: { families: 1, cases: 1 }, broken: { families: 0, cases: 0 } },
      solvedGained: 1,
      solvedLost: 0,
    },
  ]);
});

test("a family every run of one passes and every run of the other fails is a consistent difference", () => {
  assert.deepEqual(tests(studied, { control: "base" }).consistent, [
    { configuration: "review", control: "base", problem: "p", checkpoint: 1, family: "checkpoint_1-Core::b", cases: 2, passedBy: "review" },
  ]);
});

test("a family every run of every configuration fails at a checkpoint is a shared failure", () => {
  assert.deepEqual(tests(studied, { control: "base" }).shared, [
    { problem: "p", checkpoint: 1, family: "checkpoint_1-Error::e", cases: 1, runs: 4 },
  ]);
});
