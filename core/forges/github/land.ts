/**
 * The GitHub forge's land step: merges the latest pull request about the subject, only while its
 * head is still the subject's SHA, which GitHub checks. A refused merge, such as a moved head, a
 * conflict or failing required checks, fails the step, saying why, so the commission escalates.
 * It reaches GitHub only through the broker.
 *
 * Usage: land.ts <merge|squash|rebase>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// SAFETY: the land step's run passes the merge method.
const [method] = process.argv.slice(2) as [string];
const input = process.env.MEDRENGARD_IN!;
const broker = process.env.MEDRENGARD_BROKER_GITHUB!;

type Listed = { fields: Record<string, string> };

// SAFETY: the engine writes input.json, and the step declares the inputs pullRequest and subject.
const { inputs } = JSON.parse(readFileSync(join(input, "input.json"), "utf8")) as {
  inputs: { pullRequest: Listed[]; subject: [Listed] };
};

const pullRequest = inputs.pullRequest.at(-1);

if (pullRequest === undefined) {
  console.error("No pull request about the subject was opened, so there is none to land.");
  process.exit(1);
}

const { repository, number, url } = pullRequest.fields;

const response = await fetch(`${broker}/api/repos/${repository}/pulls/${number}/merge`, {
  method: "PUT",
  headers: { authorization: "Bearer medrengard-broker", "content-type": "application/json" },
  body: JSON.stringify({ sha: inputs.subject[0].fields.sha, merge_method: method }),
});

if (!response.ok) {
  console.error(`GitHub refused to merge ${url} (${response.status}): ${await response.text()}`);
  process.exit(1);
}

writeFileSync(
  join(process.env.MEDRENGARD_OUT!, "output.json"),
  JSON.stringify({ outcome: "done" }),
);
