// The start kind's verifier: accepts a claimed SHA that is the workspace's HEAD and keeps a Git
// bundle of its whole history, named as the commit materialiser reads it. Unlike a commit, a start
// need not change anything: it is what a checkpoint is given, such as an empty repository.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// As the commit verifier does: Git sees the commits as written, not through grafts or replace refs.
Object.assign(process.env, { GIT_GRAFT_FILE: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" });

const output = process.env.MEDRENGARD_OUT!;
// SAFETY: the engine encodes claim.json for a start claim with its sha field.
const { fields } = JSON.parse(readFileSync(join(process.env.MEDRENGARD_IN!, "claim.json"), "utf8")) as {
  fields: { sha: string };
};

let head: string | undefined;

try {
  head = execFileSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  head = undefined;
}

// Whether a clone of the bundle holds HEAD's whole history, which a planted .git/shallow can cut.
function bundledWhole() {
  const bundle = join(output, "commit.bundle");
  const clone = join(output, "clone");

  execFileSync("git", ["bundle", "create", "--quiet", bundle, "HEAD"], { stdio: "ignore" });
  execFileSync("git", ["clone", "--quiet", "--bare", bundle, clone], { stdio: "ignore" });

  try {
    execFileSync("git", ["-C", clone, "rev-list", "--objects", fields.sha], { stdio: "ignore" });

    return true;
  } catch {
    return false;
  } finally {
    rmSync(clone, { recursive: true });
  }
}

const verdict =
  head === undefined
    ? { accepted: false, reason: "The workspace has no Git HEAD." }
    : head !== fields.sha
      ? { accepted: false, reason: `HEAD is ${head}, not ${fields.sha}.` }
      : !bundledWhole()
        ? { accepted: false, reason: `${fields.sha}'s history is incomplete in the workspace.` }
        : { accepted: true, keep: ["commit.bundle"] };

writeFileSync(join(output, "output.json"), JSON.stringify(verdict));
