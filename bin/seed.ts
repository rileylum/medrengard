// The seed step: checks out the branch the driver made for this commission, and claims it.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [trajectories] = process.argv.slice(2);
// SAFETY: the engine writes input.json with the commission's name.
const { commission } = JSON.parse(
  readFileSync(join(process.env.MEDRENGARD_IN!, "input.json"), "utf8"),
) as { commission: string };

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

git("clone", "--quiet", "--no-local", "--single-branch", "--branch", commission, trajectories!, ".");

git("remote", "remove", "origin");

writeFileSync(
  join(process.env.MEDRENGARD_OUT!, "output.json"),
  JSON.stringify({ outcome: "done", artifacts: [{ kind: "commit", fields: { sha: git("rev-parse", "HEAD") } }] }),
);
