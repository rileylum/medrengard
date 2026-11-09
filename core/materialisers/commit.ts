/**
 * The commit kind's materialiser: clones the commit's kept bundle into the workspace and checks
 * out its SHA, then adds each commit branches.json lists as its branch, leaving no remote behind.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// What the engine writes as artifact.json for a commit, and for each of branches.json with its
// branch; kept paths are relative to the input.
type Artifact = { fields: { sha: string }; kept: { "commit.bundle": string } };

const input = process.env.MEDRENGARD_IN!;

const read = (file: string) => readFileSync(join(input, file), "utf8");

// SAFETY: the engine encodes artifact.json for a commit with these fields.
const { fields, kept } = JSON.parse(read("artifact.json")) as Artifact;

const git = (...args: string[]) => execFileSync("git", args, { stdio: "ignore" });

git("clone", "--quiet", "--no-checkout", join(input, kept["commit.bundle"]), ".");

git("checkout", "--quiet", "--detach", fields.sha);

git("remote", "remove", "origin");

// Present only when the step adds branches.
const listed = existsSync(join(input, "branches.json")) ? read("branches.json") : "[]";

// SAFETY: the engine encodes branches.json as commits, each with its branch.
const branches = JSON.parse(listed) as (Artifact & { branch: string })[];

for (const { branch, fields: added, kept: files } of branches) {
  git("fetch", "--quiet", join(input, files["commit.bundle"]), `${added.sha}:refs/heads/${branch}`);
}
