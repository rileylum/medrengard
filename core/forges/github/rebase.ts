/**
 * The GitHub forge's rebase step: fetches the base branch and rebases the subject, its workspace,
 * onto it, claiming the rebased commit. If they conflict, it claims conflict with a document
 * listing the conflicting files, one per line. It reaches GitHub only through the broker.
 *
 * lazy: it resolves no conflict; the factory routes conflict to the owner or an agent. Resolve
 * them here once a factory meets them often.
 *
 * Usage: rebase.ts <owner/name> <base>
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// SAFETY: the rebase step's run passes the repository and the base branch.
const [repository, base] = process.argv.slice(2) as [string, string];
const output = process.env.MEDRENGARD_OUT!;
const broker = process.env.MEDRENGARD_BROKER_GITHUB!;

/** Runs git with `args`, returning its stdout; its stderr is kept for a failure alone. */
const git = (...args: string[]) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

try {
  // The placeholder, which the broker replaces with the token; no proxy, the broker being on loopback.
  git(
    "-c",
    "http.extraHeader=Authorization: Bearer medrengard-broker",
    "-c",
    "http.proxy=",
    "fetch",
    "--quiet",
    `${broker}/git/${repository}.git`,
    `refs/heads/${base}`,
  );
} catch (error) {
  // SAFETY: execFileSync throws an error carrying the child's piped stderr.
  const { stderr } = error as { stderr: string };

  console.error(`The fetch of ${base} from ${repository} failed: ${stderr}`);
  process.exit(1);
}

let outcome;

try {
  git("rebase", "--quiet", "FETCH_HEAD");
  outcome = {
    outcome: "done",
    artifacts: [{ kind: "commit", fields: { sha: git("rev-parse", "HEAD") } }],
  };
} catch {
  const conflicting = git("diff", "--name-only", "--diff-filter=U");

  if (conflicting === "") {
    console.error(`The rebase onto ${base} failed, with no conflicting file.`);
    process.exit(1);
  }

  git("rebase", "--abort");
  writeFileSync(join(output, "conflicts.md"), `${conflicting}\n`);
  outcome = {
    outcome: "conflict",
    artifacts: [
      {
        kind: "document",
        fields: { title: `Conflicts rebasing onto ${base}` },
        body: "conflicts.md",
      },
    ],
  };
}

writeFileSync(join(output, "output.json"), JSON.stringify(outcome));
