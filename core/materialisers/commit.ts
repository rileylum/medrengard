/**
 * The commit kind's materialiser: clones the commit's kept bundle into the workspace and checks
 * out its SHA, leaving no remote behind.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the engine writes as artifact.json for a commit; kept paths are relative to the input.
type Artifact = { fields: { sha: string }; kept: { "commit.bundle": string } };

const input = process.env.MEDRENGARD_IN!;

// SAFETY: the engine encodes artifact.json for a commit with these fields.
const { fields, kept } = JSON.parse(readFileSync(join(input, "artifact.json"), "utf8")) as Artifact;

const git = (...args: string[]) => execFileSync("git", args, { stdio: "ignore" });

git("clone", "--quiet", "--no-checkout", join(input, kept["commit.bundle"]), ".");

git("checkout", "--quiet", "--detach", fields.sha);

git("remote", "remove", "origin");
