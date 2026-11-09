/**
 * The GitHub forge's open step: pushes the subject commit, its workspace, to
 * medrengard/<commission> and opens a pull request of it against the base branch, titled with the
 * request's title, its body the request's body and the commit's report, then claims it. It reaches
 * GitHub only through the broker.
 *
 * Usage: open.ts <owner/name> <base>
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// SAFETY: the open step's run passes the repository and the base branch.
const [repository, base] = process.argv.slice(2) as [string, string];
const input = process.env.MEDRENGARD_IN!;
const broker = process.env.MEDRENGARD_BROKER_GITHUB!;

// What input.json lists of the request and the subject.
type Listed = { fields: Record<string, string>; body?: string };

// SAFETY: the engine writes input.json, and the step declares the inputs request and subject.
const { commission, inputs } = JSON.parse(readFileSync(join(input, "input.json"), "utf8")) as {
  commission: string;
  inputs: { request: [Listed]; subject: [Listed] };
};

const [request] = inputs.request;
const [subject] = inputs.subject;

const bodyOf = (listed: Listed) =>
  listed.body === undefined ? "" : readFileSync(join(input, listed.body), "utf8");

const branch = `medrengard/${commission}`;

// The placeholder, which the broker replaces with the token; no proxy, the broker being on loopback.
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
  { stdio: ["ignore", "ignore", "inherit"] },
);

const report = bodyOf(subject);

const response = await fetch(`${broker}/api/repos/${repository}/pulls`, {
  method: "POST",
  headers: { authorization: "Bearer medrengard-broker", "content-type": "application/json" },
  body: JSON.stringify({
    title: request.fields.title,
    body: report === "" ? bodyOf(request) : `${bodyOf(request)}\n\n${report}`,
    head: branch,
    base,
  }),
});

const said = await response.text();

if (!response.ok) {
  console.error(`GitHub refused to open the pull request (${response.status}): ${said}`);
  process.exit(1);
}

// SAFETY: GitHub answers a pull request it opened with its number and page.
const { number, html_url: url } = JSON.parse(said) as { number: number; html_url: string };

writeFileSync(
  join(process.env.MEDRENGARD_OUT!, "output.json"),
  JSON.stringify({
    outcome: "done",
    artifacts: [{ kind: "pull-request", fields: { repository, number: String(number), url } }],
  }),
);
