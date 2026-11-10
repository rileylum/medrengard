/**
 * The commit kind's verifier: accepts a claimed SHA that is the workspace's HEAD, not already the
 * commission's subject and changing something from its parent and the subject, keeping a Git
 * bundle of it that holds its whole history. A subject of any kind that names a sha, such as a
 * factory's own start, is compared as a commit is.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { accept, output, readClaim, reject } from "../step/contract.ts";

// Git sees the commits as written: a step's planted grafts or replace refs could otherwise show an
// empty commit with a changed tree or parent, and a bundle with another history.
Object.assign(process.env, { GIT_GRAFT_FILE: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" });

// A commit's one field is its sha; a subject that names no commit has none.
const { fields, subject } = readClaim();

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
  subject.fields.sha === undefined ? undefined : resolve(`${subject.fields.sha}^{tree}`);

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

// Why the claim is refused, if it is: the first that holds.
const refusal =
  head === undefined
    ? "The workspace has no Git HEAD."
    : head !== fields.sha
      ? `HEAD is ${head}, not ${fields.sha}.`
      : subject.fields.sha === fields.sha
        ? `${fields.sha} is already the subject.`
        : tree === parent
          ? `${fields.sha} changes nothing: its tree is its parent's.`
          : tree === subjectTree
            ? `${fields.sha} changes nothing: its tree is the subject's.`
            : !bundledWhole()
              ? `${fields.sha}'s history is incomplete in the workspace.`
              : undefined;

if (refusal === undefined) {
  accept(["commit.bundle"]);
} else {
  reject(refusal);
}
