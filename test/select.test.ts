// The iteration set's selection rule, on placements whose grid is worked out by hand below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { select, type Placement } from "../driver/select.ts";

// p00..p29, solve rate rising with the number: p00-p09 the hard third, p10-p19 the middle, p20-p29
// the easy. Within each third the even ones erode more (.8 against .4): even high, odd low.
const placements: Placement[] = Array.from({ length: 30 }, (_, i) => ({
  problem: `p${String(i).padStart(2, "0")}`,
  solved: i / 30,
  core: i / 30,
  erosion: (i % 2 === 0 ? 0.8 : 0.4) + i / 1000,
}));

const cellOf = (problem: string) => {
  const i = Number(problem.slice(1));

  return `${["hard", "middle", "easy"][Math.floor(i / 10)]} ${i % 2 === 0 ? "high" : "low"}`;
};

test("a selection keeps the current problems and fills each cell of solve rate by erosion from the rest", () => {
  // One current problem in each cell, so one new problem goes to each.
  const current = ["p01", "p02", "p13", "p21", "p14", "p22"];
  const chosen = select(placements, { current, perCell: 2, seed: 7 });

  assert.deepEqual(
    chosen.cells.map((cell) => `${cell.row} ${cell.erosion}`),
    ["hard low", "hard high", "middle low", "middle high", "easy low", "easy high"],
  );

  for (const cell of chosen.cells) {
    assert.ok(cell.members.every((member) => cellOf(member.problem) === `${cell.row} ${cell.erosion}`));
    assert.equal(cell.members.length, 5);
    assert.equal(cell.members.filter((member) => member.as !== "left").length, 2);
  }

  assert.equal(chosen.iteration.length, 12);
  assert.deepEqual(chosen.iteration.slice(0, 6), current);
  assert.ok(chosen.chosen.every((problem) => !current.includes(problem)));

  // Seeded: the same placements and seed choose the same problems.
  assert.deepEqual(select(placements, { current, perCell: 2, seed: 7 }), chosen);
});

test("a cell the current problems overfill keeps them all, and the cells left short are chosen by seed", () => {
  // Three current problems in easy low: 6 new places for 7 missing, so one cell stays a problem short.
  const current = ["p01", "p02", "p13", "p21", "p23", "p25"];
  const chosen = select(placements, { current, perCell: 2, seed: 7 });
  const kept = (row: string, erosion: string) =>
    chosen.cells.find((cell) => cell.row === row && cell.erosion === erosion)!.members.filter((m) => m.as !== "left").length;

  assert.equal(kept("easy", "low"), 3);
  assert.equal(chosen.chosen.length, 6);
  assert.equal(chosen.iteration.length, 12);
  assert.deepEqual(
    chosen.cells.map((cell) => cell.members.filter((m) => m.as !== "left").length).sort(),
    [1, 2, 2, 2, 2, 3],
  );
});

test("ties in solve rate are ranked by Core pass fraction, then by name", () => {
  // All solve every checkpoint, so Core ranks them: e, then c and d tied (c by name), b, a and f.
  // Thirds of two, each split at its erosion: hard e low, c high; middle b low, d high; easy a, f.
  // By name alone the hard third would be a and b; by input order d would be hard, not c.
  const tied: Placement[] = [
    { problem: "f", solved: 1, core: 1, erosion: 0.9 },
    { problem: "d", solved: 1, core: 0.8, erosion: 0.5 },
    { problem: "c", solved: 1, core: 0.8, erosion: 0.6 },
    { problem: "a", solved: 1, core: 1, erosion: 0.1 },
    { problem: "b", solved: 1, core: 0.9, erosion: 0.4 },
    { problem: "e", solved: 1, core: 0.5, erosion: 0.2 },
  ];
  const chosen = select(tied, { current: [], perCell: 1, seed: 1 });

  assert.deepEqual(
    chosen.cells.map((cell) => [cell.row, cell.erosion, cell.members.map((member) => member.problem)]),
    [
      ["hard", "low", ["e"]],
      ["hard", "high", ["c"]],
      ["middle", "low", ["b"]],
      ["middle", "high", ["d"]],
      ["easy", "low", ["a"]],
      ["easy", "high", ["f"]],
    ],
  );
});

test("a cell with too few problems to draw from stops the selection for the owner", () => {
  assert.throws(
    () => select(placements.slice(0, 6), { current: [], perCell: 2, seed: 1 }),
    /hard low has 1 problem to draw from, 2 wanted/,
  );
});
