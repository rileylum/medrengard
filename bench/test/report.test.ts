// A study's summary, from result lines whose figures are worked out by hand below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { representative, summarise, type Run } from "../driver/report.ts";

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
