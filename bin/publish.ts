// The publish step: pushes the commission's commit to refs/results/<commission>, for the driver.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [trajectories] = process.argv.slice(2);
// SAFETY: the engine writes input.json with the commission's name.
const { commission } = JSON.parse(
  readFileSync(join(process.env.MEDRENGARD_IN!, "input.json"), "utf8"),
) as { commission: string };

execFileSync("git", ["push", "--quiet", trajectories!, `HEAD:refs/results/${commission}`]);

writeFileSync(join(process.env.MEDRENGARD_OUT!, "output.json"), JSON.stringify({ outcome: "done" }));
