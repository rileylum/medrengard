/**
 * The commit kind's materialiser: clones the commit's kept bundle into the workspace and checks
 * out its SHA, then adds each commit branches.json lists as its branch, leaving no remote behind.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { input, readArtifact, readBranches, type Materialised } from "../step/contract.ts";

// A commit's one field is its sha, and its verifier kept its bundle.
const bundleOf = ({ kept }: Materialised) => join(input, kept["commit.bundle"]!);
const artifact = readArtifact();

const git = (...args: string[]) => execFileSync("git", args, { stdio: "ignore" });

git("clone", "--quiet", "--no-checkout", bundleOf(artifact), ".");

git("checkout", "--quiet", "--detach", artifact.fields.sha!);

git("remote", "remove", "origin");

for (const added of readBranches()) {
  git("fetch", "--quiet", bundleOf(added), `${added.fields.sha}:refs/heads/${added.branch}`);
}
