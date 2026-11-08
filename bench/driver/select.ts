// The iteration set's selection rule. Every candidate is placed by one baseline run on a grid:
// ranked by solve rate (ties by Core pass fraction, then name) into thirds, hard, middle and easy,
// each split at its median erosion into low and high. The current problems stay; each cell is
// filled to `perCell` from the rest, by seed, and when the current ones overfill a cell, the seed
// also picks which cells stay short. Pure, so the same placements and seed give the same set.
import { generator } from "./report.ts";

/** One problem as one baseline run placed it. */
export type Placement = { problem: string; solved: number; core: number; erosion: number };

const rows = ["hard", "middle", "easy"] as const;
const halves = ["low", "high"] as const;

type Member = Placement & { as: "current" | "chosen" | "left" };

/** Selects the iteration set: the current problems, then those chosen to fill the grid. */
export function select(
  placements: readonly Placement[],
  { current, perCell, seed }: { current: readonly string[]; perCell: number; seed: number },
) {
  const random = generator(seed);
  const ranked = [...placements].sort(
    (a, b) => a.solved - b.solved || a.core - b.core || a.problem.localeCompare(b.problem),
  );
  const third = (index: number) => Math.floor((index * rows.length) / ranked.length);
  const cells = rows.flatMap((row, r) => {
    const members = ranked
      .filter((_, index) => third(index) === r)
      .sort((a, b) => a.erosion - b.erosion || a.problem.localeCompare(b.problem));
    const half = Math.ceil(members.length / 2);

    return halves.map((erosion, h) => ({
      row,
      erosion,
      members: (h === 0 ? members.slice(0, half) : members.slice(half)).map(
        (member): Member => ({ ...member, as: current.includes(member.problem) ? "current" : "left" }),
      ),
    }));
  });

  // Fisher-Yates on a copy, drawing from the one seeded generator in a fixed order.
  const shuffled = <T>(items: readonly T[]) => {
    const copy = [...items];

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));

      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }

    return copy;
  };

  // One unit per place a cell is short; the new places go to as many of them as there are.
  const places = rows.length * halves.length * perCell - current.length;
  const short = cells.flatMap((cell) => {
    const missing = Math.max(0, perCell - cell.members.filter((member) => member.as === "current").length);
    const free = cell.members.filter((member) => member.as === "left").length;

    if (free < missing) {
      // lazy: stops for the owner rather than moving the place to another cell; trigger: a grid
      // whose cells hold fewer candidates than perCell.
      throw new Error(`${cell.row} ${cell.erosion} has ${free} problem${free === 1 ? "" : "s"} to draw from, ${missing} wanted`);
    }

    return Array.from({ length: missing }, () => cell);
  });

  for (const cell of shuffled(short).slice(0, places)) {
    const pick = shuffled(cell.members.filter((member) => member.as === "left"))[0]!;

    pick.as = "chosen";
  }

  for (const cell of cells) cell.members.sort((a, b) => a.problem.localeCompare(b.problem));

  const chosen = cells.flatMap((cell) => cell.members.filter((member) => member.as === "chosen").map((m) => m.problem));

  return { cells, chosen, iteration: [...current, ...chosen] };
}

/** The grid as markdown: each cell's problems, the current marked *, the chosen marked +. */
export function render(selection: ReturnType<typeof select>) {
  const mark = { current: "*", chosen: "+", left: "" };
  const lines = selection.cells.map(
    (cell) =>
      `| ${cell.row} | ${cell.erosion} | ${cell.members
        .map((m) => `${mark[m.as]}${m.problem} (${m.solved.toFixed(2)}, ${m.erosion.toFixed(2)})`)
        .join(", ")} |`,
  );

  return [
    "## Selection: solve rate thirds by erosion halves",
    "",
    "Each problem with its solve rate and erosion; * current, + chosen.",
    "",
    "| solve rate | erosion | problems |",
    "|---|---|---|",
    ...lines,
    "",
    `Iteration set: ${selection.iteration.join(", ")}.`,
    "",
  ].join("\n");
}
