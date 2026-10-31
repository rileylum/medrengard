/**
 * The commit kind's verifier: accepts a claimed SHA that is the workspace's HEAD and not already
 * the commission's subject, keeping a Git bundle of it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// What the engine writes as claim.json for a commit; a subject that is not a commit has no sha.
type Claim = { fields: { sha: string }; subject: { kind: string; fields: { sha?: string } } };

const input = process.env.MEDRENGARD_IN!;
const output = process.env.MEDRENGARD_OUT!;

// SAFETY: the engine encodes claim.json for a commit claim with these fields.
const { fields, subject } = JSON.parse(readFileSync(join(input, "claim.json"), "utf8")) as Claim;

let head: string | undefined;

try {
  head = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  head = undefined;
}

const verdict =
  head === undefined
    ? { accepted: false, reason: "The workspace has no Git HEAD." }
    : head !== fields.sha
      ? { accepted: false, reason: `HEAD is ${head}, not ${fields.sha}.` }
      : subject.kind === "commit" && subject.fields.sha === fields.sha
        ? { accepted: false, reason: `${fields.sha} is already the subject.` }
        : { accepted: true, keep: ["commit.bundle"] };

if (verdict.accepted) {
  execFileSync("git", ["bundle", "create", "--quiet", join(output, "commit.bundle"), "HEAD"], {
    stdio: "ignore",
  });
}

writeFileSync(join(output, "output.json"), JSON.stringify(verdict));
