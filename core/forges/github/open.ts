/**
 * The GitHub forge's open step: pushes the subject commit, its workspace, to
 * medrengard/<commission> and opens a pull request of it against the base branch, titled with the
 * request's title, its body the request's body and the commit's report, each cut where it is over
 * 20000 characters, then claims it. With one open for the branch already, as after a fix, the push
 * updates it and it is the one claimed. It reaches GitHub only through the broker.
 *
 * Usage: open.ts <owner/name> <base>
 */
import { execFileSync } from "node:child_process";
import { artifactsOf, bodyOf, claim, failed, readInput } from "../../step/contract.ts";

// SAFETY: the open step's run passes the repository and the base branch.
const [repository, base] = process.argv.slice(2) as [string, string];
const broker = process.env.MEDRENGARD_BROKER_GITHUB!;
const given = readInput();

// The step declares the inputs request and subject, which each always hold one artifact.
const request = artifactsOf(given, "request")[0]!;
const subject = artifactsOf(given, "subject")[0]!;
const branch = `medrengard/${given.commission}`;

// The placeholder, which the broker replaces with the token; no proxy, the broker being on loopback.
// Git's stderr is kept for a failure alone: GitHub always answers a push with a hint there.
try {
  execFileSync(
    "git",
    [
      "-c",
      "http.extraHeader=Authorization: Bearer medrengard-broker",
      "-c",
      "http.proxy=",
      "push",
      "--quiet",
      "--force",
      `${broker}/git/${repository}.git`,
      `HEAD:refs/heads/${branch}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
} catch (error) {
  // SAFETY: execFileSync throws an error carrying the child's piped stderr.
  const { stderr } = error as { stderr: Buffer };

  failed(`The push to ${repository} failed: ${stderr}`);
}

// GitHub refuses a pull request whose body is over 65536 characters, and nobody reads one that
// long: each part is cut at the end of a line, and says where the whole of it is.
const most = 20_000;

const cut = (text: string) =>
  text.length <= most
    ? text
    : `${text.slice(0, Math.max(text.lastIndexOf("\n", most), 0) || most).trimEnd()}\n\n_Cut here for length: the whole of it is in the record of the commission \`${given.commission}\`._`;

const report = cut(bodyOf(subject) ?? "");
const asked = cut(bodyOf(request) ?? "");

const response = await fetch(`${broker}/api/repos/${repository}/pulls`, {
  method: "POST",
  headers: { authorization: "Bearer medrengard-broker", "content-type": "application/json" },
  body: JSON.stringify({
    title: request.fields.title,
    body: report === "" ? asked : `${asked}\n\n${report}`,
    head: branch,
    base,
  }),
});

const said = await response.text();

// GitHub answers 422 when a pull request of the branch is open already, as after a fix: the push
// above updated it, and it is the one to claim.
const reused =
  response.status === 422
    ? await fetch(
        `${broker}/api/repos/${repository}/pulls?head=${repository.split("/")[0]}:${branch}&state=open`,
        { headers: { authorization: "Bearer medrengard-broker" } },
      )
    : undefined;

// SAFETY: GitHub lists open pull requests with their numbers and pages.
const open = reused?.ok ? ((await reused.json()) as { number: number; html_url: string }[]) : [];

if (!response.ok && open.length === 0) {
  failed(`GitHub refused to open the pull request (${response.status}): ${said}`);
}

// SAFETY: GitHub answers a pull request it opened with its number and page.
const { number, html_url: url } = response.ok
  ? (JSON.parse(said) as { number: number; html_url: string })
  : open[0]!;

claim("done", [{ kind: "pull-request", fields: { repository, number: String(number), url } }]);
