/**
 * The commit kind's verifier: accepts a claimed SHA that is the workspace's HEAD, not already the
 * commission's subject and changing something from its parent and the subject, keeping a Git
 * bundle of it that holds its whole history.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// What the engine writes as claim.json for a commit; a subject that is not a commit has no sha.
type Claim = { fields: { sha: string }; subject: { kind: string; fields: { sha?: string } } };

// Git sees the commits as written: a step's planted grafts or replace refs could otherwise show an
// empty commit with a changed tree or parent, and a bundle with another history.
Object.assign(process.env, { GIT_GRAFT_FILE: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" });

const input = process.env.MEDRENGARD_IN!;
const output = process.env.MEDRENGARD_OUT!;

// SAFETY: the engine encodes claim.json for a commit claim with these fields.
const { fields, subject } = JSON.parse(readFileSync(join(input, "claim.json"), "utf8")) as Claim;

// The object `name` names in the workspace's repository, or undefined if it has none.
function resolve(name: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

const head = resolve("HEAD");
const tree = resolve("HEAD^{tree}");

// A root commit's parent tree is the empty tree, in the repository's own hash.
const parent =
  resolve("HEAD^^{tree}") ??
  execFileSync("git", ["hash-object", "-t", "tree", "/dev/null"], { encoding: "utf8" }).trim();

// lazy: a subject commit absent from the workspace's repository is not compared; the trigger is a
// workflow that claims commits from a workspace not built from its subject.
const subjectTree =
  subject.kind === "commit" && subject.fields.sha !== undefined
    ? resolve(`${subject.fields.sha}^{tree}`)
    : undefined;

const bundle = join(output, "commit.bundle");

// Writes the bundle and reports whether a clone of it holds HEAD's whole history: with a step's
// planted .git/shallow, git bundles less and still calls the bundle complete.
function bundledWhole(): boolean {
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
      : subject.kind === "commit" && subject.fields.sha === fields.sha
        ? { accepted: false, reason: `${fields.sha} is already the subject.` }
        : tree === parent
          ? { accepted: false, reason: `${fields.sha} changes nothing: its tree is its parent's.` }
          : tree === subjectTree
            ? {
                accepted: false,
                reason: `${fields.sha} changes nothing: its tree is the subject's.`,
              }
            : !bundledWhole()
              ? {
                  accepted: false,
                  reason: `${fields.sha}'s history is incomplete in the workspace.`,
                }
              : { accepted: true, keep: ["commit.bundle"] };

writeFileSync(join(output, "output.json"), JSON.stringify(verdict));
